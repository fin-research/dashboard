import type { QueryResultRow } from "pg";

import {
  creditItemLabels,
  creditItemTypes,
  type CreditAmountChange,
  type CreditCalendarEvent,
  type CreditInstitutionUpdateResponse,
  type CreditInstitutionView,
  type CreditItemType,
  type CreditReportResponse,
  type CreditSummaryView,
  type CreditWeeklySummaryView,
  type ParsedCreditWorkbook,
} from "../credit/types.ts";
import type { CreditInstitutionUpdateInput } from "../credit/update.ts";
import type { DatabaseClient } from "./postgres.ts";

const AMOUNT_TOLERANCE = 0.0001;

export interface PersistCreditImportInput {
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
      "SELECT 1 FROM credit.institution WHERE report_date = $1::date LIMIT 1",
      [parsed.reportDate],
    );
    await client.query(
      "DELETE FROM credit.institution WHERE report_date = $1::date",
      [parsed.reportDate],
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
    `SELECT DISTINCT to_char(report_date, 'YYYY-MM-DD') AS report_date
     FROM credit.institution
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

  const institutionResult = await client.query<InstitutionRow>(
    `SELECT
         to_char(report_date, 'YYYY-MM-DD') AS report_date,
         source_row,
         institution_type,
         institution_name,
         confidentiality_status::text AS confidentiality_status,
         status::text AS status,
         included_in_weekly_report,
         total_limit::double precision,
         total_used::double precision,
         to_char(effective_date, 'YYYY-MM-DD') AS effective_date,
         to_char(expiry_date, 'YYYY-MM-DD') AS expiry_date,
         bank_office,
         applying_department,
         handler,
         notes,
         bond_preference,
         usage_details,
         to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
       FROM credit.institution
       WHERE report_date = ANY($1::date[])
       ORDER BY report_date, source_row`,
    [reportDates],
  );
  const itemResult = await client.query<ItemRow>(
    `SELECT
         to_char(report_date, 'YYYY-MM-DD') AS report_date,
         institution_name,
         item_type::text AS item_type,
         limit_amount::double precision,
         used_amount::double precision,
         details
       FROM credit.item
       WHERE report_date = ANY($1::date[])
       ORDER BY report_date, institution_name, item_type`,
    [reportDates],
  );

  const itemsByInstitution = groupItems(itemResult.rows);
  const institutionsByDate = new Map<string, CreditInstitutionView[]>();
  for (const row of institutionResult.rows) {
    const institutions = institutionsByDate.get(row.report_date) ?? [];
    institutions.push(toInstitutionView(row, itemsByInstitution));
    institutionsByDate.set(row.report_date, institutions);
  }

  const currentInstitutions = institutionsByDate.get(reportDate) ?? [];
  const previousInstitutions = previousDate
    ? institutionsByDate.get(previousDate) ?? []
    : [];
  const currentWeeklyInstitutions = currentInstitutions.filter(
    (institution) => institution.includedInWeeklyReport,
  );
  const previousWeeklyInstitutions = previousInstitutions.filter(
    (institution) => institution.includedInWeeklyReport,
  );
  const weeklyEventCounts = classifyWeeklyEvents(
    reportDate,
    previousDate,
    currentWeeklyInstitutions,
    previousWeeklyInstitutions,
  );

  return {
    availableDates,
    previousDate,
    summary: toSummary(reportDate, currentInstitutions),
    previousSummary: previousDate
      ? toSummary(previousDate, previousInstitutions)
      : null,
    weeklySummary: {
      ...toSummary(reportDate, currentWeeklyInstitutions),
      ...weeklyEventCounts,
    },
    previousWeeklySummary: previousDate
      ? {
          ...toSummary(previousDate, previousWeeklyInstitutions),
          addedInstitutionCount: 0,
          expiredInstitutionCount: 0,
        }
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
    calendarEvents: buildCalendarEvents(
      reportDate,
      previousDate,
      currentInstitutions,
      previousInstitutions,
    ),
  };
}

export async function saveCreditInstitution(
  client: DatabaseClient,
  input: CreditInstitutionUpdateInput,
): Promise<CreditInstitutionUpdateResponse> {
  await client.query("BEGIN");
  try {
    const institutionChanges = input.changes.institution ?? {};
    const itemChanges = input.changes.items ?? [];
    const updated = await client.query<{
      effective_date: string | null;
      expiry_date: string | null;
    }>(
      `WITH patch AS (SELECT $4::jsonb AS data)
       UPDATE credit.institution AS institution
       SET institution_type = CASE
             WHEN patch.data ? 'institutionType'
               THEN patch.data ->> 'institutionType'
             ELSE institution.institution_type
           END,
           confidentiality_status = CASE
             WHEN patch.data ? 'confidentialityStatus'
               THEN (patch.data ->> 'confidentialityStatus')::credit.confidentiality_status
             ELSE institution.confidentiality_status
           END,
           status = CASE
             WHEN patch.data ? 'status'
               THEN (patch.data ->> 'status')::credit.credit_status
             ELSE institution.status
           END,
           included_in_weekly_report = CASE
             WHEN patch.data ? 'includedInWeeklyReport'
               THEN (patch.data ->> 'includedInWeeklyReport')::boolean
             ELSE institution.included_in_weekly_report
           END,
           total_limit = CASE
             WHEN patch.data ? 'totalLimit'
               THEN (patch.data ->> 'totalLimit')::numeric
             ELSE institution.total_limit
           END,
           total_used = CASE
             WHEN patch.data ? 'totalUsed'
               THEN (patch.data ->> 'totalUsed')::numeric
             ELSE institution.total_used
           END,
           effective_date = CASE
             WHEN patch.data ? 'effectiveDate'
               THEN (patch.data ->> 'effectiveDate')::date
             ELSE institution.effective_date
           END,
           expiry_date = CASE
             WHEN patch.data ? 'expiryDate'
               THEN (patch.data ->> 'expiryDate')::date
             ELSE institution.expiry_date
           END,
           bank_office = CASE
             WHEN patch.data ? 'bankOffice'
               THEN patch.data ->> 'bankOffice'
             ELSE institution.bank_office
           END,
           applying_department = CASE
             WHEN patch.data ? 'applyingDepartment'
               THEN patch.data ->> 'applyingDepartment'
             ELSE institution.applying_department
           END,
           handler = CASE
             WHEN patch.data ? 'handler'
               THEN patch.data ->> 'handler'
             ELSE institution.handler
           END,
           notes = CASE
             WHEN patch.data ? 'notes'
               THEN patch.data ->> 'notes'
             ELSE institution.notes
           END,
           bond_preference = CASE
             WHEN patch.data ? 'bondPreference'
               THEN patch.data ->> 'bondPreference'
             ELSE institution.bond_preference
           END,
           usage_details = CASE
             WHEN patch.data ? 'usageDetails'
               THEN patch.data ->> 'usageDetails'
             ELSE institution.usage_details
           END,
           updated_at = clock_timestamp()
       FROM patch
       WHERE institution.report_date = $1::date
         AND institution.institution_name = $2
         AND institution.updated_at = $3::timestamptz
       RETURNING
         to_char(institution.effective_date, 'YYYY-MM-DD') AS effective_date,
         to_char(institution.expiry_date, 'YYYY-MM-DD') AS expiry_date`,
      [
        input.reportDate,
        input.institutionName,
        input.expectedUpdatedAt,
        JSON.stringify(institutionChanges),
      ],
    );
    if (!updated.rowCount) {
      const exists = await client.query(
        `SELECT 1 FROM credit.institution
         WHERE report_date = $1::date AND institution_name = $2`,
        [input.reportDate, input.institutionName],
      );
      throw new CreditDatabaseError(
        exists.rowCount ? 409 : 404,
        exists.rowCount
          ? "该授信记录已被其他操作更新，请刷新后重试"
          : "该授信记录不存在",
      );
    }
    const updatedDates = updated.rows[0]!;
    if (
      updatedDates.effective_date &&
      updatedDates.expiry_date &&
      updatedDates.effective_date > updatedDates.expiry_date
    ) {
      throw new CreditDatabaseError(400, "授信到期日不能早于生效日");
    }

    if (itemChanges.length) {
      const itemsUpdated = await client.query(
        `WITH changes AS (
           SELECT value AS patch
           FROM jsonb_array_elements($3::jsonb)
         )
         UPDATE credit.item AS item
         SET limit_amount = CASE
               WHEN changes.patch ? 'limitAmount'
                 THEN (changes.patch ->> 'limitAmount')::numeric
               ELSE item.limit_amount
             END,
             used_amount = CASE
               WHEN changes.patch ? 'usedAmount'
                 THEN (changes.patch ->> 'usedAmount')::numeric
               ELSE item.used_amount
             END,
             details = CASE
               WHEN changes.patch ? 'details'
                 THEN changes.patch ->> 'details'
               ELSE item.details
             END,
             updated_at = clock_timestamp()
         FROM changes
         WHERE item.report_date = $1::date
           AND item.institution_name = $2
           AND item.item_type = (changes.patch ->> 'type')::credit.item_type`,
        [input.reportDate, input.institutionName, JSON.stringify(itemChanges)],
      );
      if (itemsUpdated.rowCount !== itemChanges.length) {
        throw new CreditDatabaseError(404, "授信分项记录不存在");
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }

  const report = await loadCreditReport(client, input.reportDate);
  const institution = report.institutions.find(
    (item) => item.institutionName === input.institutionName,
  );
  if (!institution) throw new CreditDatabaseError(404, "该授信记录不存在");
  return {
    institution,
    summary: report.summary,
    weeklySummary: report.weeklySummary,
    limitChanges: report.limitChanges,
    usageChanges: report.usageChanges,
    calendarEvents: report.calendarEvents,
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
      const previousValue = previous?.status === "approved"
        ? mode === "limit"
          ? previousItem?.limitAmount ?? 0
          : previousItem?.usedAmount ?? 0
        : 0;
      const currentValue = current?.status === "approved"
        ? mode === "limit"
          ? currentItem?.limitAmount ?? 0
          : currentItem?.usedAmount ?? 0
        : 0;
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
    `INSERT INTO credit.institution (
       report_date, institution_name, source_row,
       institution_type, confidentiality_status, status,
       included_in_weekly_report, total_limit,
       total_used, effective_date, expiry_date,
       bank_office, applying_department, handler, notes,
       bond_preference, usage_details
     )
     SELECT
       $1::date, row.institution_name, row.source_row,
       row.institution_type,
       row.confidentiality_status::credit.confidentiality_status,
       row.status::credit.credit_status,
       row.included_in_weekly_report,
       row.total_limit, row.total_used,
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
      details: item.details,
    })),
  );
  await client.query(
    `INSERT INTO credit.item (
       report_date, institution_name, item_type,
       limit_amount, used_amount, details
     )
     SELECT
       $1::date, row.institution_name,
       row.item_type::credit.item_type,
       row.limit_amount, row.used_amount, row.details
     FROM jsonb_to_recordset($2::jsonb) AS row(
       institution_name text,
       item_type text,
       limit_amount numeric,
       used_amount numeric,
       details text
     )`,
    [parsed.reportDate, JSON.stringify(rows)],
  );
}

function toInstitutionView(
  row: InstitutionRow,
  itemsByInstitution: Map<string, CreditInstitutionView["items"][number]>,
): CreditInstitutionView {
  const totalLimit = nullableNumber(row.total_limit);
  const totalUsed = nullableNumber(row.total_used);
  return {
    reportDate: row.report_date,
    sourceRow: row.source_row,
    institutionType: row.institution_type,
    institutionName: row.institution_name,
    confidentialityStatus: row.confidentiality_status,
    status: row.status,
    includedInWeeklyReport: row.included_in_weekly_report,
    totalLimit,
    totalUsed,
    totalRemaining: totalLimit == null ? null : totalLimit - (totalUsed ?? 0),
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
    updatedAt: row.updated_at,
    items: creditItemTypes.map((type) =>
      itemsByInstitution.get(itemKey(row.report_date, row.institution_name, type)) ?? {
        type,
        limitAmount: null,
        usedAmount: null,
        remainingAmount: null,
        details: null,
      },
    ),
  };
}

function groupItems(
  rows: ItemRow[],
): Map<string, CreditInstitutionView["items"][number]> {
  return new Map(
    rows.map((row) => {
      const limitAmount = nullableNumber(row.limit_amount);
      const usedAmount = nullableNumber(row.used_amount);
      return [
        itemKey(row.report_date, row.institution_name, row.item_type),
        {
          type: row.item_type,
          limitAmount,
          usedAmount,
          remainingAmount: limitAmount == null ? null : limitAmount - (usedAmount ?? 0),
          details: row.details,
        },
      ];
    }),
  );
}

function itemKey(reportDate: string, institutionName: string, type: CreditItemType): string {
  return `${reportDate}\u0000${institutionName}\u0000${type}`;
}

function toSummary(
  reportDate: string,
  institutions: CreditInstitutionView[],
): CreditSummaryView {
  const approved = institutions.filter((institution) => institution.status === "approved");
  const totalLimit = sumAmounts(approved.map((institution) => institution.totalLimit));
  const totalUsed = sumAmounts(approved.map((institution) => institution.totalUsed));
  const totalAvailable = sumAmounts(
    approved.map((institution) => institution.availableAmount),
  );
  return {
    reportDate,
    institutionCount: institutions.length,
    approvedCount: approved.length,
    totalLimit,
    totalUsed,
    totalAvailable,
    utilization: totalLimit > 0 ? (totalUsed / totalLimit) * 100 : 0,
    expiringWithin30Days: approved.filter((institution) => {
      if (!institution.expiryDate) return false;
      const days = dayDifference(reportDate, institution.expiryDate);
      return days >= 0 && days <= 30;
    }).length,
  };
}

function classifyWeeklyEvents(
  reportDate: string,
  previousDate: string | null,
  currentInstitutions: CreditInstitutionView[],
  previousInstitutions: CreditInstitutionView[],
): Pick<CreditWeeklySummaryView, "addedInstitutionCount" | "expiredInstitutionCount"> {
  if (!previousDate) {
    return { addedInstitutionCount: 0, expiredInstitutionCount: 0 };
  }
  const previousByName = new Map(
    previousInstitutions.map((institution) => [institution.institutionName, institution]),
  );
  const currentByName = new Map(
    currentInstitutions.map((institution) => [institution.institutionName, institution]),
  );
  const added = new Set<string>();
  const expired = new Set<string>();

  for (const current of currentInstitutions) {
    const previous = previousByName.get(current.institutionName);
    if (
      current.status === "approved" &&
      (
        previous?.status !== "approved" ||
        numberValue(current.totalLimit) > numberValue(previous.totalLimit) + AMOUNT_TOLERANCE ||
        Boolean(
          current.expiryDate &&
          previous.expiryDate &&
          current.expiryDate > previous.expiryDate,
        )
      )
    ) {
      added.add(current.institutionName);
    }
    if (current.status === "revoked" && previous?.status !== "revoked") {
      expired.add(current.institutionName);
    }
    if (
      current.expiryDate &&
      current.expiryDate > previousDate &&
      current.expiryDate <= reportDate
    ) {
      expired.add(current.institutionName);
    }
  }
  for (const previous of previousInstitutions) {
    if (previous.status === "approved" && !currentByName.has(previous.institutionName)) {
      expired.add(previous.institutionName);
    }
  }
  return {
    addedInstitutionCount: added.size,
    expiredInstitutionCount: expired.size,
  };
}

function buildCalendarEvents(
  reportDate: string,
  previousDate: string | null,
  currentInstitutions: CreditInstitutionView[],
  previousInstitutions: CreditInstitutionView[],
): CreditCalendarEvent[] {
  const events = new Map<string, CreditCalendarEvent>();
  const add = (event: CreditCalendarEvent): void => {
    events.set(event.id, event);
  };
  for (const institution of currentInstitutions) {
    if (institution.status === "approved" && institution.effectiveDate) {
      const state = eventState(reportDate, institution.effectiveDate, "added");
      add({
        id: `added:new:${institution.institutionName}:${institution.effectiveDate}`,
        date: institution.effectiveDate,
        type: "added",
        kind: "new",
        institutionName: institution.institutionName,
        label: "新增授信",
        ...state,
      });
    }
    if (institution.expiryDate) {
      const state = institution.status === "revoked"
        ? { status: "revoked" as const, statusLabel: "已撤销" }
        : eventState(reportDate, institution.expiryDate, "expiry");
      add({
        id: `expiry:expiry:${institution.institutionName}:${institution.expiryDate}`,
        date: institution.expiryDate,
        type: "expiry",
        kind: "expiry",
        institutionName: institution.institutionName,
        label: "授信到期",
        ...state,
      });
    }
  }
  if (previousDate) {
    const previousByName = new Map(
      previousInstitutions.map((institution) => [institution.institutionName, institution]),
    );
    for (const current of currentInstitutions) {
      const previous = previousByName.get(current.institutionName);
      if (current.status === "approved" && previous?.status !== "approved") {
        if (current.effectiveDate !== reportDate) {
          add(completedChangeEvent(reportDate, current, "new", "新增授信"));
        }
      } else if (
        current.status === "approved" &&
        current.expiryDate &&
        previous?.expiryDate &&
        current.expiryDate > previous.expiryDate
      ) {
        add(completedChangeEvent(reportDate, current, "renewal", "续签授信"));
      }
      if (
        current.status === "approved" &&
        numberValue(current.totalLimit) > numberValue(previous?.totalLimit) + AMOUNT_TOLERANCE
      ) {
        add(completedChangeEvent(reportDate, current, "increase", "授信扩额"));
      }
      if (current.status === "revoked" && previous?.status !== "revoked") {
        add({
          id: `expiry:revoked:${current.institutionName}:${reportDate}`,
          date: reportDate,
          type: "expiry",
          kind: "revoked",
          institutionName: current.institutionName,
          label: "状态撤销",
          status: "revoked",
          statusLabel: "已撤销",
        });
      }
    }
  }
  return [...events.values()].sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.institutionName.localeCompare(right.institutionName, "zh-CN") ||
      left.kind.localeCompare(right.kind),
  );
}

function completedChangeEvent(
  reportDate: string,
  institution: CreditInstitutionView,
  kind: "new" | "renewal" | "increase",
  label: string,
): CreditCalendarEvent {
  return {
    id: `added:${kind}:${institution.institutionName}:${reportDate}`,
    date: reportDate,
    type: "added",
    kind,
    institutionName: institution.institutionName,
    label,
    status: "completed",
    statusLabel: "已完成",
  };
}

function eventState(
  reportDate: string,
  eventDate: string,
  type: "expiry" | "added",
): Pick<CreditCalendarEvent, "status" | "statusLabel"> {
  if (eventDate > reportDate) {
    return {
      status: "upcoming",
      statusLabel: type === "expiry" ? "待到期" : "待生效",
    };
  }
  if (eventDate === reportDate) {
    return {
      status: "due",
      statusLabel: type === "expiry" ? "今日到期" : "今日生效",
    };
  }
  return {
    status: "completed",
    statusLabel: type === "expiry" ? "已到期" : "已生效",
  };
}

function amountForMode(
  institution: CreditInstitutionView | undefined,
  mode: "limit" | "usage",
): number {
  if (institution?.status !== "approved") return 0;
  return mode === "limit"
    ? institution.totalLimit ?? 0
    : institution.totalUsed ?? 0;
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

function sumAmounts(values: Array<number | null>): number {
  const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return Math.round(total * 1_000_000) / 1_000_000;
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
  effective_date: string | null;
  expiry_date: string | null;
  bank_office: string | null;
  applying_department: string | null;
  handler: string | null;
  notes: string | null;
  bond_preference: string | null;
  usage_details: string | null;
  updated_at: string;
}

interface ItemRow extends QueryResultRow {
  report_date: string;
  institution_name: string;
  item_type: CreditItemType;
  limit_amount: number | null;
  used_amount: number | null;
  details: string | null;
}
