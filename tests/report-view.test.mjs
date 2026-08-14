import assert from "node:assert/strict";
import test from "node:test";

import {
  comparablePoints,
  deriveReport,
  fundMetrics,
  governmentBondMetrics,
  inventoryPoints,
  marginSnapshot,
  omoHistoryPoints,
  primaryPoints,
} from "../src/report-view.ts";

test("OMO 窗口行按日聚合为最近十个操作日的净投放", () => {
  const points = omoHistoryPoints([
    { operationDate: "2026-08-10", operationAmount: 100 },
    { operationDate: "2026-08-11", operationAmount: -50 },
    { operationDate: "2026-08-11", operationAmount: 200 },
    { operationDate: "2026-08-12", operationAmount: 0 },
    { operationDate: "bad-date", operationAmount: 999 },
  ]);

  assert.deepEqual(points, [
    { day: "2026-08-10", net_amount: 100 },
    { day: "2026-08-11", net_amount: 150 },
    { day: "2026-08-12", net_amount: 0 },
  ]);
});

test("资金面指标从 rates 原始行推导 DR/DIBO 四项", () => {
  const metrics = fundMetrics({
    dr: [
      { bondCode: "DR001", weightedYield: "1.4", weightedYieldUpDownValueBp: "-2" },
      { bondCode: "DR007", weightedYield: "1.5", weightedYieldUpDownValueBp: 0 },
    ],
    dibo: [
      { bondCode: "DIBO001", weightedYield: "1.7", weightedYieldUpDownValueBp: "1" },
      { bondCode: "DIBO007", weightedYield: "1.8", weightedYieldUpDownValueBp: "2" },
    ],
    bonds: [],
    futures: [],
  });

  assert.deepEqual(metrics, [
    { label: "DR001", value: 1.4, change: -2, unit: "%" },
    { label: "DR007", value: 1.5, change: 0, unit: "%" },
    { label: "DIBO001", value: 1.7, change: 1, unit: "%" },
    { label: "DIBO007", value: 1.8, change: 2, unit: "%" },
  ]);
});

test("关键期限国债收益率取同期限 tradeNum 最大的成交行", () => {
  const metrics = governmentBondMetrics([
    { ordinateName: "国债", abscissaName: "1Y", tradeNum: 3, yield: "1.41", yieldSubYtdCloseBp: "1" },
    { ordinateName: "国债", abscissaName: "1Y", tradeNum: 7, yield: "1.40", yieldSubYtdCloseBp: "2" },
    { ordinateName: "国债", abscissaName: "10Y", tradeNum: 5, yield: "1.80", yieldSubYtdCloseBp: "-1" },
    { ordinateName: "国债", abscissaName: "超长期限", tradeNum: 4, yield: "2.00", yieldSubYtdCloseBp: "0" },
  ]);

  assert.deepEqual(metrics, [
    { label: "1Y国债", value: 1.4, change: 2, unit: "%" },
    { label: "5Y国债", value: null, change: null, unit: "%" },
    { label: "10Y国债", value: 1.8, change: -1, unit: "%" },
    { label: "30Y国债", value: 2, change: 0, unit: "%" },
  ]);
});

test("融资融券快照从原始行推导余额与变动", () => {
  const snapshot = marginSnapshot([
    { DIM_DATE: "2026-08-12T00:00:00", TOTAL_RZRQYE: 2100050000000 },
    { DIM_DATE: "2026-08-11T00:00:00", TOTAL_RZRQYE: 2090000000000 },
  ]);

  assert.deepEqual(snapshot, {
    data_date: "2026-08-12",
    total: 21000.5,
    total_change: 100.5,
  });
  assert.deepEqual(marginSnapshot([]), {
    data_date: null,
    total: null,
    total_change: null,
  });
});

test("一级发行点从富化行过滤派生列", () => {
  const points = primaryPoints([
    {
      bondShortName: "26首集Y1",
      issueCouponRate: "1.83",
      issueTenor: "2+N",
      bondTypeText: "证券公司次级债",
      bidStartDate: "2026-08-10",
      issue_date: "08/10",
      issuer: "北京首都创业集团",
      bond_name: "26首集Y1",
      category: "公募次级债",
      tenor_years: 2,
      amount: 10,
      coupon: 1.83,
    },
    {
      bondShortName: "26东财证券01",
      issueCouponRate: "2.00",
      issue_date: "08/10",
      issuer: "东方财富证券",
      bond_name: "26东财证券01",
      category: "小公募",
      tenor_years: 2,
      amount: 10,
      coupon: 2,
    },
    {
      bondShortName: "26无票面01",
      issueCouponRate: "--",
      issue_date: "08/10",
      issuer: "丙",
      bond_name: "26无票面01",
      category: "小公募",
      tenor_years: 2,
      amount: 10,
      coupon: null,
    },
  ]);

  assert.equal(points.length, 1);
  assert.equal(points[0].tenor_years, 2);
  assert.equal(points[0].category, "公募次级债");
});

test("一级发行点排除东方财富（含非证券简称）条目", () => {
  const points = primaryPoints([
    {
      bondShortName: "26东财C5",
      issueCouponRate: "1.80",
      issue_date: "08/13",
      issuer: "东方财富",
      bond_name: "26东财C5",
      category: "小公募",
      tenor_years: 2,
      amount: 15,
      coupon: 1.8,
    },
    {
      bondShortName: "26东莞03",
      issueCouponRate: "1.65",
      issue_date: "08/13",
      issuer: "东莞证券",
      bond_name: "26东莞03",
      category: "小公募",
      tenor_years: 2,
      amount: 20,
      coupon: 1.65,
    },
  ]);

  assert.deepEqual(
    points.map((point) => point.bond_name),
    ["26东莞03"],
  );
});

test("可比债券只保留公募、5 年内、非东财的成交", () => {
  const points = comparablePoints([
    {
      bondUniCode: 1,
      bondShortName: "24东财G1",
      comShortName: "东方财富证券",
      remainingTenor: "1.5Y",
      tradeYield: 1.47,
    },
    {
      bondUniCode: 2,
      bondShortName: "25券商01",
      comShortName: "安信证券",
      remainingTenor: "0.8Y",
      tradeYield: 1.42,
    },
    {
      bondUniCode: 3,
      bondShortName: "PRIVATEA",
      comShortName: "其他",
      remainingTenor: "2Y",
      tradeYield: 1.6,
    },
    {
      bondUniCode: 4,
      bondShortName: "25券商02",
      comShortName: "某券商",
      remainingTenor: "5.01Y",
      tradeYield: 1.7,
    },
  ]);

  assert.deepEqual(
    points.map((point) => point.bond_name),
    ["25券商01"],
  );
  assert.deepEqual(
    points.map((point) => point.issuer),
    ["国投证券"],
  );
  assert.deepEqual(
    points.map((point) => point.trade_yield),
    [1.42],
  );
});

test("可比债券按发行人口径排除东方财富证券", () => {
  const points = comparablePoints([
    {
      bondUniCode: 1,
      bondShortName: "24东财05",
      comShortName: "东方财富",
      remainingTenor: "1.0Y",
      tradeYield: 1.47,
    },
    {
      bondUniCode: 2,
      bondShortName: "25券商01",
      comShortName: "安信证券",
      remainingTenor: "1.1Y",
      tradeYield: 1.42,
    },
  ]);

  assert.deepEqual(
    points.map((point) => point.bond_name),
    ["25券商01"],
  );
});

test("可比债券用稳健 Theil-Sen/MAD 残差过滤剔除离群点", () => {
  const samples = [
    [0.1, 1.43],
    [0.6, 1.48],
    [1.1, 1.5],
    [1.7, 1.56],
    [1.8, 1.87],
    [1.9, 2.45],
    [2.4, 1.6],
    [3.0, 1.66],
    [3.7, 1.71],
    [4.9, 1.75],
  ];
  const points = comparablePoints(
    samples.map(([tenor, tradeYield], index) => ({
      bondShortName: "债券" + index,
      comShortName: "甲",
      remainingTenor: tenor + "Y",
      tradeYield,
    })),
  );

  assert.deepEqual(
    points.map((point) => point.bond_name),
    ["债券0", "债券1", "债券2", "债券3", "债券6", "债券7", "债券8", "债券9"],
  );
});

test("存量债从富化行推导估值与 Bid/Ofr 报价", () => {
  const points = inventoryPoints([
    {
      bondShortName: "25东财G1",
      tenor_years: 1.0,
      valuation: 1.7,
      bid_yield: 1.71,
      ofr_yield: 1.69,
    },
    {
      bondShortName: "25东财G2",
      tenor_years: 0.5,
      valuation: 1.6,
      trade_yield: 1.61,
      bid_yield: null,
      ofr_yield: null,
    },
    {
      bondShortName: "25东财G3",
      tenor_years: null,
      valuation: null,
    },
  ]);

  assert.deepEqual(points, [
    {
      bond_name: "25东财G2",
      tenor_years: 0.5,
      valuation: 1.6,
      trade_yield: 1.61,
      bid_yield: null,
      ofr_yield: null,
    },
    {
      bond_name: "25东财G1",
      tenor_years: 1,
      valuation: 1.7,
      trade_yield: null,
      bid_yield: 1.71,
      ofr_yield: 1.69,
    },
  ]);
});

test("deriveReport 从统一 payload 产出全部派生视图", () => {
  const derived = deriveReport({
    report_date: "2026-08-13",
    generated_at: "2026-08-13T15:00:00+08:00",
    omo: [{ operationDate: "2026-08-13", operationAmount: 100 }],
    rates: {
      dr: [],
      dibo: [],
      bonds: [],
      futures: [],
    },
    stock_paragraphs: [],
    margin: [],
    equities: [],
    equity_data_time: null,
    turnover_yi: null,
    turnover_change_yi: null,
    industries: [],
    industry_data_date: "2026-08-13",
    primary_summary: { current_amount: 0, change_amount: null },
    primary: [],
    secondary: [],
    inventory: [],
  });

  assert.deepEqual(derived.omoHistory, [
    { day: "2026-08-13", net_amount: 100 },
  ]);
  assert.equal(derived.funds.length, 4);
  assert.equal(derived.governmentBonds.length, 4);
  assert.deepEqual(derived.margin, {
    data_date: null,
    total: null,
    total_change: null,
  });
  assert.deepEqual(derived.primary, []);
  assert.deepEqual(derived.comparable, []);
  assert.deepEqual(derived.inventory, []);
});
