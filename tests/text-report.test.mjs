import assert from "node:assert/strict";
import test from "node:test";

import { buildTextReport } from "../src/text-report.ts";

function reportData() {
  return {
    report_date: "2026-08-12",
    generated_at: "2026-08-12T16:00:00+08:00",
    omo_history: [{ day: "2026-08-12", net_amount: -500 }],
    funds: [{ label: "DR007", value: 1.5, change: -2, unit: "%" }],
    government_bonds: [
      { label: "10Y国债", value: 1.82, change: 0.5, unit: "%" },
    ],
    equities: [{ name: "上证指数", close: 3600, change_pct: 0.8 }],
    equity_data_time: null,
    turnover_yi: 18000,
    turnover_change_yi: -300,
    margin: {
      data_date: "2026-08-11",
      total: 21000,
      total_change: 50,
    },
    industries: [],
    industry_data_date: "2026-08-12",
    primary_summary: { current_amount: 10, change_amount: -5 },
    primary: [
      {
        issue_date: "08/12",
        issuer: "甲证券",
        bond_name: "26甲01",
        category: "小公募",
        tenor_years: 3,
        amount: 10,
        coupon: 1.75,
      },
    ],
    comparable: [
      {
        issuer: "甲证券",
        bond_name: "25甲01",
        tenor_years: 2.9,
        trade_yield: 1.8,
      },
    ],
    inventory: [
      {
        bond_name: "25东财G1",
        tenor_years: 1.2,
        valuation: 1.7,
        trade_yield: 1.72,
      },
      {
        bond_name: "25东财G2",
        tenor_years: 2.2,
        valuation: 1.8,
        trade_yield: null,
        bid_yield: 1.81,
        ofr_yield: 1.79,
      },
    ],
  };
}

test("文字报告按 API 报告章节生成并联动今日聚焦", () => {
  const report = buildTextReport(reportData(), "1. 资金面保持平稳\n2. 债市窄幅震荡");

  assert.equal(report.title, "20260812 境内市场点评");
  assert.deepEqual(
    report.sections.map((section) => section.title),
    ["央行", "利率", "股市", "一级发行", "二级行情", "今日聚焦"],
  );
  assert.equal(
    report.sections.at(-1).paragraphs[0],
    "1. 资金面保持平稳\n2. 债市窄幅震荡",
  );
  assert.match(report.sections[0].paragraphs[0], /净回笼500亿元/);
});

test("东财债券仅当日有成交的文字条目加粗", () => {
  const report = buildTextReport(reportData(), "");
  const inventory = report.sections
    .find((section) => section.title === "二级行情")
    .groups.find((group) => group.label === "东财存量债券：");

  assert.equal(inventory.entries[0].strong, true);
  assert.equal(inventory.entries[1].strong, false);
  assert.match(inventory.entries[0].text, /成交1\.72%/);
  assert.match(inventory.entries[1].text, /Bid1\.81%-Ofr1\.79%/);
});
