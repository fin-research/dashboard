import type { QueryResultRow } from "pg";

import {
  creditItemLabels,
  creditItemTypes,
  type CreditAlertView,
  type CreditAmountChange,
  type CreditInstitutionView,
  type CreditItemType,
  type CreditReportResponse,
  type CreditSummaryView,
  type ParsedCreditWorkbook,
} from "../credit/types.ts";
import type { DatabaseClient } from "./postgres.ts";

const AMOUNT_TOLERANCE = 0.0001;

export interface PersistCreditImportInput {
  importedAt: string;
  parsed: ParsedCreditWorkbook;
}

export interface PersistCreditImportResult {
  reportDate: string;
  institutionCount: number;
  approvedCount: number;
  totalLimit: number;
  totalUsed: number;
  totalAvailable: number;
  weeklyApprovedCount: number;
  weeklyTotalLimit: number;
  weeklyTotalUsed: number;
  weeklyTotalAvailable: number;
  replaced: boolean;
}

export class CreditDatabaseError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "CreditDatabaseError";
    this.status = status;
  }
}

export async function persistCreditWorkbook(
  client: DatabaseClient,
  input: PersistCreditImportInput,
): Promise<PersistCreditImportResult> {
  const { parsed } = input;
  await client.query("BEGIN");
  try {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('credit.excel_import', 0))",
    );
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [parsed.reportDate],
    );
    const existing = await client.query(
      "SELECT 1 FROM credit.daily_summary WHERE report_date = $1::date",
      [parsed.reportDate],
    );
    await client.query(
      "DELETE FROM credit.daily_summary WHERE report_date = $1::date",
      [parsed.reportDate],
    );
    await client.query(
      `INSERT INTO credit.daily_summary (
         report_date, source_file_name, source_sheet, institution_count,
         approved_count, total_limit, total_used, total_available,
         weekly_approved_count, weekly_total_limit, weekly_total_used,
         weekly_total_available, warnings, imported_at, updated_at
       ) VALUES (
         $1::date, $2, $3, $4, $5, $6, $7, $8,
         $9, $10, $11, $12, $13::jsonb, $14::timestamptz, now()
       )`,
      [
        parsed.reportDate,
        parsed.originalFileName,
        parsed.sourceSheet,
        parsed.institutions.length,
        parsed.approvedCount,
        parsed.totalLimit,
        parsed.totalUsed,
        parsed.totalAvailable,
        parsed.weeklyApprovedCount,
        parsed.weeklyTotalLimit,
        parsed.weeklyTotalUsed,
        parsed.weeklyTotalAvailable,
        JSON.stringify(parsed.warnings),
        input.importedAt,
      ],
    );
    await insertInstitutions(client, parsed);
    await insertItems(client, parsed);
    await client.query("COMMIT");
    return {
      reportDate: parsed.reportDate,
      institutionCount: parsed.institutions.length,
      approvedCount: parsed.approvedCount,
      totalLimit: parsed.totalLimit,
      totalUsed: parsed.totalUsed,
      totalAvailable: parsed.totalAvailable,
      weeklyApprovedCount: parsed.weeklyApprovedCount,
      weeklyTotalLimit: parsed.weeklyTotalLimit,
      weeklyTotalUsed: parsed.weeklyTotalUsed,
      weeklyTotalAvailable: parsed.weeklyTotalAvailable,
      replaced: Boolean(existing.rowCount),
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

export async function loadCreditReport(
  client: DatabaseClient,
  requestedDate: string | null = null,
): Promise<CreditReportResponse> {
  const datesResult = await client.query<{ report_date: string }>(
    `SELECT to_char(report_date, 'YYYY-MM-DD') AS report_date
     FROM credit.daily_summary
     ORDER BY report_date`,
  );
  const availableDates = datesResult.rows.map((row) => row.report_date);
  const reportDate = requestedDate ?? availableDates.at(-1) ?? null;
  if (!reportDate || !availableDates.includes(reportDate)) {
    throw new CreditDatabaseError(
      404,
      requestedDate ? `${requestedDate} 授信记录不存在` : "暂无授信记录",
    );
  }
  const currentIndex = availableDates.indexOf(reportDate);
  const previousDate = currentIndex > 0 ? availableDates[currentIndex - 1]! : null;
  const reportDates = previousDate ? [previousDate, reportDate] : [reportDate];

  const snapshotResult = await client.query<SnapshotRow>(
    `SELECT
         to_char(snapshot.report_date, 'YYYY-MM-DD') AS report_date,
         snapshot.institution_count,
         snapshot.approved_count,
         snapshot.total_limit::double precision,
         snapshot.total_used::double precision,
         snapshot.total_available::double precision,
         snapshot.weekly_approved_count,
         snapshot.weekly_total_limit::double precision,
         snapshot.weekly_total_used::double precision,
         snapshot.weekly_total_available::double precision,
         snapshot.source_file_name,
         snapshot.warnings,
         to_char(snapshot.imported_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS imported_at
       FROM credit.daily_summary AS snapshot
       WHERE snapshot.report_date = ANY($1::date[])
       ORDER BY snapshot.report_date`,
    [reportDates],
  );
  const institutionResult = await client.query<InstitutionRow>(
    `SELECT
         to_char(report_date, 'YYYY-MM-DD') AS report_date,
         source_row,
         institution_type,
         institution_name,
         confidentiality_status,
         status,
         included_in_weekly_report,
         total_limit::double precision,
         total_used::double precision,
         total_remaining::double precision,
         to_char(effective_date, 'YYYY-MM-DD') AS effective_date,
         to_char(expiry_date, 'YYYY-MM-DD') AS expiry_date,
         bank_office,
         applying_department,
         handler,
         notes,
         bond_preference,
         usage_details
       FROM credit.institution_daily
       WHERE report_date = ANY($1::date[])
       ORDER BY report_date, source_row`,
    [reportDates],
  );
  const itemResult = await client.query<ItemRow>(
    `SELECT
         to_char(report_date, 'YYYY-MM-DD') AS report_date,
         institution_name,
         item_type,
         limit_amount::double precision,
         used_amount::double precision,
         remaining_amount::double precision,
         details
       FROM credit.item_daily
       WHERE report_date = ANY($1::date[])
       ORDER BY report_date, institution_name, item_type`,
    [reportDates],
  );

  const itemsBySnapshot = groupItems(itemResult.rows);
  const institutionsByDate = new Map<string, CreditInstitutionView[]>();
  for (const row of institutionResult.rows) {
    const totalLimit = nullableNumber(row.total_limit);
    const totalUsed = nullableNumber(row.total_used);
    const institutions = institutionsByDate.get(row.report_date) ?? [];
    institutions.push({
      reportDate: row.report_date,
      sourceRow: row.source_row,
      institutionType: row.institution_type,
      institutionName: row.institution_name,
      confidentialityStatus: row.confidentiality_status,
      status: row.status,
      includedInWeeklyReport: row.included_in_weekly_report,
      totalLimit,
      totalUsed,
      totalRemaining: nullableNumber(row.total_remaining),
      availableAmount: totalLimit == null ? null : totalLimit - (totalUsed ?? 0),
      utilization:
        totalLimit && totalLimit > 0 ? ((totalUsed ?? 0) / totalLimit) * 100 : null,
      effectiveDate: row.effective_date,
      expiryDate: row.expiry_date,
      bankOffice: row.bank_office,
      applyingDepartment: row.applying_department,
      handler: row.handler,
      notes: row.notes,
      bondPreference: row.bond_preference,
      usageDetails: row.usage_details,
      items: creditItemTypes.map((type) =>
        itemsBySnapshot.get(itemKey(row.report_date, row.institution_name, type)) ?? {
          type,
          limitAmount: null,
          usedAmount: null,
          remainingAmount: null,
          details: null,
        },
      ),
    });
    institutionsByDate.set(row.report_date, institutions);
  }

  const currentInstitutions = institutionsByDate.get(reportDate) ?? [];
  const previousInstitutions = previousDate
    ? institutionsByDate.get(previousDate) ?? []
    : [];
  const snapshots = new Map(snapshotResult.rows.map((row) => [row.report_date, row]));
  const currentSnapshot = snapshots.get(reportDate);
  if (!currentSnapshot) throw new CreditDatabaseError(404, `${reportDate} 授信记录不存在`);
  const summary = toSummary(currentSnapshot, currentInstitutions, "overview");
  const previousSnapshot = previousDate ? snapshots.get(previousDate) : undefined;
  const alerts = buildAlerts(reportDate, currentInstitutions);
  const currentWeeklyInstitutions = currentInstitutions.filter(
    (institution) => institution.includedInWeeklyReport,
  );
  const previousWeeklyInstitutions = previousInstitutions.filter(
    (institution) => institution.includedInWeeklyReport,
  );

  return {
    availableDates,
    previousDate,
    summary: { ...summary, warningCount: alerts.length },
    previousSummary: previousSnapshot
      ? toSummary(previousSnapshot, previousInstitutions, "overview")
      : null,
    weeklySummary: toSummary(currentSnapshot, currentWeeklyInstitutions, "weekly"),
    previousWeeklySummary: previousSnapshot
      ? toSummary(previousSnapshot, previousWeeklyInstitutions, "weekly")
      : null,
    institutions: currentInstitutions,
    limitChanges: previousDate
      ? compareCreditSnapshots(
          currentWeeklyInstitutions,
          previousWeeklyInstitutions,
          "limit",
        )
      : [],
    usageChanges: previousDate
      ? compareCreditSnapshots(
          currentWeeklyInstitutions,
          previousWeeklyInstitutions,
          "usage",
        )
      : [],
    alerts,
    source: {
      fileName: currentSnapshot.source_file_name,
      importedAt: currentSnapshot.imported_at,
      warnings: Array.isArray(currentSnapshot.warnings)
        ? currentSnapshot.warnings.filter((warning): warning is string => typeof warning === "string")
        : [],
    },
  };
}

export function compareCreditSnapshots(
  currentInstitutions: CreditInstitutionView[],
  previousInstitutions: CreditInstitutionView[],
  mode: "limit" | "usage",
): CreditAmountChange[] {
  const currentByName = new Map(
    currentInstitutions.map((institution) => [institution.institutionName, institution]),
  );
  const previousByName = new Map(
    previousInstitutions.map((institution) => [institution.institutionName, institution]),
  );
  const institutionNames = new Set([...currentByName.keys(), ...previousByName.keys()]);
  const changes: CreditAmountChange[] = [];

  for (const institutionName of institutionNames) {
    const current = currentByName.get(institutionName);
    const previous = previousByName.get(institutionName);
    const previousAmount = amountForMode(previous, mode);
    const currentAmount = amountForMode(current, mode);
    const details: string[] = [];
    if (mode === "limit" && current?.status !== previous?.status) {
      details.push(`状态 ${statusLabel(previous?.status)} → ${statusLabel(current?.status)}`);
    }
    if (different(previousAmount, currentAmount)) {
      details.push(
        `${mode === "limit" ? "授信总额" : "总已用"} ${amountTransition(previousAmount, currentAmount)}`,
      );
    }
    for (const type of creditItemTypes) {
      if (mode === "limit" && type === "other") continue;
      const previousItem = previous?.items.find((item) => item.type === type);
      const currentItem = current?.items.find((item) => item.type === type);
      const previousValue = mode === "limit"
        ? previousItem?.limitAmount ?? 0
        : previousItem?.usedAmount ?? 0;
      const currentValue = mode === "limit"
        ? currentItem?.limitAmount ?? 0
        : currentItem?.usedAmount ?? 0;
      if (different(previousValue, currentValue)) {
        details.push(
          `${creditItemLabels[type]}${mode === "limit" ? "额度" : "已用"} ${amountTransition(previousValue, currentValue)}`,
        );
      }
    }
    if (!previous && current && (mode === "limit" || details.length > 0)) {
      details.unshift("新增授信主体");
    }
    if (previous && !current && (mode === "limit" || details.length > 0)) {
      details.unshift("本期不再出现");
    }
    if (details.length === 0) continue;
    changes.push({
      institutionName,
      institutionType: current?.institutionType ?? previous?.institutionType ?? "未分类",
      kind: !previous ? "added" : !current ? "removed" : "changed",
      previousAmount,
      currentAmount,
      deltaAmount: currentAmount - previousAmount,
      details,
    });
  }

  return changes.sort(
    (left, right) =>
      Math.abs(right.deltaAmount) - Math.abs(left.deltaAmount) ||
      left.institutionName.localeCompare(right.institutionName, "zh-CN"),
  );
}

async function insertInstitutions(
  client: DatabaseClient,
  parsed: ParsedCreditWorkbook,
): Promise<void> {
  const rows = parsed.institutions.map((institution) => ({
    source_row: institution.sourceRow,
    institution_type: institution.institutionType,
    institution_name: institution.institutionName,
    confidentiality_status: institution.confidentialityStatus,
    status: institution.status,
    included_in_weekly_report: institution.includedInWeeklyReport,
    total_limit: institution.totalLimit,
    total_used: institution.totalUsed,
    total_remaining: institution.totalRemaining,
    effective_date: institution.effectiveDate,
    expiry_date: institution.expiryDate,
    bank_office: institution.bankOffice,
    applying_department: institution.applyingDepartment,
    handler: institution.handler,
    notes: institution.notes,
    bond_preference: institution.bondPreference,
    usage_details: institution.usageDetails,
  }));
  await client.query(
    `INSERT INTO credit.institution_daily (
       report_date, institution_name, source_row,
       institution_type, confidentiality_status, status,
       included_in_weekly_report, total_limit,
       total_used, total_remaining, effective_date, expiry_date,
       bank_office, applying_department, handler, notes,
       bond_preference, usage_details
     )
     SELECT
       $1::date, row.institution_name, row.source_row,
       row.institution_type, row.confidentiality_status, row.status,
       row.included_in_weekly_report,
       row.total_limit, row.total_used, row.total_remaining,
       row.effective_date, row.expiry_date, row.bank_office,
       row.applying_department, row.handler, row.notes,
       row.bond_preference, row.usage_details
     FROM jsonb_to_recordset($2::jsonb) AS row(
       source_row integer,
       institution_type text,
       institution_name text,
       confidentiality_status text,
       status text,
       included_in_weekly_report boolean,
       total_limit numeric,
       total_used numeric,
       total_remaining numeric,
       effective_date date,
       expiry_date date,
       bank_office text,
       applying_department text,
       handler text,
       notes text,
       bond_preference text,
       usage_details text
     )`,
    [parsed.reportDate, JSON.stringify(rows)],
  );
}

async function insertItems(
  client: DatabaseClient,
  parsed: ParsedCreditWorkbook,
): Promise<void> {
  const rows = parsed.institutions.flatMap((institution) =>
    institution.items.map((item) => ({
      institution_name: institution.institutionName,
      item_type: item.type,
      limit_amount: item.limitAmount,
      used_amount: item.usedAmount,
      remaining_amount: item.remainingAmount,
      details: item.details,
    })),
  );
  await client.query(
    `INSERT INTO credit.item_daily (
       report_date, institution_name, item_type,
       limit_amount, used_amount, remaining_amount, details
     )
     SELECT
       $1::date, row.institution_name, row.item_type,
       row.limit_amount, row.used_amount, row.remaining_amount, row.details
     FROM jsonb_to_recordset($2::jsonb) AS row(
       institution_name text,
       item_type text,
       limit_amount numeric,
       used_amount numeric,
       remaining_amount numeric,
       details text
     )`,
    [parsed.reportDate, JSON.stringify(rows)],
  );
}

function groupItems(rows: ItemRow[]): Map<string, CreditInstitutionView["items"][number]> {
  return new Map(
    rows.map((row) => [
      itemKey(row.report_date, row.institution_name, row.item_type),
      {
        type: row.item_type,
        limitAmount: nullableNumber(row.limit_amount),
        usedAmount: nullableNumber(row.used_amount),
        remainingAmount: nullableNumber(row.remaining_amount),
        details: row.details,
      },
    ]),
  );
}

function itemKey(reportDate: string, institutionName: string, type: CreditItemType): string {
  return `${reportDate}\u0000${institutionName}\u0000${type}`;
}

function toSummary(
  row: SnapshotRow,
  institutions: CreditInstitutionView[],
  scope: "overview" | "weekly",
): CreditSummaryView {
  const totalLimit = numberValue(
    scope === "weekly" ? row.weekly_total_limit : row.total_limit,
  );
  const totalUsed = numberValue(
    scope === "weekly" ? row.weekly_total_used : row.total_used,
  );
  const expiringWithin30Days = institutions.filter((institution) => {
    if (institution.status !== "approved" || !institution.expiryDate) return false;
    const days = dayDifference(row.report_date, institution.expiryDate);
    return days >= 0 && days <= 30;
  }).length;
  return {
    reportDate: row.report_date,
    institutionCount: scope === "weekly" ? institutions.length : row.institution_count,
    approvedCount:
      scope === "weekly" ? row.weekly_approved_count : row.approved_count,
    totalLimit,
    totalUsed,
    totalAvailable: numberValue(
      scope === "weekly" ? row.weekly_total_available : row.total_available,
    ),
    utilization: totalLimit > 0 ? (totalUsed / totalLimit) * 100 : 0,
    expiringWithin30Days,
    warningCount: 0,
  };
}

function buildAlerts(
  reportDate: string,
  institutions: CreditInstitutionView[],
): CreditAlertView[] {
  const alerts: CreditAlertView[] = [];
  for (const institution of institutions) {
    if (institution.status !== "approved") continue;
    if (institution.utilization != null && institution.utilization >= 80) {
      alerts.push({
        id: `usage-${institution.institutionName}`,
        level: institution.utilization >= 100 ? "danger" : "warning",
        institutionName: institution.institutionName,
        message: `额度使用率 ${institution.utilization.toFixed(1)}%`,
      });
    }
    if (institution.expiryDate) {
      const days = dayDifference(reportDate, institution.expiryDate);
      if (days >= 0 && days <= 30) {
        alerts.push({
          id: `expiry-${institution.institutionName}`,
          level: days <= 7 ? "danger" : "warning",
          institutionName: institution.institutionName,
          message: `${days === 0 ? "当日" : `${days}天后`}到期（${institution.expiryDate}）`,
        });
      }
    }
  }
  return alerts.sort((left, right) =>
    left.level === right.level ? left.institutionName.localeCompare(right.institutionName, "zh-CN") : left.level === "danger" ? -1 : 1,
  );
}

function amountForMode(
  institution: CreditInstitutionView | undefined,
  mode: "limit" | "usage",
): number {
  return mode === "limit"
    ? institution?.totalLimit ?? 0
    : institution?.totalUsed ?? 0;
}

function amountTransition(previous: number, current: number): string {
  const delta = current - previous;
  return `${previous.toFixed(2)} → ${current.toFixed(2)} 亿元（${delta >= 0 ? "+" : ""}${delta.toFixed(2)}）`;
}

function statusLabel(status: CreditInstitutionView["status"] | undefined): string {
  if (!status) return "无记录";
  const labels: Record<CreditInstitutionView["status"], string> = {
    approved: "已获批",
    applying: "申请中",
    revoked: "已撤销",
    unknown: "未标记",
  };
  return labels[status];
}

function different(left: number, right: number): boolean {
  return Math.abs(left - right) > AMOUNT_TOLERANCE;
}

function dayDifference(start: string, end: string): number {
  return Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
  );
}

function nullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberValue(value: unknown): number {
  return nullableNumber(value) ?? 0;
}

interface SnapshotRow extends QueryResultRow {
  report_date: string;
  institution_count: number;
  approved_count: number;
  total_limit: number;
  total_used: number;
  total_available: number;
  weekly_approved_count: number;
  weekly_total_limit: number;
  weekly_total_used: number;
  weekly_total_available: number;
  source_file_name: string;
  warnings: unknown;
  imported_at: string;
}

interface InstitutionRow extends QueryResultRow {
  report_date: string;
  source_row: number;
  institution_type: string;
  institution_name: string;
  confidentiality_status: CreditInstitutionView["confidentialityStatus"];
  status: CreditInstitutionView["status"];
  included_in_weekly_report: boolean;
  total_limit: number | null;
  total_used: number | null;
  total_remaining: number | null;
  effective_date: string | null;
  expiry_date: string | null;
  bank_office: string | null;
  applying_department: string | null;
  handler: string | null;
  notes: string | null;
  bond_preference: string | null;
  usage_details: string | null;
}

interface ItemRow extends QueryResultRow {
  report_date: string;
  institution_name: string;
  item_type: CreditItemType;
  limit_amount: number | null;
  used_amount: number | null;
  remaining_amount: number | null;
  details: string | null;
}
