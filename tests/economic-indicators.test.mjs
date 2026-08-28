import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  EconomicIndicatorDatabaseError,
  loadEconomicIndicators,
  persistEconomicIndicators,
} from "../src/lib/server/economic-indicators-repository.ts";

test("经济指标仓储按指标和日期返回近18个月数据", async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      return {
        rowCount: 2,
        rows: [
          {
            code: "EMM00000012",
            date: "2026-06-30",
            value: 5.2,
            synced_at: "2026-08-28T08:00:00.000Z",
          },
          {
            code: "EMM00121996",
            date: "2026-07-31",
            value: 49.3,
            synced_at: "2026-08-28T08:00:00.000Z",
          },
        ],
      };
    },
  };

  const result = await loadEconomicIndicators(client);
  assert.equal(result.asOf, "2026-07-31");
  assert.equal(result.syncedAt, "2026-08-28T08:00:00.000Z");
  assert.deepEqual(result.rows[0], {
    code: "EMM00000012",
    date: "2026-06-30",
    value: 5.2,
  });
  assert.match(calls[0].sql, /FROM public\.edb/);
  assert.match(calls[0].sql, /interval '18 months'/);
});

test("经济指标仓储空表返回明确404", async () => {
  const client = {
    async query() {
      return { rowCount: 0, rows: [] };
    },
  };
  await assert.rejects(
    () => loadEconomicIndicators(client),
    (error) =>
      error instanceof EconomicIndicatorDatabaseError && error.status === 404,
  );
});

test("手动同步在单事务和 advisory lock 内批量 upsert", async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rowCount: sql.includes("INSERT INTO public.edb") ? 2 : null, rows: [] };
    },
  };
  const result = await persistEconomicIndicators(client, [
    { code: "EMM00000012", date: "2026-06-30", value: 5.2 },
    { code: "EMM00121996", date: "2026-07-31", value: 49.3 },
  ]);
  assert.deepEqual(result, { rowCount: 2, asOf: "2026-07-31" });
  assert.equal(calls[0].sql, "BEGIN");
  assert.match(calls[1].sql, /pg_advisory_xact_lock/);
  assert.match(calls[2].sql, /ON CONFLICT \(indicator_code, observation_date\)/);
  assert.equal(calls.at(-1).sql, "COMMIT");
});

test("经济指标数据库链路和付费手动同步受静态契约约束", async () => {
  const [migration, route, script, client] = await Promise.all([
    readFile(new URL("../edb-migrations/0001_create_edb.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/routes/api/economic-indicators/+server.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/update-economic-indicators.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/trading-research/economic-indicators.ts", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.edb/);
  assert.match(migration, /PRIMARY KEY \(indicator_code, observation_date\)/);
  assert.match(route, /withPostgres/);
  assert.match(route, /loadEconomicIndicators/);
  assert.match(script, /--apply/);
  assert.match(script, /\/choice\/data-statistics/);
  assert.match(script, /\/choice\/edb/);
  assert.doesNotMatch(script, /retry|setInterval/);
  assert.match(client, /fetch\("\/api\/economic-indicators"/);
  assert.doesNotMatch(client, /\/data\/graphql|choiceEdb/);
});
