import type { QueryResultRow } from "pg";

import {
  conclusionUpdateSchema,
  financingModelReportSchema,
  financingModelSnapshotSchema,
  sellSidePayloadSchema,
  type FinancingModelConclusion,
  type FinancingModelConclusionUpdate,
  type FinancingModelReport,
  type FinancingModelSnapshot,
  type SellSidePayload,
} from "../financing-model.ts";
import type { BondDatabaseClient } from "./postgres";

export class FinancingModelDatabaseError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "FinancingModelDatabaseError";
    this.status = status;
  }
}

interface FinancingModelRow extends QueryResultRow {
  payload: unknown;
  verdict: string | null;
  preferred_window: string | null;
  narrative: string | null;
  conclusion_updated_at: string | null;
  sell_side_payload: unknown | null;
}

export async function loadFinancingModelReport(
  client: BondDatabaseClient,
  runId: string | null = null,
): Promise<FinancingModelReport> {
  const result = await client.query<FinancingModelRow>(
    `SELECT
       run.payload,
       conclusion.verdict,
       conclusion.preferred_window,
       conclusion.narrative,
       conclusion.updated_at AS conclusion_updated_at,
       sell_side.payload AS sell_side_payload
     FROM financing_model.model_run AS run
     LEFT JOIN LATERAL (
       SELECT
         revision.verdict,
         revision.preferred_window,
         revision.narrative,
         to_char(
           revision.created_at AT TIME ZONE 'UTC',
           'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
         ) AS updated_at
       FROM financing_model.conclusion_revision AS revision
       WHERE revision.run_id = run.id
       ORDER BY revision.created_at DESC, revision.id DESC
       LIMIT 1
     ) AS conclusion ON true
     LEFT JOIN LATERAL (
       SELECT snapshot.payload
       FROM financing_model.sell_side_snapshot AS snapshot
       WHERE snapshot.run_id = run.id
       ORDER BY snapshot.generated_at DESC
       LIMIT 1
     ) AS sell_side ON true
     WHERE ($1::uuid IS NULL OR run.id = $1::uuid)
     ORDER BY run.as_of_date DESC, run.generated_at DESC
     LIMIT 1`,
    [runId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new FinancingModelDatabaseError(404, "尚无融资择时模型数据");
  }

  try {
    const snapshot = financingModelSnapshotSchema.parse(row.payload);
    const base = snapshot.base_conclusion;
    return financingModelReportSchema.parse({
      snapshot,
      conclusion: {
        verdict: row.verdict ?? base.verdict,
        preferredWindow: row.preferred_window ?? base.preferred_window,
        narrative: row.narrative ?? base.narrative,
        edited: row.verdict !== null,
        updatedAt: row.conclusion_updated_at,
      },
      sellSide:
        row.sell_side_payload === null
          ? null
          : sellSidePayloadSchema.parse(row.sell_side_payload),
    });
  } catch (error) {
    throw new FinancingModelDatabaseError(
      500,
      `融资择时模型数据契约无效: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function saveFinancingModelConclusion(
  client: BondDatabaseClient,
  input: FinancingModelConclusionUpdate,
): Promise<FinancingModelConclusion> {
  const validated = conclusionUpdateSchema.parse(input);
  const result = await client.query<{
    verdict: string;
    preferred_window: string;
    narrative: string;
    updated_at: string;
  }>(
    `INSERT INTO financing_model.conclusion_revision (
       run_id, verdict, preferred_window, narrative
     )
     SELECT id, $2, $3, $4
     FROM financing_model.model_run
     WHERE id = $1::uuid
     RETURNING
       verdict,
       preferred_window,
       narrative,
       to_char(
         created_at AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
       ) AS updated_at`,
    [
      validated.runId,
      validated.verdict,
      validated.preferredWindow,
      validated.narrative,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new FinancingModelDatabaseError(404, "融资择时模型运行不存在");
  }
  return {
    verdict: row.verdict,
    preferredWindow: row.preferred_window,
    narrative: row.narrative,
    edited: true,
    updatedAt: row.updated_at,
  };
}

export async function saveSellSideSnapshot(
  client: BondDatabaseClient,
  run: FinancingModelSnapshot,
  payload: SellSidePayload,
): Promise<SellSidePayload> {
  const validated = sellSidePayloadSchema.parse(payload);
  await client.query(
    `INSERT INTO financing_model.sell_side_snapshot (
       id, run_id, period_start, period_end, search_query,
       model_name, payload, generated_at
     ) VALUES (
       $1::uuid, $2::uuid, $3::date, $4::date, $5, $6, $7::jsonb,
       $8::timestamptz
     )`,
    [
      crypto.randomUUID(),
      run.run_id,
      validated.periodStart,
      validated.periodEnd,
      validated.searchQuery,
      validated.modelName,
      JSON.stringify(validated),
      validated.generatedAt,
    ],
  );
  return validated;
}
