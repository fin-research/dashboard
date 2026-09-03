import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  EconomicIndicatorDatabaseError,
  loadEconomicIndicators,
  persistEconomicIndicators,
} from "../src/lib/server/economic-indicators-repository.ts";
import {
  fetchChoiceEconomicIndicatorRows,
  fetchDmFundingRateRows,
} from "../src/lib/server/economic-indicator-sync.ts";
import { economicIndicatorWorkflowInstanceId } from "../worker/economic-indicator-scheduled.ts";

test("经济指标仓储按指标和Choice发布日期返回近18个月数据", async () => {
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
  assert.match(calls[0].sql, /published_date/);
  assert.match(calls[0].sql, /FROM public\.edb/);
  assert.match(calls[0].sql, /indicator_code = ANY\(\$1::text\[\]\)/);
  assert.match(calls[0].sql, /interval '18 months'/);
  assert.equal(calls[0].values[0].length, 44);
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

test("增量同步在单事务和 advisory lock 内只做 upsert", async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rowCount: sql.includes("INSERT INTO public.edb") ? 2 : null, rows: [] };
    },
  };
  const result = await persistEconomicIndicators(client, [
    {
      code: "EMM00000012",
      observationDate: "2026-06-01",
      date: "2026-07-15",
      value: 5.2,
    },
    {
      code: "EMM00121996",
      observationDate: "2026-07-01",
      date: "2026-07-31",
      value: 49.3,
    },
  ]);
  assert.deepEqual(result, { rowCount: 2, asOf: "2026-07-31" });
  assert.equal(calls[0].sql, "BEGIN");
  assert.match(calls[1].sql, /pg_advisory_xact_lock/);
  assert.doesNotMatch(calls.map((call) => call.sql).join("\n"), /DELETE FROM public\.edb/);
  assert.match(calls[2].sql, /ON CONFLICT \(indicator_code, observation_date\)/);
  assert.match(calls[2].sql, /published_date = EXCLUDED\.published_date/);
  assert.equal(calls.at(-1).sql, "COMMIT");
});

test("全量同步只替换目标指标并保留表内其他数据", async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rowCount: sql.includes("INSERT INTO public.edb") ? 1 : null, rows: [] };
    },
  };
  await persistEconomicIndicators(
    client,
    [{
      code: "E1000172",
      observationDate: "2026-08-31",
      date: "2026-08-31",
      value: 1.2232,
    }],
    { replaceCodes: ["E1000172"] },
  );
  assert.match(calls[2].sql, /DELETE FROM public\.edb WHERE indicator_code = ANY/);
  assert.deepEqual(calls[2].values, [["E1000172"]]);
  assert.match(calls[3].sql, /INSERT INTO public\.edb/);
});

test("增量 Choice 同步按回看窗口和代码族拆批并排除 DM 资金利率", async () => {
  const requests = [];
  const result = await fetchChoiceEconomicIndicatorRows(
    async (path, searchParams) => {
      requests.push({ path, searchParams: new URLSearchParams(searchParams) });
      const codes = searchParams.get("edbIds").split(",");
      const rows = [];
      if (codes.includes("E1715081")) {
        rows.push({ code: "E1715081", date: "2026-08-31", RESULT: 1.4 });
      }
      if (codes.includes("EMM00121996")) {
        rows.push({
          code: "EMM00121996",
          date: "2026-08-01",
          PUBLISHDATE: "20260831",
          RESULT: 49.3,
        });
      }
      return { function: "EDB", fields: ["code", "date", "RESULT"], rows };
    },
    "incremental",
    new Date("2026-08-31T16:00:00.000Z"),
  );
  assert.ok(requests.length > 3);
  assert.ok(requests.every((request) => request.path === "/choice/edb"));
  assert.ok(requests.every((request) => request.searchParams.get("options") === "IsPublishDate=1,FixDate=0"));
  assert.ok(requests.every((request) => request.searchParams.get("edbIds").split(",").length <= 8));
  assert.ok(requests.every((request) => !request.searchParams.get("edbIds").includes("E1300003")));
  assert.ok(requests.every((request) => {
    const codes = request.searchParams.get("edbIds").split(",");
    return !(
      codes.some((code) => /^E\d/.test(code)) &&
      codes.some((code) => /^EM[A-Z]\d/.test(code))
    );
  }));
  const liabilityRateRequest = requests.find((request) => request.searchParams.get("edbIds").includes("E1707781"));
  const overseasMacroRequest = requests.find((request) => request.searchParams.get("edbIds").includes("EMG00152118"));
  assert.equal(liabilityRateRequest.searchParams.get("startDate"), "2025-07-28");
  assert.equal(overseasMacroRequest.searchParams.get("startDate"), "2025-07-28");
  assert.notEqual(liabilityRateRequest, overseasMacroRequest);
  assert.equal(result.range.endDate, "2026-09-01");
  assert.equal(result.rows.find((row) => row.code === "E1715081").date, "2026-08-31");
});

test("DM 历史资金利率映射为 EDB 指标代码并以北京时间落日", async () => {
  const result = await fetchDmFundingRateRows(
    async (_path, searchParams) => ({
      hasNextPage: false,
      rows: [{
        bondCode: searchParams.get("bondCode"),
        capitalTime: Date.parse("2026-08-31T08:00:00.000Z"),
        weightedYield: 1.42,
      }],
    }),
    "incremental",
    new Date("2026-08-31T16:00:00.000Z"),
  );
  assert.equal(result.pageCount, 3);
  assert.deepEqual(
    result.rows.map((row) => row.code),
    ["E1300003", "E1300004", "E1704420"],
  );
  assert.ok(result.rows.every((row) => row.date === "2026-08-31"));
});

test("经济指标数据库、增量 Cron 和本地全量回填受静态契约约束", async () => {
  const [migration, publishedDateMigration, observationDateMigration, route, script, sync, scheduled, workflow, worker, wrangler, client] = await Promise.all([
    readFile(new URL("../edb-migrations/0001_create_edb.sql", import.meta.url), "utf8"),
    readFile(new URL("../edb-migrations/0002_use_published_date.sql", import.meta.url), "utf8"),
    readFile(new URL("../edb-migrations/0003_preserve_observation_date.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/routes/api/economic-indicators/+server.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/update-economic-indicators.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/server/economic-indicator-sync.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/economic-indicator-scheduled.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/economic-indicator-workflow.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/entry.ts", import.meta.url), "utf8"),
    readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/trading-research/economic-indicators.ts", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.edb/);
  assert.match(migration, /PRIMARY KEY \(indicator_code, observation_date\)/);
  assert.match(publishedDateMigration, /RENAME COLUMN observation_date TO published_date/);
  assert.match(observationDateMigration, /ADD COLUMN observation_date date/);
  assert.match(observationDateMigration, /PRIMARY KEY \(indicator_code, observation_date\)/);
  assert.match(route, /withPostgres/);
  assert.match(route, /loadEconomicIndicators/);
  assert.match(script, /--apply/);
  assert.match(script, /--full/);
  assert.match(script, /fetchDmFundingRateRows/);
  assert.match(sync, /\/choice\/edb/);
  assert.match(sync, /\/cfets-histories/);
  assert.match(sync, /IsPublishDate=1/);
  assert.doesNotMatch(sync, /IsPublishDate=0/);
  assert.match(sync, /row\.PUBLISHDATE/);
  assert.match(sync, /choicePublishedDate/);
  assert.match(sync, /publishDateProxyByCode/);
  assert.match(sync, /\["EMI01737210", "EMM00072301"\]/);
  assert.match(sync, /observationDate/);
  assert.match(scheduled, /ECONOMIC_INDICATOR_SYNC/);
  assert.match(scheduled, /economicIndicatorWorkflowInstanceId/);
  assert.match(scheduled, /retention/);
  assert.match(workflow, /class EconomicIndicatorSyncWorkflow extends WorkflowEntrypoint/);
  assert.match(workflow, /fetch Choice EDB incremental/);
  assert.match(workflow, /fetch DM funding history incremental/);
  assert.match(workflow, /persist Neon economic indicators/);
  assert.match(workflow, /NonRetryableError/);
  assert.match(workflow, /runWithoutAutomaticRetry/);
  assert.match(workflow, /economic_indicators_workflow_step_failed/);
  assert.match(workflow, /retries: \{ limit: 1, delay: "1 second", backoff: "constant"/);
  assert.doesNotMatch(workflow, /limit: [2-9]/);
  assert.match(workflow, /workflowInstanceId/);
  assert.match(worker, /EconomicIndicatorSyncWorkflow/);
  assert.match(worker, /scheduled\(controller, env, context\)/);
  assert.match(worker, /controller\.noRetry\(\)/);
  assert.match(wrangler, /"crons": \["0 16 \* \* \*"\]/);
  assert.match(wrangler, /"binding": "ECONOMIC_INDICATOR_SYNC"/);
  assert.match(wrangler, /"name": "economic-indicator-sync"/);
  assert.match(client, /fetch\("\/api\/economic-indicators"/);
  assert.doesNotMatch(client, /\/data\/graphql|choiceEdb/);
  assert.equal(
    economicIndicatorWorkflowInstanceId(Date.parse("2026-09-01T16:00:00Z")),
    "economic-indicator-sync-1788278400000",
  );
});
