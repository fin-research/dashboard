export const creditItemTypes = [
  "bond_investment",
  "yield_certificate",
  "legal_overdraft",
  "margin_income_rights",
  "interbank_lending",
  "other",
] as const;

export type CreditItemType = (typeof creditItemTypes)[number];

export const creditItemLabels: Record<CreditItemType, string> = {
  bond_investment: "债券投资",
  yield_certificate: "收益凭证",
  legal_overdraft: "法透",
  margin_income_rights: "两融收益权转让",
  interbank_lending: "同业拆借",
  other: "其它",
};

export const creditStatuses = ["approved", "applying", "revoked"] as const;
export type CreditStatus = (typeof creditStatuses)[number];
export type ConfidentialityStatus = "signed" | "not_signed" | "unknown";

export interface ParsedCreditItem {
  type: CreditItemType;
  limitAmount: number | null;
  usedAmount: number | null;
  remainingAmount: number | null;
  details: string | null;
}

export interface ParsedCreditInstitution {
  sourceRow: number;
  institutionType: string;
  institutionName: string;
  confidentialityStatus: ConfidentialityStatus;
  status: CreditStatus;
  includedInWeeklyReport: boolean;
  totalLimit: number | null;
  totalUsed: number | null;
  totalRemaining: number | null;
  effectiveDate: string | null;
  expiryDate: string | null;
  bankOffice: string | null;
  applyingDepartment: string | null;
  handler: string | null;
  notes: string | null;
  bondPreference: string | null;
  usageDetails: string | null;
  items: ParsedCreditItem[];
}

export interface ParsedCreditWorkbook {
  reportDate: string;
  originalFileName: string;
  sourceSheet: "授信一览表";
  institutions: ParsedCreditInstitution[];
  approvedCount: number;
  totalLimit: number;
  totalUsed: number;
  totalAvailable: number;
  weeklyApprovedCount: number;
  weeklyTotalLimit: number;
  weeklyTotalUsed: number;
  weeklyTotalAvailable: number;
  warnings: string[];
}

export interface CreditItemView extends ParsedCreditItem {}

export interface CreditInstitutionView
  extends Omit<ParsedCreditInstitution, "sourceRow"> {
  reportDate: string;
  sourceRow: number;
  updatedAt: string;
  utilization: number | null;
  availableAmount: number | null;
}

export interface CreditSummaryView {
  reportDate: string;
  institutionCount: number;
  approvedCount: number;
  totalLimit: number;
  totalUsed: number;
  totalAvailable: number;
  utilization: number;
  expiringWithin30Days: number;
}

export interface CreditWeeklySummaryView extends CreditSummaryView {
  addedInstitutionCount: number;
  expiredInstitutionCount: number;
}

export interface CreditAmountChange {
  institutionName: string;
  institutionType: string;
  kind: "added" | "removed" | "changed";
  previousAmount: number;
  currentAmount: number;
  deltaAmount: number;
  details: string[];
}

export type CreditWeeklyEventType = "new" | "increase" | "renewal";

export interface CreditWeeklyNewsItem {
  institutionName: string;
  institutionType: string;
  eventTypes: CreditWeeklyEventType[];
  previousAmount: number;
  currentAmount: number;
  deltaAmount: number;
  previousExpiryDate: string | null;
  currentExpiryDate: string | null;
}

export interface CreditCalendarEvent {
  id: string;
  date: string;
  type: "expiry" | "added";
  kind: "expiry" | "revoked" | "new" | "renewal" | "increase";
  institutionName: string;
  label: string;
  status: "upcoming" | "due" | "completed" | "revoked";
  statusLabel: string;
}

export interface CreditReportResponse {
  availableDates: string[];
  previousDate: string | null;
  summary: CreditSummaryView;
  previousSummary: CreditSummaryView | null;
  weeklySummary: CreditWeeklySummaryView;
  previousWeeklySummary: CreditWeeklySummaryView | null;
  institutions: CreditInstitutionView[];
  weeklyNews: CreditWeeklyNewsItem[];
  limitChanges: CreditAmountChange[];
  usageChanges: CreditAmountChange[];
  calendarEvents: CreditCalendarEvent[];
}

export interface CreditInstitutionUpdateResponse {
  institution: CreditInstitutionView;
  summary: CreditSummaryView;
  weeklySummary: CreditWeeklySummaryView;
  weeklyNews: CreditWeeklyNewsItem[];
  limitChanges: CreditAmountChange[];
  usageChanges: CreditAmountChange[];
  calendarEvents: CreditCalendarEvent[];
}
