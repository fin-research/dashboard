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

export type CreditStatus = "approved" | "applying" | "revoked" | "unknown";
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
  warningCount: number;
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

export interface CreditAlertView {
  id: string;
  level: "danger" | "warning";
  institutionName: string;
  message: string;
}

export interface CreditReportResponse {
  availableDates: string[];
  previousDate: string | null;
  summary: CreditSummaryView;
  previousSummary: CreditSummaryView | null;
  weeklySummary: CreditSummaryView;
  previousWeeklySummary: CreditSummaryView | null;
  institutions: CreditInstitutionView[];
  limitChanges: CreditAmountChange[];
  usageChanges: CreditAmountChange[];
  alerts: CreditAlertView[];
  source: {
    fileName: string;
    importedAt: string;
    warnings: string[];
  };
}
