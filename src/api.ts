import type {
  ApiConfig,
  MarketBriefing,
  PrimarySummary,
  ReportData,
} from "./types";
import { number } from "./rows.ts";

type ReportPayload = Omit<ReportData, "primary_summary"> & {
  primary_summary?: PrimarySummary;
};

async function getJson<T>(
  url: string,
  signal?: AbortSignal,
  method = "GET",
): Promise<T> {
  const response = await fetch(url, {
    method,
    signal,
    headers: { Accept: "application/json" },
  });
  const payload = (await response.json()) as T & {
    detail?: string;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.detail || payload.error || "上游数据读取失败");
  }
  return payload;
}

export function generateMarketBriefing(
  reportDate: string,
  signal?: AbortSignal,
): Promise<MarketBriefing> {
  const query = new URLSearchParams({ date: reportDate });
  return getJson<MarketBriefing>(
    `/data/market-briefing?${query}`,
    signal,
    "POST",
  );
}

export function fetchConfig(signal?: AbortSignal): Promise<ApiConfig> {
  return getJson<ApiConfig>("/data/config", signal);
}

export function fetchReport(
  reportDate: string,
  refresh: boolean,
  signal?: AbortSignal,
): Promise<ReportData> {
  const query = new URLSearchParams({ date: reportDate });
  if (refresh) query.set("refresh", "1");
  return getJson<ReportPayload>(`/data/report?${query}`, signal).then(
    normalizeReport,
  );
}

export function normalizeReport(payload: ReportPayload): ReportData {
  const fallbackAmount = payload.primary.reduce(
    (total, point) => total + (number(point.amount) ?? 0),
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
