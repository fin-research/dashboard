import assert from "node:assert/strict";
import test from "node:test";

import { normalizeReport } from "../src/api.ts";

function reportPayload() {
  return {
    report_date: "2026-07-24",
    generated_at: "2026-07-24T15:00:00+08:00",
    omo_history: [],
    funds: [],
    government_bonds: [],
    equities: [],
    equity_data_time: null,
    turnover_yi: null,
    turnover_change_yi: null,
    margin: {
      data_date: null,
      total: null,
      total_change: null,
    },
    industries: [],
    industry_data_date: "2026-07-24",
    primary: [
      {
        issue_date: "07/23",
        issuer: "甲",
        bond_name: "甲1",
        category: "短融",
        tenor_years: 0.5,
        amount: 30,
        coupon: 1.5,
      },
      {
        issue_date: "07/24",
        issuer: "乙",
        bond_name: "乙1",
        category: "短融",
        tenor_years: 0.5,
        amount: 58,
        coupon: 1.6,
      },
    ],
    comparable: [],
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

test("新接口提供的同业发行滚动窗口摘要保持不变", () => {
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
