import assert from "node:assert/strict";
import test from "node:test";

import { fetchReport, saveMarketReport } from "../src/api.ts";

function snapshot() {
  return {
    report_date: "2026-08-25",
    generated_at: "2026-08-25T15:00:00+08:00",
    omo_operations: [],
    funding_rates: [],
    government_bonds: [],
    futures: [],
    stock_paragraphs: ["A股主要指数收涨。"],
    margin: {
      data_date: "2026-08-22",
      total: 20000,
      total_change: 10,
      financing: 19900,
      financing_change: 9,
      securities_lending: 100,
      securities_lending_change: 1,
    },
    equities: [{ name: "上证指数", close: 3610.2, change_pct: 0.4 }],
    equity_data_time: null,
    turnover_yi: 15000,
    turnover_change_yi: 200,
    industries: [{ name: "银行", change_pct: 1.2, market_cap_yuan: 9.8e12 }],
    industry_data_date: "2026-08-25",
    primary_summary: { current_amount: 50, change_amount: 10 },
    primary_issues: [],
    secondary_bonds: [],
    inventory_bonds: [],
    focus_text: "",
    cached_at: "2026-08-25T15:01:00+08:00",
    finalized_at: null,
  };
}

test("市场点评从 Dashboard 按日缓存接口读取", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return Response.json(snapshot());
  };

  const report = await fetchReport("2026-08-25", true);

  assert.equal(calls[0].url, "/api/market-report?date=2026-08-25&refresh=true");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(report.equities[0].change_pct, 0.4);
  assert.equal(report.primary_summary.current_amount, 50);
});

test("历史市场点评读取不附带刷新参数", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let requestedUrl = "";
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return Response.json(snapshot());
  };
  await fetchReport("2026-08-25", false);
  assert.equal(requestedUrl, "/api/market-report?date=2026-08-25");
});

test("保存定稿只提交规范报告与今日聚焦", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let call;
  globalThis.fetch = async (url, init) => {
    call = { url, init };
    return Response.json({
      ...snapshot(),
      focus_text: "定稿判断",
      finalized_at: "2026-08-25T16:00:00+08:00",
    });
  };
  const { focus_text, cached_at, finalized_at, ...report } = snapshot();
  const saved = await saveMarketReport(report, "定稿判断");
  const body = JSON.parse(call.init.body);
  assert.equal(call.url, "/api/market-report?date=2026-08-25");
  assert.equal(call.init.method, "PUT");
  assert.equal(body.focusText, "定稿判断");
  assert.equal("focus_text" in body.report, false);
  assert.equal(saved.finalized_at, "2026-08-25T16:00:00+08:00");
});

test("缓存接口错误时前端显示业务错误", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => Response.json({ error: "Choice 数据源不可用" }, { status: 502 });
  await assert.rejects(fetchReport("2026-08-25", false), /Choice 数据源不可用/);
});
