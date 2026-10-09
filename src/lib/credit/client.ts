import type {
  CreditInstitutionUpdateResponse,
  CreditReportResponse,
} from "./types.ts";
import type { CreditInstitutionUpdateInput } from "./update.ts";

export async function fetchCreditReport(
  reportDate: string | null = null,
  fetcher: typeof fetch = fetch,
  month?: string,
): Promise<CreditReportResponse> {
  const params = new URLSearchParams();
  if (reportDate) params.set('date',reportDate);
  if (month) params.set('month',month);
  const query = params.size ? `?${params}` : '';
  const response = await fetcher(`/api/credit${query}`, {
    headers: { Accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({})) as Partial<CreditReportResponse> & {
    error?: string; detail?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || payload.detail || "授信数据加载失败");
  }
  if (
    !payload.summary ||
    !payload.weeklySummary ||
    !Array.isArray(payload.institutions) ||
    !Array.isArray(payload.weeklyNews) ||
    !Array.isArray(payload.recentApprovals) ||
    !Array.isArray(payload.availableDates)
  ) {
    throw new Error("授信接口返回的数据结构无效");
  }
  return payload as CreditReportResponse;
}

export async function updateCreditInstitution(
  input: CreditInstitutionUpdateInput,
  fetcher: typeof fetch = fetch,
  create = false,
): Promise<CreditInstitutionUpdateResponse> {
  const response = await fetcher("/api/credit", {
    method: create ? "POST" : "PATCH",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({})) as
    Partial<CreditInstitutionUpdateResponse> & { error?: string; detail?: string };
  if (!response.ok) {
    throw new Error(payload.error || payload.detail || "授信数据保存失败");
  }
  if (
    !payload.institutionName ||
    typeof payload.viewDate !== 'string' ||
    typeof payload.calendarMonth !== 'string' ||
    !(payload.institution === null || payload.institution) ||
    !payload.summary ||
    !Array.isArray(payload.weeklyNews) ||
    !Array.isArray(payload.recentApprovals) ||
    !Array.isArray(payload.previousWeeklyNews) ||
    !Array.isArray(payload.calendarEvents) ||
    !Array.isArray(payload.availableDates)
  ) {
    throw new Error("授信保存接口返回的数据结构无效");
  }
  return payload as CreditInstitutionUpdateResponse;
}
