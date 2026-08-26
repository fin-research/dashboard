import assert from "node:assert/strict";
import test from "node:test";

import { fetchReport, normalizeReport } from "../src/api.ts";

function reportPayload() {
  return {
    report_date: "2026-07-24",
    generated_at: "2026-07-24T15:00:00+08:00",
    omo: [],
    rates: { dr: [], dibo: [], bonds: [], futures: [] },
    stock_paragraphs: [],
    margin: [],
    equities: [],
    equity_data_time: null,
    turnover_yi: null,
    turnover_change_yi: null,
    industries: [],
    industry_data_date: "2026-07-24",
    primary: [
      {
        bondShortName: "甲1",
        issueCouponRate: "1.5",
        planIssueAmount: "30",
        issueTenor: "0.5Y",
        bondTypeText: "短期融资券",
        comShortName: "甲",
        bidStartDate: "2026-07-23",
        issue_date: "07/23",
        issuer: "甲",
        bond_name: "甲1",
        category: "短融",
        tenor_years: 0.5,
        amount: 30,
        coupon: 1.5,
      },
      {
        bondShortName: "乙1",
        issueCouponRate: "1.6",
        planIssueAmount: "58",
        issueTenor: "0.5Y",
        bondTypeText: "短期融资券",
        comShortName: "乙",
        bidStartDate: "2026-07-24",
        issue_date: "07/24",
        issuer: "乙",
        bond_name: "乙1",
        category: "短融",
        tenor_years: 0.5,
        amount: 58,
        coupon: 1.6,
      },
    ],
    secondary: [],
    inventory: [],
  };
}

test("兼容载荷缺少同业发行摘要时不会导致页面加载失败", () => {
  const normalized = normalizeReport(reportPayload());

  assert.deepEqual(normalized.primary_summary, {
    current_amount: 58,
    change_amount: null,
  });
});

test("新接口提供的当日与前一交易日发行摘要保持不变", () => {
  const normalized = normalizeReport({
    ...reportPayload(),
    primary_summary: {
      current_amount: 88,
      change_amount: -96.99,
    },
  });

  assert.deepEqual(normalized.primary_summary, {
    current_amount: 88,
    change_amount: -96.99,
  });
});

test("市场点评通过 GraphQL 请求并映射回既有报告契约", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return Response.json({
      data: {
        marketReport: {
          reportDate: "2026-08-25",
          generatedAt: "2026-08-25T15:00:00+08:00",
          omo: [],
          rates: { dr: [], dibo: [], bonds: [], futures: [] },
          stockParagraphs: ["A股主要指数收涨。"],
          margin: [],
          equities: [
            { name: "上证指数", close: 3610.2, changePct: 0.4 },
          ],
          equityDataTime: null,
          turnoverYi: 15000,
          turnoverChangeYi: 200,
          industries: [
            { name: "银行", changePct: 1.2, marketCapYuan: 9.8e12 },
          ],
          industryDataDate: "2026-08-25",
          primarySummary: { currentAmount: 50, changeAmount: 10 },
          primary: [],
          secondary: [],
          inventory: [],
        },
      },
    });
  };

  const report = await fetchReport("2026-08-25", true);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/data/graphql");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.variables, { date: "2026-08-25", refresh: true });
  assert.match(body.query, /marketReport\(date: \$date, refresh: \$refresh\)/);
  assert.equal(report.equities[0].change_pct, 0.4);
  assert.equal(report.industries[0].market_cap_yuan, 9.8e12);
  assert.deepEqual(report.primary_summary, {
    current_amount: 50,
    change_amount: 10,
  });
});

test("GraphQL 以 HTTP 200 返回 errors 时前端显示业务错误", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    Response.json({ errors: [{ message: "Choice 数据源不可用" }] });

  await assert.rejects(
    fetchReport("2026-08-25", false),
    /Choice 数据源不可用/,
  );
});
