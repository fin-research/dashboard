import assert from "node:assert/strict";
import test from "node:test";

import {
  loadMarketReport,
  saveMarketReport,
} from "../src/lib/server/market-report.ts";

function graphQLData() {
  return {
    reportDate: "2026-08-25",
    generatedAt: "2026-08-25T15:00:00+08:00",
    omoOperations: [], fundingRates: [], governmentBonds: [], futures: [],
    stockParagraphs: ["第一段", "第二段"],
    margin: { dataDate: "2026-08-22", totalBalanceYi: 20000, totalChangeYi: 10, financingBalanceYi: 19900, financingChangeYi: 9, securitiesLendingBalanceYi: 100, securitiesLendingChangeYi: 1 },
    equities: [], equityDataTime: null, turnoverYi: null, turnoverChangeYi: null,
    industries: [], industryDataDate: "2026-08-25",
    primarySummary: { currentAmount: 0, changeAmount: null },
    primaryIssues: [], secondaryBonds: [], inventoryBonds: [],
  };
}

function memoryBucket() {
  const objects = new Map();
  return {
    objects,
    async get(key) {
      const text = objects.get(key);
      return text === undefined ? null : { async json() { return JSON.parse(text); } };
    },
    async put(key, value, options) {
      objects.set(key, String(value));
      return { key, etag: "etag", options };
    },
  };
}

test("当天无 R2 快照时精准查询 GraphQL 并写入 market-briefing", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return Response.json({ data: graphQLData() });
  };
  const bucket = memoryBucket();
  const result = await loadMarketReport(bucket, "https://example.test/data", "2026-08-25", false);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(calls[0].url, "https://example.test/data/graphql");
  assert.deepEqual(body.variables, { request: { date: "2026-08-25", refresh: false } });
  assert.ok(!body.query.includes("marketReport"));
  assert.ok(body.query.includes("secondaryBonds(request: $request)"));
  assert.ok(bucket.objects.has("market-briefing/2026-08-25.json"));
  assert.equal(result.margin.total, 20000);
});

test("已有当天快照时直接从 R2 返回且不请求上游", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const bucket = memoryBucket();
  globalThis.fetch = async () => Response.json({ data: graphQLData() });
  const first = await loadMarketReport(bucket, "https://example.test/data", "2026-08-25", false);
  globalThis.fetch = async () => assert.fail("缓存命中不应请求上游");
  const second = await loadMarketReport(bucket, "https://example.test/data", "2026-08-25", false);
  assert.deepEqual(second, first);
});

test("人工定稿保存完整报告与聚焦文本并覆盖当日对象", async () => {
  const bucket = memoryBucket();
  const raw = graphQLData();
  const report = {
    report_date: raw.reportDate, generated_at: raw.generatedAt,
    omo_operations: [], funding_rates: [], government_bonds: [], futures: [],
    stock_paragraphs: raw.stockParagraphs,
    margin: { data_date: raw.margin.dataDate, total: 20000, total_change: 10, financing: 19900, financing_change: 9, securities_lending: 100, securities_lending_change: 1 },
    equities: [], equity_data_time: null, turnover_yi: null, turnover_change_yi: null,
    industries: [], industry_data_date: raw.industryDataDate,
    primary_summary: { current_amount: 0, change_amount: null },
    primary_issues: [], secondary_bonds: [], inventory_bonds: [],
  };
  const saved = await saveMarketReport(bucket, "2026-08-25", report, "定稿判断");
  assert.equal(saved.focus_text, "定稿判断");
  assert.ok(saved.finalized_at);
  const stored = JSON.parse(bucket.objects.get("market-briefing/2026-08-25.json"));
  assert.equal(stored.focus_text, "定稿判断");
  assert.equal(stored.report_date, "2026-08-25");
});
