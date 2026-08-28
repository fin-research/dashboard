import type { DatabaseClient } from "./postgres.ts";

export type EconomicIndicatorDatabaseRow = {
  code: string;
  date: string;
  value: number;
};

export type EconomicIndicatorDatabaseResponse = {
  asOf: string;
  syncedAt: string;
  rows: EconomicIndicatorDatabaseRow[];
};

export class EconomicIndicatorDatabaseError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "EconomicIndicatorDatabaseError";
    this.status = status;
  }
}

export async function loadEconomicIndicators(
  client: DatabaseClient,
): Promise<EconomicIndicatorDatabaseResponse> {
  const result = await client.query<EconomicIndicatorQueryRow>(
    `SELECT
       indicator_code AS code,
       to_char(observation_date, 'YYYY-MM-DD') AS date,
       value::double precision AS value,
       to_char(synced_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS synced_at
     FROM public.edb
     WHERE observation_date >= date_trunc('month', current_date - interval '18 months')::date
     ORDER BY indicator_code, observation_date`,
  );
  if (!result.rowCount) {
    throw new EconomicIndicatorDatabaseError(404, "暂无经济指标数据");
  }
  return {
    asOf: result.rows.reduce(
      (latest, row) => (row.date > latest ? row.date : latest),
      result.rows[0]!.date,
    ),
    syncedAt: result.rows.reduce(
      (latest, row) => (row.synced_at > latest ? row.synced_at : latest),
      result.rows[0]!.synced_at,
    ),
    rows: result.rows.map(({ code, date, value }) => ({ code, date, value })),
  };
}

export async function persistEconomicIndicators(
  client: DatabaseClient,
  rows: EconomicIndicatorDatabaseRow[],
): Promise<{ rowCount: number; asOf: string }> {
  if (!rows.length) throw new Error("经济指标同步结果为空");
  for (const row of rows) {
    if (
      !row.code ||
      !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
      !Number.isFinite(row.value)
    ) {
      throw new Error("经济指标同步数据格式无效");
    }
  }

  await client.query("BEGIN");
  try {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('public.edb.manual_sync', 0))",
    );
    const result = await client.query(
      `INSERT INTO public.edb (
         indicator_code, observation_date, value, synced_at
       )
       SELECT
         item.code,
         item.date::date,
         item.value::numeric,
         clock_timestamp()
       FROM jsonb_to_recordset($1::jsonb) AS item(
         code text,
         date text,
         value double precision
       )
       ON CONFLICT (indicator_code, observation_date)
       DO UPDATE SET
         value = EXCLUDED.value,
         synced_at = clock_timestamp()`,
      [JSON.stringify(rows)],
    );
    await client.query("COMMIT");
    return {
      rowCount: result.rowCount ?? rows.length,
      asOf: rows.reduce(
        (latest, row) => (row.date > latest ? row.date : latest),
        rows[0]!.date,
      ),
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

type EconomicIndicatorQueryRow = EconomicIndicatorDatabaseRow & {
  synced_at: string;
};
