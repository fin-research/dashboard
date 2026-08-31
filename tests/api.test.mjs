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

function directResponse(target) {
  const url = new URL(String(target), "https://example.test");
  if (url.pathname === "/api/market-report") return Response.json(snapshot());
  if (url.pathname === "/data/industry") {
    return Response.json({
      dataDate: "2026-08-25",
      equities: snapshot().equities,
      industries: snapshot().industries,
      turnoverYi: 15000,
      turnoverChangeYi: 200,
      tradingDates: ["2026-08-22", "2026-08-25"],
    });
  }
  if (url.pathname === "/data/stock-summary") {
    return Response.json({ paragraphs: snapshot().stock_paragraphs });
  }
  if (url.pathname === "/data/market-report/omo") {
    return Response.json({ omoOperations: [] });
  }
  if (url.pathname === "/data/market-report/funding") {
    return Response.json({ fundingRates: [] });
  }
  if (url.pathname === "/data/market-report/government-bonds") {
    return Response.json({ governmentBonds: [] });
  }
  if (url.pathname === "/data/market-report/futures") {
    return Response.json({ futures: [] });
  }
  if (url.pathname === "/data/market-report/margin") {
    const margin = snapshot().margin;
    return Response.json({
      margin: {
        dataDate: margin.data_date,
        totalBalanceYi: margin.total,
        totalChangeYi: margin.total_change,
        financingBalanceYi: margin.financing,
        financingChangeYi: margin.financing_change,
        securitiesLendingBalanceYi: margin.securities_lending,
        securitiesLendingChangeYi: margin.securities_lending_change,
      },
    });
  }
  if (url.pathname === "/data/market-report/primary") {
    return Response.json({
      primarySummary: { currentAmount: 50, changeAmount: 10 },
      primaryIssues: [],
    });
  }
  if (url.pathname === "/data/market-report/secondary") {
    return Response.json({ secondaryBonds: [] });
  }
  if (url.pathname === "/data/market-report/inventory") {
    return Response.json({ inventoryBonds: [] });
  }
  throw new Error(`unexpected request: ${target}`);
}

test("市场点评由浏览器拆分读取 Data REST，Dashboard 只读取定稿", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return directResponse(url);
  };

  const report = await fetchReport("2026-08-25", true);

  assert.equal(
    calls.filter((call) => String(call.url).includes("/data/market-report/")).length,
    8,
  );
  assert.ok(calls.some((call) => String(call.url) === "/api/market-report?date=2026-08-25"));
  assert.ok(calls.every((call) => !String(call.url).includes("/data/graphql")));
  assert.equal(report.equities[0].change_pct, 0.4);
  assert.equal(report.primary_summary.current_amount, 50);
  assert.equal(report.cached_at, snapshot().cached_at);
});

test("拆分请求不再附带 GraphQL refresh 参数", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return directResponse(url);
  };
  await fetchReport("2026-08-25", false);
  assert.ok(requestedUrls.every((url) => !url.includes("refresh=")));
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

test("Data 分段接口错误时前端显示业务错误", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url) =>
    String(url).startsWith("/data/industry?")
      ? Response.json({ detail: "Choice 数据源不可用" }, { status: 503 })
      : directResponse(url);
  await assert.rejects(fetchReport("2026-08-25", false), /Choice 数据源不可用/);
});
