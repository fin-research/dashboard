import type {
  CreditInstitutionUpdateResponse,
  CreditReportResponse,
} from "./types.ts";
import type { CreditInstitutionUpdateInput } from "./update.ts";

export async function fetchCreditReport(
  reportDate: string | null = null,
  fetcher: typeof fetch = fetch,
): Promise<CreditReportResponse> {
  const query = reportDate ? `?date=${encodeURIComponent(reportDate)}` : "";
  const response = await fetcher(`/api/credit${query}`, {
    headers: { Accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({})) as Partial<CreditReportResponse> & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || "授信数据加载失败");
  }
  if (
    !payload.summary ||
    !payload.weeklySummary ||
    !Array.isArray(payload.institutions) ||
    !Array.isArray(payload.availableDates)
  ) {
    throw new Error("授信接口返回的数据结构无效");
  }
  return payload as CreditReportResponse;
}

export async function updateCreditInstitution(
  input: CreditInstitutionUpdateInput,
  fetcher: typeof fetch = fetch,
): Promise<CreditInstitutionUpdateResponse> {
  const response = await fetcher("/api/credit", {
    method: "PATCH",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({})) as
    Partial<CreditInstitutionUpdateResponse> & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || "授信数据保存失败");
  }
  if (!payload.institution || !payload.summary || !payload.weeklySummary) {
    throw new Error("授信保存接口返回的数据结构无效");
  }
  return payload as CreditInstitutionUpdateResponse;
}
