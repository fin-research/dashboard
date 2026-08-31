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
    primary_summary: { current_amount: 0, change_amount: 0 },
    primary_issues: [],
    secondary_bonds: [],
    inventory_bonds: [],
    focus_text: "",
    cached_at: "2026-08-25T15:01:00+08:00",
    finalized_at: null,
  };
}

function marginRows() {
  return [
    {
      DIM_DATE: "2026-08-22",
      TOTAL_RZRQYE: 2e12,
      TOTAL_RZYE: 1.99e12,
      TOTAL_RQYE: 1e10,
    },
    {
      DIM_DATE: "2026-08-21",
      TOTAL_RZRQYE: 1.999e12,
      TOTAL_RZYE: 1.9891e12,
      TOTAL_RQYE: 9.9e9,
    },
  ];
}

function directResponse(target) {
  const url = new URL(String(target), "https://example.test");
  if (url.pathname === "/api/market-report") {
    const { focus_text, cached_at, finalized_at } = snapshot();
    return Response.json({ focus_text, cached_at, finalized_at });
  }
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
    return Response.json({
      title: "A股收评",
      time: "2026-08-25T15:00:00+08:00",
      paragraphs: snapshot().stock_paragraphs,
    });
  }
  if (url.pathname === "/data/omo") {
    return Response.json({
      data: [{
        operationDate: "2026-08-25",
        operationName: "逆回购",
        duration: "7D",
        interestRate: "--",
        operationAmount: "1000",
      }],
    });
  }
  if (url.pathname === "/data/cfets") {
    return Response.json([]);
  }
  if (url.pathname === "/data/bond-top-case") {
    return Response.json([]);
  }
  if (url.pathname === "/data/futures-latest") {
    return Response.json([]);
  }
  if (url.pathname === "/data/margin") {
    return Response.json(marginRows());
  }
  if (url.pathname === "/data/primary-issues") {
    assert.equal(url.searchParams.get("startDate"), "2026-08-22");
    return Response.json([]);
  }
  if (url.pathname === "/data/today-trades") {
    return Response.json([
        {
          bondUniCode: "123",
          remainingTenor: "3Y",
          tradeYield: 2.10,
          cbYte: 2.00,
        },
    ]);
  }
  if (url.pathname === "/data/favorite-quotes") {
    return Response.json([
        {
          bondUniCode: "123",
          remainingTenor: "3Y",
          remainingTenorDay: 1095,
          cbYield: 2.00,
          bidYield: 2.01,
          ofrYield: 2.02,
        },
    ]);
  }
  if (url.pathname === "/data/bond-infos") {
    assert.equal(url.searchParams.get("codes"), "123");
    assert.equal(
      url.searchParams.get("fields"),
      "bondUniCode,bondShortName,comShortName,bondType,bondOfferingType",
    );
    return Response.json([{
      bondUniCode: "123",
      bondShortName: "26测试01",
      comShortName: "测试公司",
      bondType: 37,
      bondOfferingType: 1,
    }]);
  }
  throw new Error(`unexpected request: ${target}`);
}

test("浏览器一次拉取原始资源并加工为视觉与文字共享报告", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return directResponse(url);
  };

  const report = await fetchReport("2026-08-25", true);
  const dataUrls = calls
    .map((call) => String(call.url))
    .filter((url) => url.startsWith("/data/"));
  assert.equal(dataUrls.length, 12);
  assert.equal(dataUrls.filter((url) => url.startsWith("/data/cfets?")).length, 2);
  assert.equal(dataUrls.filter((url) => url.startsWith("/data/bond-infos?")).length, 1);
  assert.ok(dataUrls.every((url) => url.includes("fields=")));
  assert.ok(dataUrls.every((url) => !url.includes("/data/market-report/")));
  assert.ok(dataUrls.every((url) => !url.includes("/data/graphql")));
  assert.equal(
    calls.filter((call) => String(call.url) === "/api/market-report?date=2026-08-25").length,
    1,
  );
  assert.equal(report.equities[0].change_pct, 0.4);
  assert.equal(report.omo_operations[0].amount_yi, 1000);
  assert.equal(report.omo_operations[0].interest_rate, null);
  assert.equal(report.primary_summary.current_amount, 0);
  assert.equal(report.secondary_bonds[0].issuer, "测试公司");
  assert.equal(report.inventory_bonds[0].bid_yield, 2.01);
  assert.equal(report.cached_at, snapshot().cached_at);
});

test("当天尚无人工定稿时继续使用实时市场数据", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url) =>
    String(url).startsWith("/api/market-report?")
      ? Response.json(
          { error: "该日期尚无市场点评定稿" },
          { status: 404 },
        )
      : directResponse(url);

  const report = await fetchReport("2026-08-25", false);

  assert.equal(report.report_date, "2026-08-25");
  assert.equal(report.focus_text, "");
  assert.equal(report.finalized_at, null);
  assert.equal(report.equities[0].name, "上证指数");
});

test("原始资源请求不附带 GraphQL refresh 参数", async (context) => {
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

test("原始 Data 接口错误时前端显示业务错误", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url) =>
    String(url).startsWith("/data/industry?")
      ? Response.json({ detail: "Choice 数据源不可用" }, { status: 503 })
      : directResponse(url);
  await assert.rejects(fetchReport("2026-08-25", false), /Choice 数据源不可用/);
});
