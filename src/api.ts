import type { ApiConfig, PrimarySummary, ReportData } from "./types";

type ReportPayload = Omit<ReportData, "primary_summary"> & {
  primary_summary?: PrimarySummary;
};

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    signal,
    headers: { Accept: "application/json" },
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || "上游数据读取失败");
  }
  return payload;
}

export function fetchConfig(signal?: AbortSignal): Promise<ApiConfig> {
  return getJson<ApiConfig>("/api/config", signal);
}

export function fetchReport(
  reportDate: string,
  refresh: boolean,
  signal?: AbortSignal,
): Promise<ReportData> {
  const query = new URLSearchParams({ date: reportDate });
  if (refresh) query.set("refresh", "1");
  return getJson<ReportPayload>(`/api/report?${query}`, signal).then(
    normalizeReport,
  );
}

export function normalizeReport(payload: ReportPayload): ReportData {
  const fallbackAmount = payload.primary.reduce(
    (total, point) => total + point.amount,
    0,
  );
  return {
    ...payload,
    primary_summary: payload.primary_summary ?? {
      current_amount: fallbackAmount,
      change_amount: null,
    },
  };
}
