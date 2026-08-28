import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { utils, write } from "xlsx";

import {
  CreditWorkbookParseError,
  parseCreditWorkbook,
} from "../src/lib/credit/workbook.ts";
import { creditInstitutionUpdateSchema } from "../src/lib/credit/update.ts";
import {
  compareCreditSnapshots,
  loadCreditReport,
  persistCreditWorkbook,
  saveCreditInstitution,
} from "../src/lib/server/credit-repository.ts";

test("授信 Excel 同时保留一览表全口径和周报名单口径", () => {
  const parsed = parseCreditWorkbook(workbookBuffer(), {
    reportDate: "2026-08-21",
    originalFileName: "授信周报.xlsx",
  });

  assert.equal(parsed.institutions.length, 2);
  assert.equal(parsed.approvedCount, 2);
  assert.equal(parsed.totalLimit, 12);
  assert.equal(parsed.totalUsed, 4);
  assert.equal(parsed.totalAvailable, 8);
  assert.equal(parsed.weeklyApprovedCount, 1);
  assert.equal(parsed.weeklyTotalLimit, 10);
  assert.equal(parsed.weeklyTotalUsed, 3);
  assert.equal(parsed.weeklyTotalAvailable, 7);
  assert.equal(parsed.institutions[0].includedInWeeklyReport, true);
  assert.equal(parsed.institutions[1].includedInWeeklyReport, false);
  assert.deepEqual(parsed.warnings, []);
});

test("授信 Excel 列结构变化时拒绝静默错位导入", () => {
  const workbook = syntheticWorkbook();
  workbook.Sheets["授信一览表"].C2.v = "交易对手";
  const buffer = write(workbook, { type: "buffer", bookType: "xlsx" });

  assert.throws(
    () => parseCreditWorkbook(buffer, {
      reportDate: "2026-08-21",
      originalFileName: "错误模板.xlsx",
    }),
    (error) =>
      error instanceof CreditWorkbookParseError &&
      /C2 应为“银行名称”/.test(error.message),
  );
});

test("授信 Excel 拒绝不存在的报告日期", () => {
  assert.throws(
    () => parseCreditWorkbook(workbookBuffer(), {
      reportDate: "2026-02-30",
      originalFileName: "错误日期.xlsx",
    }),
    /报表日必须是有效的 YYYY-MM-DD 日期/,
  );
});

test("授信 Excel 将空状态按已撤销导入", () => {
  const workbook = syntheticWorkbook();
  workbook.Sheets["授信一览表"].E5.v = null;
  const parsed = parseCreditWorkbook(
    write(workbook, { type: "buffer", bookType: "xlsx" }),
    { reportDate: "2026-08-21", originalFileName: "授信周报.xlsx" },
  );

  assert.equal(parsed.institutions[1].status, "revoked");
  assert.equal(parsed.approvedCount, 1);
  assert.equal(parsed.totalLimit, 10);
  assert.equal(parsed.totalUsed, 3);
  assert.equal(parsed.totalAvailable, 7);
});

test("周报分别识别授信额度变化和使用额度变化", () => {
  const previous = [
    institution("甲银行", 10, 3, 4, 1),
    institution("丙银行", 2, 1, 2, 1),
  ];
  const current = [
    institution("甲银行", 12, 4, 6, 2),
    institution("乙银行", 5, 0, 5, 0),
  ];

  const limitChanges = compareCreditSnapshots(current, previous, "limit");
  const usageChanges = compareCreditSnapshots(current, previous, "usage");

  assert.deepEqual(
    limitChanges.map((change) => [change.institutionName, change.deltaAmount]),
    [["乙银行", 5], ["丙银行", -2], ["甲银行", 2]],
  );
  assert.deepEqual(
    usageChanges.map((change) => [change.institutionName, change.deltaAmount]),
    [["丙银行", -1], ["甲银行", 1]],
  );
  assert.match(
    limitChanges.find((change) => change.institutionName === "甲银行").details.join("；"),
    /债券投资额度/,
  );
  assert.match(
    usageChanges.find((change) => change.institutionName === "甲银行").details.join("；"),
    /债券投资已用/,
  );
});

test("只有一个报告日时不生成周度变化且数据库查询顺序执行", async () => {
  let active = false;
  const client = {
    async query(sql) {
      assert.equal(active, false, "同一 pg.Client 不应并发执行查询");
      active = true;
      await new Promise((resolve) => setImmediate(resolve));
      active = false;
      if (/SELECT DISTINCT[\s\S]*FROM credit\.institution/.test(sql)) {
        return { rows: [{ report_date: "2026-08-21" }], rowCount: 1 };
      }
      if (/FROM credit\.institution[\s\S]*WHERE report_date/.test(sql)) {
        return { rows: [institutionRow()], rowCount: 1 };
      }
      if (/FROM credit\.item/.test(sql)) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`未处理的 SQL：${sql}`);
    },
  };

  const report = await loadCreditReport(client, "2026-08-21");

  assert.equal(report.previousDate, null);
  assert.equal(report.summary.totalLimit, 10);
  assert.equal(report.summary.totalUsed, 3);
  assert.equal(report.summary.totalAvailable, 7);
  assert.equal(report.weeklySummary.addedInstitutionCount, 0);
  assert.equal(report.weeklySummary.expiredInstitutionCount, 0);
  assert.deepEqual(report.limitChanges, []);
  assert.deepEqual(report.usageChanges, []);
  assert.ok(report.calendarEvents.some((event) => event.type === "expiry"));
});

test("周报新增包含新批、续签和扩额，到期包含授信到期和状态撤销", async () => {
  const rows = [
    institutionRow({ report_date: "2026-08-14", institution_name: "甲银行", total_limit: 10, total_used: 3, expiry_date: "2026-12-31" }),
    institutionRow({ report_date: "2026-08-14", institution_name: "乙银行", total_limit: 2, total_used: 1, expiry_date: "2026-08-20" }),
    institutionRow({ report_date: "2026-08-21", institution_name: "甲银行", total_limit: 12, total_used: 4, expiry_date: "2027-12-31" }),
    institutionRow({ report_date: "2026-08-21", institution_name: "乙银行", status: "revoked", total_limit: 2, total_used: 1, expiry_date: "2026-08-20" }),
    institutionRow({ report_date: "2026-08-21", institution_name: "丙银行", total_limit: 5, total_used: 0, effective_date: "2026-08-21" }),
  ];
  const client = {
    async query(sql) {
      if (/SELECT DISTINCT[\s\S]*FROM credit\.institution/.test(sql)) {
        return { rows: [{ report_date: "2026-08-14" }, { report_date: "2026-08-21" }], rowCount: 2 };
      }
      if (/FROM credit\.institution[\s\S]*WHERE report_date/.test(sql)) {
        return { rows, rowCount: rows.length };
      }
      if (/FROM credit\.item/.test(sql)) return { rows: [], rowCount: 0 };
      throw new Error(`未处理的 SQL：${sql}`);
    },
  };

  const report = await loadCreditReport(client, "2026-08-21");

  assert.equal(report.weeklySummary.totalLimit, 17);
  assert.equal(report.weeklySummary.totalUsed, 4);
  assert.equal(report.weeklySummary.totalAvailable, 13);
  assert.equal(report.weeklySummary.addedInstitutionCount, 2);
  assert.equal(report.weeklySummary.expiredInstitutionCount, 1);
  assert.ok(report.calendarEvents.some((event) => event.kind === "renewal"));
  assert.ok(report.calendarEvents.some((event) => event.kind === "increase"));
  assert.ok(report.calendarEvents.some((event) => event.kind === "revoked"));
});

test("同日报表导入只替换机构和分项表，不建立汇总或导入状态表", async () => {
  const calls = [];
  const client = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      return /SELECT 1 FROM credit\.institution/.test(sql)
        ? { rows: [{ "?column?": 1 }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    },
  };
  const parsed = parseCreditWorkbook(workbookBuffer(), {
    reportDate: "2026-08-21",
    originalFileName: "授信周报.xlsx",
  });

  const result = await persistCreditWorkbook(client, {
    parsed,
  });
  const sql = calls.map((call) => call.sql).join("\n");

  assert.equal(result.replaced, true);
  assert.match(sql, /DELETE FROM credit\.institution/);
  assert.match(sql, /INSERT INTO credit\.institution/);
  assert.match(sql, /INSERT INTO credit\.item/);
  assert.doesNotMatch(sql, /daily_summary|institution_daily|item_daily|import_run|_snapshot/);
  assert.equal(calls.at(-1).sql, "COMMIT");
});

test("授信详情只更新机构增量字段并使用完整 updated_at 并发检查", async () => {
  const calls = [];
  const client = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      if (/UPDATE credit\.institution/.test(sql)) {
        return {
          rows: [{
            effective_date: null,
            expiry_date: null,
            updated_at: "2026-08-21T10:00:00.123456Z",
          }],
          rowCount: 1,
        };
      }
      if (/SELECT DISTINCT[\s\S]*FROM credit\.institution/.test(sql)) {
        return { rows: [{ report_date: "2026-08-21" }], rowCount: 1 };
      }
      if (/FROM credit\.institution[\s\S]*WHERE report_date/.test(sql)) {
        return { rows: [institutionRow({ notes: "已更新", updated_at: "2026-08-21T10:00:00.000Z" })], rowCount: 1 };
      }
      if (/FROM credit\.item/.test(sql)) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    },
  };
  const current = institution("甲银行", 10, 3, 4, 1);

  const result = await saveCreditInstitution(client, {
    reportDate: current.reportDate,
    institutionName: current.institutionName,
    expectedUpdatedAt: current.updatedAt,
    changes: {
      institution: { notes: "已更新" },
    },
  });
  const sql = calls.map((call) => call.sql).join("\n");
  const updateCall = calls.find((call) => /UPDATE credit\.institution/.test(call.sql));

  assert.match(sql, /institution\.updated_at = \$3::timestamptz/);
  assert.match(sql, /patch\.data \? 'notes'/);
  assert.doesNotMatch(sql, /jsonb_array_elements/);
  assert.deepEqual(JSON.parse(updateCall.parameters[3]), { notes: "已更新" });
  assert.equal(result.institution.notes, "已更新");
  assert.equal(result.institution.updatedAt, "2026-08-21T10:00:00.123456Z");
  assert.ok(
    calls.findIndex((call) => /SELECT DISTINCT[\s\S]*FROM credit\.institution/.test(call.sql)) <
      calls.findIndex((call) => call.sql === "COMMIT"),
  );
});

test("授信详情只更新发生变化的单个分项字段", async () => {
  const calls = [];
  const client = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      if (/UPDATE credit\.institution/.test(sql)) {
        return {
          rows: [{
            effective_date: null,
            expiry_date: null,
            updated_at: "2026-08-21T10:00:00.123456Z",
          }],
          rowCount: 1,
        };
      }
      if (/UPDATE credit\.item/.test(sql)) return { rows: [], rowCount: 1 };
      if (/SELECT DISTINCT[\s\S]*FROM credit\.institution/.test(sql)) {
        return { rows: [{ report_date: "2026-08-21" }], rowCount: 1 };
      }
      if (/FROM credit\.institution[\s\S]*WHERE report_date/.test(sql)) {
        return { rows: [institutionRow()], rowCount: 1 };
      }
      if (/FROM credit\.item/.test(sql)) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    },
  };
  const current = institution("甲银行", 10, 3, 4, 1);

  await saveCreditInstitution(client, {
    reportDate: current.reportDate,
    institutionName: current.institutionName,
    expectedUpdatedAt: "2026-08-21T10:00:00.123456Z",
    changes: {
      items: [{ type: "bond_investment", usedAmount: 2 }],
    },
  });
  const itemUpdate = calls.find((call) => /UPDATE credit\.item/.test(call.sql));

  assert.match(itemUpdate.sql, /changes\.patch \? 'usedAmount'/);
  assert.deepEqual(JSON.parse(itemUpdate.parameters[2]), [
    { type: "bond_investment", usedAmount: 2 },
  ]);
});

test("授信增量 PATCH 接受微秒版本且拒绝空变更", () => {
  const base = {
    reportDate: "2026-08-21",
    institutionName: "甲银行",
    expectedUpdatedAt: "2026-08-28T02:00:39.506354Z",
  };

  assert.equal(creditInstitutionUpdateSchema.safeParse({
    ...base,
    changes: { institution: { status: "approved" } },
  }).success, true);
  assert.equal(creditInstitutionUpdateSchema.safeParse({
    ...base,
    changes: {},
  }).success, false);
});

test("授信最终 schema、API 与页面使用规范表、日历和自动保存契约", async () => {
  const [migration, repository, route, view, demoData] = await Promise.all([
    readFile(new URL("../credit-migrations/0002_normalize_credit_tables.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/server/credit-repository.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/routes/api/credit/+server.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/trading-research/CreditView.svelte", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/trading-research/demo-data.ts", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /CREATE TYPE credit\.credit_status AS ENUM/);
  assert.match(migration, /RENAME TO institution/);
  assert.match(migration, /RENAME TO item/);
  assert.match(migration, /DROP TABLE credit\.daily_summary/);
  assert.doesNotMatch(repository, /daily_summary|institution_daily|item_daily|import_run|_snapshot/);
  assert.match(repository, /SS\.US/);
  assert.doesNotMatch(repository, /SS\.MS/);
  assert.match(repository, /jsonb_array_elements/);
  assert.match(
    repository,
    /report = await loadCreditReport\(client, input\.reportDate\);\s+await client\.query\("COMMIT"\)/,
  );
  assert.match(route, /HYPERDRIVE/);
  assert.match(route, /export const PATCH/);
  assert.match(route, /creditInstitutionUpdateSchema/);
  assert.match(view, /授信一览表/);
  assert.match(view, /授信日历/);
  assert.match(view, /授信周报/);
  assert.match(view, /updateCreditInstitution/);
  assert.match(view, /pendingInstitutionChanges/);
  assert.match(view, /pendingItemChanges/);
  assert.match(view, /toggleSort/);
  assert.match(view, /function cloneInstitution/);
  assert.doesNotMatch(view, /structuredClone/);
  assert.match(view, /授信额度变动/);
  assert.match(view, /使用额度变动/);
  assert.match(view, /打印 \/ 导出 PDF/);
  assert.doesNotMatch(view, /高使用率机构|授信预警|tr-result-count|一览表全口径|数据截至/);
  assert.doesNotMatch(demoData, /demoCreditLines|creditSummary|creditAlerts|CREDIT-USAGE|CREDIT-EXPIRY/);
});

function workbookBuffer() {
  return write(syntheticWorkbook(), { type: "buffer", bookType: "xlsx" });
}

function syntheticWorkbook() {
  const overview = Array.from({ length: 5 }, () => Array(34).fill(null));
  overview[0][1] = "东方财富证券授信状况一览表";
  overview[1][1] = "银行性质";
  overview[1][2] = "银行名称";
  overview[1][3] = "是否签署保密协议/保密承诺函";
  overview[1][4] = "状态";
  overview[1][6] = "授信额度\n(亿元)";
  overview[1][9] = "债券投资额度(亿元)";
  overview[1][12] = "收益凭证额度(亿元)";
  overview[1][15] = "法透额度（亿元）";
  overview[1][18] = "两融收益权转让额度(亿元)";
  overview[1][21] = "同业拆借额度(亿元)";
  overview[1][24] = "其它(亿元)";
  overview[1][26] = "授信生效日";
  overview[1][27] = "授信到期日";
  overview[2][4] = "已获批";
  overview[2][5] = "申请中";
  overview[2][6] = "总额";
  overview[2][7] = "已用";
  overview[2][8] = "剩余";
  overview[3] = creditRow("国有银行", "甲银行", 10, 3, 7, 5, 1, 4, 5, 2, 3);
  overview[4] = creditRow(null, "乙银行", 2, 1, 1, 0, 0, 0, 0, 0, 0);
  overview[4][24] = 1;
  overview[4][25] = "其它占用";

  const weekly = Array.from({ length: 9 }, () => Array(6).fill(null));
  weekly[0][3] = "授信周报";
  weekly[2][1] = "授信总额（亿元）";
  weekly[2][3] = 10;
  weekly[3][1] = "可用余额（亿元）";
  weekly[3][3] = 7;
  weekly[5][1] = "银行性质";
  weekly[5][2] = "银行名称";
  weekly[6][3] = "总额度";
  weekly[7][1] = "国有银行";
  weekly[7][2] = "甲银行";

  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, utils.aoa_to_sheet(overview), "授信一览表");
  utils.book_append_sheet(workbook, utils.aoa_to_sheet(weekly), "授信周报");
  return workbook;
}

function creditRow(
  type,
  name,
  total,
  used,
  remaining,
  bondLimit,
  bondUsed,
  bondRemaining,
  lendingLimit,
  lendingUsed,
  lendingRemaining,
) {
  const row = Array(34).fill(null);
  row[1] = type;
  row[2] = name;
  row[3] = "是";
  row[4] = 1;
  row[6] = total;
  row[7] = used;
  row[8] = remaining;
  row[9] = bondLimit;
  row[10] = bondUsed;
  row[11] = bondRemaining;
  row[21] = lendingLimit;
  row[22] = lendingUsed;
  row[23] = lendingRemaining;
  row[26] = "2026/1/1";
  row[27] = "2026/12/31";
  return row;
}

function institution(name, total, used, bondLimit, bondUsed) {
  return {
    reportDate: "2026-08-21",
    sourceRow: 4,
    institutionType: "银行",
    institutionName: name,
    confidentialityStatus: "signed",
    status: "approved",
    includedInWeeklyReport: true,
    totalLimit: total,
    totalUsed: used,
    totalRemaining: total - used,
    availableAmount: Math.max(total - used, 0),
    utilization: total ? (used / total) * 100 : null,
    effectiveDate: "2026-01-01",
    expiryDate: "2026-12-31",
    bankOffice: null,
    applyingDepartment: null,
    handler: null,
    notes: null,
    bondPreference: null,
    usageDetails: null,
    updatedAt: "2026-08-21T09:00:00.000Z",
    items: [
      { type: "bond_investment", limitAmount: bondLimit, usedAmount: bondUsed, remainingAmount: bondLimit - bondUsed, details: null },
      { type: "yield_certificate", limitAmount: null, usedAmount: null, remainingAmount: null, details: null },
      { type: "legal_overdraft", limitAmount: null, usedAmount: null, remainingAmount: null, details: null },
      { type: "margin_income_rights", limitAmount: null, usedAmount: null, remainingAmount: null, details: null },
      { type: "interbank_lending", limitAmount: null, usedAmount: null, remainingAmount: null, details: null },
      { type: "other", limitAmount: null, usedAmount: null, remainingAmount: null, details: null },
    ],
  };
}

function institutionRow(overrides = {}) {
  return {
    report_date: "2026-08-21",
    source_row: 4,
    institution_type: "银行",
    institution_name: "甲银行",
    confidentiality_status: "signed",
    status: "approved",
    included_in_weekly_report: true,
    total_limit: 10,
    total_used: 3,
    total_remaining: 7,
    effective_date: "2026-01-01",
    expiry_date: "2026-12-31",
    bank_office: null,
    applying_department: null,
    handler: null,
    notes: null,
    bond_preference: null,
    usage_details: null,
    updated_at: "2026-08-21T09:00:00.000Z",
    ...overrides,
  };
}
