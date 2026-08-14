import assert from "node:assert/strict";
import test from "node:test";

import { normalizeReport } from "../src/api.ts";

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

test("旧接口缺少同业发行摘要时不会导致页面加载失败", () => {
  const normalized = normalizeReport(reportPayload());

  assert.deepEqual(normalized.primary_summary, {
    current_amount: 88,
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
