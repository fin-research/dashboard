import assert from "node:assert/strict";
import test from "node:test";

import {
  bondCodesFromPayloads,
  buildReportData,
} from "../src/market-report-resources.ts";

test("浏览器共享加工层从原始资源构造完整规范报告", () => {
  const todayTrades = {
    list: [
      {
        bondUniCode: 101,
        bondShortName: "26测试01",
        remainingTenor: "3Y",
        tradeYield: "2.10",
        cbYte: "2.00",
      },
      {
        bondUniCode: 102,
        bondShortName: "26东财01",
        remainingTenor: "2Y",
        tradeYield: "2.20",
        cbYte: "2.10",
      },
    ],
  };
  const favoriteQuotes = {
    list: [
      {
        bondUniCode: 101,
        bondShortName: "26测试01",
        remainingTenor: "3Y",
        remainingTenorDay: 1095,
        cbYield: "2.00",
        bidYield: "2.01",
        ofrYield: "2.02",
      },
    ],
  };
  assert.deepEqual(bondCodesFromPayloads(todayTrades, favoriteQuotes), ["101", "102"]);

  const report = buildReportData({
    reportDate: "2026-08-25",
    generatedAt: "2026-08-25T15:00:00+08:00",
    previousPrimaryDate: "2026-08-22",
    omo: {
      data: [
        {
          operationDate: "2026-08-25",
          operationName: "逆回购",
          duration: "7D",
          operationAmount: "1000",
          interestRate: "1.40",
        },
      ],
    },
    dr: {
      cfetsCapitalTable: [
        { bondCode: "DR001", weightedYield: "1.50", weightedYieldUpDownValueBp: "1" },
        { bondCode: "DR007", weightedYield: "1.60", weightedYieldUpDownValueBp: "2" },
      ],
    },
    dibo: {
      cfetsCapitalTable: [
        { bondCode: "DIBO001", weightedYield: "1.55", weightedYieldUpDownValueBp: "1.5" },
        { bondCode: "DIBO007", weightedYield: "1.65", weightedYieldUpDownValueBp: "2.5" },
      ],
    },
    governmentBonds: {
      data: [
        {
          ordinateName: "国债",
          abscissaName: "10Y",
          bondCode: "250011",
          yield: "1.80",
          yieldSubYtdCloseBp: "-1",
          tradeNum: "10",
        },
      ],
    },
    futures: {
      futuresContractLatestTradeProtoList: [
        { contractCode: "T9999", lastPrice: "108.2", upDownValuePct: "0.12" },
      ],
    },
    stock: { paragraphs: ["第一段", "第二段", "不应保留"] },
    margin: {
      data: [
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
      ],
    },
    industry: {
      dataDate: "2026-08-25",
      equities: [{ name: "上证指数", close: 3610.2, change_pct: 0.4 }],
      industries: [{ name: "银行", change_pct: 1.2, market_cap_yuan: 9.8e12 }],
      turnoverYi: 15000,
      turnoverChangeYi: 200,
    },
    primary: {
      data: {
        list: [
          {
            bidStartDate: "2026-08-22",
            comShortName: "上期公司",
            bondTypeText: "短期融资券",
            bondShortName: "26上期CP001",
            issueTenor: "1Y",
            planIssueAmount: 40,
            issueCouponRate: 2.1,
          },
          {
            bidStartDate: "2026-08-25",
            comShortName: "本期公司",
            bondTypeText: "短期融资券",
            bondShortName: "26本期CP001",
            issueTenor: "180D",
            planIssueAmount: 30,
            issueCouponRate: 2,
          },
          {
            bidStartDate: "2026-08-25",
            comShortName: "本期公司",
            bondTypeText: "短期融资券",
            bondShortName: "26本期CP002",
            issueTenor: "1Y",
            planIssueAmount: 20,
            issueCouponRate: 2.1,
          },
          {
            bidStartDate: "2026-08-25",
            comShortName: "东方财富",
            bondTypeText: "短期融资券",
            bondShortName: "26东财CP001",
            issueTenor: "1Y",
            planIssueAmount: 999,
          },
        ],
      },
    },
    todayTrades,
    favoriteQuotes,
    bondInfos: {
      data: [
        { bondUniCode: 101, comShortName: "测试公司" },
        { bondUniCode: 102, comShortName: "东方财富" },
      ],
    },
  });

  assert.equal(report.omo_operations[0].amount_yi, 1000);
  assert.deepEqual(report.funding_rates.map((item) => item.code), [
    "DR001",
    "DR007",
    "DIBO001",
    "DIBO007",
  ]);
  assert.equal(report.government_bonds[0].code, "250011");
  assert.equal(report.futures[0].code, "T9999");
  assert.deepEqual(report.stock_paragraphs, ["第一段", "第二段"]);
  assert.equal(report.margin.total_change, 10);
  assert.deepEqual(report.primary_summary, { current_amount: 50, change_amount: 10 });
  assert.equal(report.primary_issues[0].amount, 50);
  assert.deepEqual(report.primary_issues[0].tenors, ["180天", "1年"]);
  assert.equal(report.secondary_bonds.length, 1);
  assert.equal(report.secondary_bonds[0].issuer, "测试公司");
  assert.equal(report.inventory_bonds[0].bid_yield, 2.01);
});
