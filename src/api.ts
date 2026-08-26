import {
  marketReportSnapshotSchema,
  reportDataSchema,
} from "./market-report.ts";
import type {
  MarketBriefing,
  MarketReportSnapshot,
  ReportData,
} from "./types";

async function getJson<T>(
  url: string,
  signal?: AbortSignal,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method,
    signal,
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
    `/api/market-briefing?${query}`,
    signal,
    "POST",
  );
}

export async function fetchReport(
  reportDate: string,
  refresh: boolean,
  signal?: AbortSignal,
): Promise<MarketReportSnapshot> {
  const query = new URLSearchParams({ date: reportDate });
  if (refresh) query.set("refresh", "true");
  const payload = await getJson<unknown>(`/api/market-report?${query}`, signal);
  return marketReportSnapshotSchema.parse(payload);
}

export async function saveMarketReport(
  report: ReportData,
  focusText: string,
  signal?: AbortSignal,
): Promise<MarketReportSnapshot> {
  const parsedReport = reportDataSchema.strip().parse(report);
  const query = new URLSearchParams({ date: parsedReport.report_date });
  const payload = await getJson<unknown>(
    `/api/market-report?${query}`,
    signal,
    "PUT",
    { report: parsedReport, focusText },
  );
  return marketReportSnapshotSchema.parse(payload);
}
