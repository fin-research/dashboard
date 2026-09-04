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
    return Response.json(
      url.searchParams.get("source") === "DR"
        ? [{ bondCode: "DR007" }]
        : [],
    );
  }
  if (url.pathname === "/data/bond-top-case") {
    return Response.json([]);
  }
  if (url.pathname === "/data/futures-latest") {
    return Response.json([{ contractCode: "TL9999" }]);
  }
  if (url.pathname === "/data/margin") {
    return Response.json(marginRows());
  }
  if (url.pathname === "/data/primary-issues") {
    assert.equal(
      url.searchParams.get("startDate"),
      url.searchParams.get("date") === "2026-08-31"
        ? "2026-08-25"
        : "2026-08-22",
    );
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
      "bondUniCode,bondShortName,comShortName,bondType,bondOfferingType,sciTechInnoBondStatus",
    );
    return Response.json([{
      bondUniCode: "123",
      bondShortName: "26测试01",
      comShortName: "测试公司",
      bondType: 37,
      bondOfferingType: 1,
      sciTechInnoBondStatus: 0,
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

  const { report } = await fetchReport(
    "2026-08-25",
    true,
    undefined,
    "2026-08-25",
  );
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
    0,
  );
  assert.equal(report.equities[0].change_pct, 0.4);
  assert.equal(report.omo_operations[0].amount_yi, 1000);
  assert.equal(report.omo_operations[0].interest_rate, null);
  assert.equal(report.futures[0].last_price, null);
  assert.equal(report.futures[0].change_pct, null);
  assert.deepEqual(report.funding_rates, [{
    code: "DR007",
    rate: null,
    change_bp: null,
  }]);
  assert.equal(report.primary_summary.current_amount, 0);
  assert.equal(report.secondary_bonds[0].issuer, "测试公司");
  assert.equal(report.inventory_bonds[0].bid_yield, 2.01);
  assert.equal(report.cached_at, report.generated_at);
});

test("当日读取只请求 Data 原始资源，不读取 market-report 定稿", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return directResponse(url);
  };

  const { report } = await fetchReport(
    "2026-08-25",
    false,
    undefined,
    "2026-08-25",
  );

  assert.equal(report.report_date, "2026-08-25");
  assert.equal(report.focus_text, "");
  assert.equal(report.finalized_at, null);
  assert.equal(report.equities[0].name, "上证指数");
  assert.ok(requestedUrls.every((url) => !url.startsWith("/api/market-report?")));
});

test("历史日期只读取完整 R2 定稿，不再请求 Data 原始资源", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const finalized = {
    ...snapshot(),
    report_date: "2026-08-31",
    generated_at: "2026-08-31T15:00:00+08:00",
    industry_data_date: "2026-08-31",
    focus_text: "历史定稿判断",
    cached_at: "2026-08-31T16:00:00+08:00",
    finalized_at: "2026-08-31T16:00:00+08:00",
  };
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return Response.json(finalized);
  };

  const { report } = await fetchReport(
    "2026-08-31",
    false,
    undefined,
    "2026-09-01",
  );

  assert.deepEqual(calls, ["/api/market-report?date=2026-08-31"]);
  assert.equal(report.focus_text, "历史定稿判断");
  assert.equal(report.finalized_at, "2026-08-31T16:00:00+08:00");
});

test("历史日期没有定稿时回退原始 Data 重新生成", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url) === "/api/market-report?date=2026-08-31") {
      return Response.json({
        detail: "2026-08-31 尚无市场点评定稿",
        error: {
          code: "REPORT_NOT_FINALIZED",
          source: "Dashboard R2",
          stage: "snapshot_read",
        },
      }, { status: 404 });
    }
    return directResponse(url);
  };

  const { report, resourceIssues } = await fetchReport(
    "2026-08-31",
    false,
    undefined,
    "2026-09-01",
  );
  assert.equal(calls[0], "/api/market-report?date=2026-08-31");
  assert.equal(calls.filter((url) => url.startsWith("/data/")).length, 8);
  assert.ok(calls.every((url) => !url.startsWith("/data/futures-latest")));
  assert.ok(calls.every((url) => !url.startsWith("/data/today-trades")));
  assert.ok(calls.every((url) => !url.startsWith("/data/favorite-quotes")));
  assert.equal(report.report_date, "2026-08-31");
  assert.equal(report.finalized_at, null);
  assert.deepEqual(
    resourceIssues.map((issue) => issue.resource),
    ["futures", "todayTrades", "favoriteQuotes"],
  );
});

test("历史定稿的其他读取错误不触发原始 Data 回退", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return Response.json({
      detail: "历史定稿数据损坏",
      error: {
        code: "FINALIZED_SNAPSHOT_INVALID",
        source: "Dashboard R2",
        stage: "snapshot_validation",
      },
    }, { status: 503 });
  };

  await assert.rejects(
    fetchReport("2026-08-31", false, undefined, "2026-09-01"),
    /FINALIZED_SNAPSHOT_INVALID.*Dashboard R2.*snapshot_validation/,
  );
  assert.deepEqual(calls, ["/api/market-report?date=2026-08-31"]);
});

test("当日 A股收评尚未发布时保留其他模块并返回空股市段落", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.startsWith("/data/stock-summary?")) {
      return Response.json({
        detail: "东方财富尚未发布 2026-08-25 A股收评",
        error: {
          code: "RESOURCE_NOT_AVAILABLE",
          source: "东方财富大盘分析",
          stage: "article_discovery",
        },
      }, { status: 404 });
    }
    return directResponse(url);
  };

  const { report, resourceIssues } = await fetchReport(
    "2026-08-25",
    false,
    undefined,
    "2026-08-25",
  );
  assert.deepEqual(report.stock_paragraphs, []);
  assert.equal(report.equities[0].name, "上证指数");
  assert.deepEqual(resourceIssues.map((issue) => issue.resource), ["stock"]);
});

test("A股收评的其他错误只降级对应资源", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.startsWith("/data/stock-summary?")) {
      return Response.json({
        detail: "东方财富页面结构异常",
        error: {
          code: "UPSTREAM_SCHEMA_MISMATCH",
          source: "东方财富大盘分析",
          stage: "article_parsing",
        },
      }, { status: 404 });
    }
    return directResponse(url);
  };

  const { report, resourceIssues } = await fetchReport(
    "2026-08-25",
    false,
    undefined,
    "2026-08-25",
  );
  assert.deepEqual(report.stock_paragraphs, []);
  assert.equal(report.equities[0].name, "上证指数");
  assert.equal(resourceIssues[0].resource, "stock");
  assert.match(resourceIssues[0].detail, /UPSTREAM_SCHEMA_MISMATCH/);
});

test("原始资源请求不附带 GraphQL refresh 参数", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return directResponse(url);
  };
  await fetchReport("2026-08-25", false, undefined, "2026-08-25");
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
  assert.equal("textReport" in body, false);
  assert.equal("focus_text" in body.report, false);
  assert.equal(saved.finalized_at, "2026-08-25T16:00:00+08:00");
});

test("原始 Data 单资源错误时其余市场模块继续生成", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url) =>
    String(url).startsWith("/data/industry?")
      ? Response.json({
          detail: "Choice 数据源不可用",
          error: {
            code: "UPSTREAM_SCHEMA_MISMATCH",
            source: "Choice 行业行情",
            stage: "response_validation",
            issues: [{
              path: "equities.0.close",
              code: "invalid_type",
              message: "Invalid input",
              receivedType: "undefined",
            }],
          },
        }, { status: 503 })
      : directResponse(url);
  const { report, resourceIssues } = await fetchReport(
    "2026-08-25",
    false,
    undefined,
    "2026-08-25",
  );
  assert.deepEqual(report.equities, []);
  assert.equal(report.omo_operations[0].amount_yi, 1000);
  assert.deepEqual(
    resourceIssues.map((issue) => issue.resource),
    ["industry", "primary"],
  );
  assert.match(resourceIssues[0].detail, /Choice 数据源不可用/);
  assert.match(resourceIssues[0].detail, /equities\.0\.close/);
});

test("债券基础信息 503 仅使依赖债券信息的模块缺失", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url) =>
    String(url).startsWith("/data/bond-infos?")
      ? Response.json({
          detail: "DM returned invalid JSON (HTTP 200)",
          error: {
            code: "UPSTREAM_INVALID_JSON",
            source: "DM",
            stage: "decode",
          },
        }, { status: 503 })
      : directResponse(url);

  const { report, resourceIssues } = await fetchReport(
    "2026-08-25",
    false,
    undefined,
    "2026-08-25",
  );
  assert.deepEqual(report.secondary_bonds, []);
  assert.equal(report.inventory_bonds[0].bond_name, "--");
  assert.equal(report.inventory_bonds[0].bid_yield, 2.01);
  assert.equal(report.equities[0].name, "上证指数");
  assert.deepEqual(
    resourceIssues.map((issue) => issue.resource),
    ["bondInfos"],
  );
  assert.match(resourceIssues[0].detail, /UPSTREAM_INVALID_JSON/);
});
