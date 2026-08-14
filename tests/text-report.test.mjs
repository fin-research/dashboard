import assert from "node:assert/strict";
import test from "node:test";

import { buildTextReport } from "../src/text-report.ts";

const data = {
  report_date: "2026-08-13",
  omo: [
    { operationDate: "2026-08-13", duration: "7D", operationName: "逆回购", operationAmount: 1185, interestRate: "1.4" },
    { operationDate: "2026-08-13", duration: "14D", operationName: "逆回购", operationAmount: 500, interestRate: "--" },
    { operationDate: "2026-08-13", duration: "7D", operationName: "逆回购", operationAmount: -1385, interestRate: "1.4" },
  ],
  rates: {
    dr: [
      { bondCode: "DR001", weightedYield: "1.4", weightedYieldUpDownValueBp: "-2" },
      { bondCode: "DR007", weightedYield: "1.5", weightedYieldUpDownValueBp: "0" },
    ],
    dibo: [
      { bondCode: "DIBO001", weightedYield: "1.7", weightedYieldUpDownValueBp: "1" },
      { bondCode: "DIBO007", weightedYield: "1.8", weightedYieldUpDownValueBp: "2" },
    ],
    bonds: [
      { ordinateName: "国债", abscissaName: "超长期限", tradeNum: 5, bondCode: "2500001", yield: "2.0", yieldSubYtdCloseBp: "-1" },
      { ordinateName: "国债", abscissaName: "10Y", tradeNum: 5, bondCode: "2500002", yield: "1.8", yieldSubYtdCloseBp: "-2" },
      { ordinateName: "国债", abscissaName: "5Y", tradeNum: 5, bondCode: "2500003", yield: "1.6", yieldSubYtdCloseBp: "1" },
      { ordinateName: "国债", abscissaName: "1Y", tradeNum: 5, bondCode: "2500004", yield: "1.4", yieldSubYtdCloseBp: "2" },
      { ordinateName: "国开", abscissaName: "10Y", tradeNum: 5, bondCode: "2502001", yield: "1.9", yieldSubYtdCloseBp: "0" },
    ],
    futures: [
      { contractCode: "TL9999", lastPrice: "110.5", upDownValuePct: "0.1" },
      { contractCode: "T9999", lastPrice: "108", upDownValuePct: "-0.2" },
      { contractCode: "TF9999", lastPrice: "106", upDownValuePct: "0" },
      { contractCode: "TS9999", lastPrice: "102", upDownValuePct: "0.3" },
    ],
  },
  stock_paragraphs: ["A股主要指数集体收涨。", "全市场成交保持活跃。", "第三段不应展示。"],
  margin: [
    { DIM_DATE: "2026-08-12T00:00:00", TOTAL_RZRQYE: 2100050000000, TOTAL_RZYE: 2080000000000, TOTAL_RQYE: 20050000000 },
    { DIM_DATE: "2026-08-11T00:00:00", TOTAL_RZRQYE: 2090000000000, TOTAL_RZYE: 2085000000000, TOTAL_RQYE: 5000000000 },
  ],
  primary: [
    { bondShortName: "26甲D1", bondTypeText: "短期融资券", issueTenor: "180D", issueCouponRate: "1.50", planIssueAmount: "10.00", bidStartDate: "2026-08-13", comShortName: "甲证券" },
    { bondShortName: "26乙S1", bondTypeText: "公司债", issueTenor: "0.5Y", issueCouponRate: "1.60", planIssueAmount: "20", bidStartDate: "2026-08-13", comShortName: "乙证券" },
    { bondShortName: "26丙01", bondTypeText: "公司债", issueTenor: "3Y", issueCouponRate: "1.70", planIssueAmount: "30", bidStartDate: "2026-08-13", comShortName: "丙证券" },
    { bondShortName: "26丁C1", bondTypeText: "证券公司次级债", issueTenor: "2+N", issueCouponRate: "1.80", planIssueAmount: "40", bidStartDate: "2026-08-13", comShortName: "丁证券" },
    { bondShortName: "26戊01", bondTypeText: "公司债", publicOffering: 2, issueTenor: "2Y", issueCouponRate: "1.90", planIssueAmount: "50", bidStartDate: "2026-08-13", comShortName: "戊证券" },
    { bondShortName: "26东财证券01", bondTypeText: "公司债", issueTenor: "2Y", issueCouponRate: "2.00", planIssueAmount: "60", bidStartDate: "2026-08-13", comShortName: "东方财富证券" },
  ],
  secondary: [
    { bondUniCode: 1, bondShortName: "25甲G1", comShortName: "甲证券", remainingTenor: "3.1Y", cbYte: "1.71", tradeYield: "1.72" },
    { bondUniCode: 2, bondShortName: "25乙01", comShortName: "安信证券", remainingTenor: "2.1Y", cbYte: "1.61", tradeYield: "1.62" },
    { bondUniCode: 3, bondShortName: "25丙01", comShortName: "丙证券", remainingTenor: "329D", cbYte: "1.51", tradeYield: "1.52" },
  ],
  inventory: [
    { bondShortName: "25东财G1", remainingTenor: "180D", remainingTenorDay: 180, cbYield: "1.55", tradeEntryPrice: "1.56", tradeYieldSubCb: "1.25" },
    { bondShortName: "25东财G2", remainingTenor: "1.2Y", remainingTenorDay: 438, cbYield: "1.65", bidYield: "1.66", ofrEntryPrice: "1.64" },
  ],
};

const pythonOutput = `20260813 境内市场点评

【央行】
中国央行今日开展14天期逆回购500亿元，并开展7天期逆回购1185亿元，操作利率为1.40%；今日有7天期逆回购1385亿元；净投放300亿元。

【利率】
今日银行间隔夜和7天期利率多数上行。
截至17:00，DR001报1.4000%，跌2.00bp；DR007报1.5000%，与前日持平。
同业拆借DIBO001报1.7000%，涨1.00bp；DIBO007报1.8000%，涨2.00bp。

国债收益率长端下行，中短端上行。
截至17:00，30年期国债2500001收益率下行1.00bp报2.0000%，10年期国债2500002收益率下行2.00bp报1.8000%，5年期国债2500003收益率上行1.00bp报1.6000%，1年期国债2500004收益率上行2.00bp报1.4000%。
10年期国开债2502001收益率持平报1.9000%。

国债期货多数上涨，30年期主力合约涨0.10%报110.5000，10年期主力合约跌0.20%，5年期主力合约持平，2年期主力合约涨0.30%。

【股市】
A股主要指数集体收涨。全市场成交保持活跃。

截至8月12日，沪深京三市融资融券余额合计21000.50亿元，较前一交易日增加100.50亿元；融资余额合计20800.00亿元，较前一交易日减少50.00亿元；融券余额合计200.50亿元，较前一交易日增加150.50亿元。

【一级发行】
可比证券公司发行情况:${" "}
短融:
08/13-甲证券-180D-10亿-1.5%
公募短债:
08/13-乙证券-182D-20亿-1.6%
小公募:
08/13-丙证券-3Y-30亿-1.7%
公募次级债:
08/13-丁证券-2+N-40亿-1.8%
私募债:
08/13-戊证券-2Y-50亿-1.9%

【二级行情】
可比证券公司债券成交：(公募债)
3.1年-甲证券(25甲G1)-估值1.71%-成交1.72%
2.1年-国投证券(25乙01)-估值1.61%-成交1.62%
329天-丙证券(25丙01)-估值1.51%-成交1.52%

东财存量债券:${" "}
180天-25东财G1-估值1.55%-成交1.56%(+1.25bp)
1.2年-25东财G2-估值1.65%-Bid1.66%-Ofr1.64%

【今日聚焦】

`;

test("前端文字报告逐字符复刻 Python 版输出", () => {
  assert.equal(buildTextReport(data), pythonOutput);
});

test("一级发行与二级行情统一排除东方财富并回退相近券", () => {
  const input = structuredClone(data);
  input.primary.push({
    bondShortName: "26东财C5",
    bondTypeText: "公司债",
    issueTenor: "2Y",
    issueCouponRate: "1.80",
    planIssueAmount: "15",
    bidStartDate: "2026-08-13",
    comShortName: null,
    issuer: "东方财富",
  });
  input.secondary.push(
    {
      bondUniCode: 4,
      bondShortName: "25东财G9",
      comShortName: "东方财富证券",
      remainingTenor: "2.95Y",
      cbYte: "1.70",
      tradeYield: "1.71",
    },
    {
      bondUniCode: 5,
      bondShortName: "25己G1",
      comShortName: "己证券",
      remainingTenor: "2.95Y",
      cbYte: "1.68",
      tradeYield: "1.69",
    },
  );

  const report = buildTextReport(input);
  const primarySection = report.slice(
    report.indexOf("【一级发行】"),
    report.indexOf("【二级行情】"),
  );
  const secondarySection = report.slice(
    report.indexOf("【二级行情】"),
    report.indexOf("东财存量债券"),
  );

  assert.ok(!primarySection.includes("东方财富"));
  assert.ok(!primarySection.includes("26东财C5"));
  assert.ok(!secondarySection.includes("东方财富"));
  assert.ok(!secondarySection.includes("25东财G9"));
  assert.ok(secondarySection.includes("己证券"));
});
