import type { CreditReportResponse } from "./types.ts";

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
