import { z } from "zod";
import { readSse } from "./lib/sse.ts";

import {
  DataApiRequestError,
  dataApiErrorCode,
  formatDataApiError,
} from "./data-api-error.ts";

import {
  marketReportSnapshotSchema,
  reportDataSchema,
} from "./market-report.ts";
import { currentReportDate } from "./report-date.ts";
import type {
  MarketBriefing,
  MarketBriefingProgress,
  MarketReportLoadResult,
  MarketReportResource,
  MarketReportResourceIssue,
  MarketReportSnapshot,
  ReportData,
} from "./types";

const marketBriefingSchema = z.object({
  report_date: z.string(),
  stock: z.string().trim().min(1),
  bond: z.string().trim().min(1),
  news_count: z.number().int().nonnegative(),
});

async function getJson<T>(
  url: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
  method = "GET",
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      signal,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    throw new DataApiRequestError(0, `${url.split("?")[0]} 请求失败：${detail}`);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new DataApiRequestError(
      response.status,
      `${url.split("?")[0]} ${response.ok ? "返回的不是有效 JSON" : `请求失败（HTTP ${response.status}，响应不是有效 JSON）`}`,
    );
  }
  if (!response.ok) {
    throw new DataApiRequestError(
      response.status,
      formatDataApiError(url, response.status, payload),
      dataApiErrorCode(payload),
    );
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.code}`)
      .join("；");
    throw new DataApiRequestError(
      response.status,
      `${url.split("?")[0]} 返回数据不符合接口 Schema：${issues}`,
    );
  }
  return parsed.data;
}

const briefingProgressSchema = z.union([
  z.object({ type: z.enum(["status", "reset"]), text: z.string() }),
  z.object({ type: z.literal("summary"), id: z.string(), text: z.string() }),
]);

export async function generateMarketBriefing(
  reportDate: string,
  signal?: AbortSignal,
  onProgress?: (event: MarketBriefingProgress) => void,
): Promise<MarketBriefing> {
  const query = new URLSearchParams({ date: reportDate });
  const url = `/api/market-briefing?${query}`;
  const response = await fetch(url, {
    method: "POST", signal, credentials: "same-origin",
    headers: { Accept: "text/event-stream" },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new DataApiRequestError(response.status, formatDataApiError(url, response.status, payload));
  }
  if (!response.headers.get("content-type")?.includes("text/event-stream"))
    return marketBriefingSchema.parse(await response.json());
  if (!response.body) throw new Error("生成连接未建立，请重试");
  let result: MarketBriefing | undefined;
  await readSse(response.body, ({ event, data }) => {
    signal?.throwIfAborted();
    if (event === "ping") return;
    const payload: unknown = JSON.parse(data);
    if (event === "progress") onProgress?.(briefingProgressSchema.parse(payload));
    if (event === "complete") result = marketBriefingSchema.parse(payload);
    if (event === "error") {
      const error = z.object({ error: z.string() }).parse(payload);
      throw new Error(error.error);
    }
  }, 2 * 1024 * 1024);
  signal?.throwIfAborted();
  if (!result || result.report_date !== reportDate) throw new Error("生成连接中断，请重试");
  return result;
}

export async function fetchReport(
  reportDate: string,
  _refresh: boolean,
  signal?: AbortSignal,
  _currentDate = currentReportDate(),
): Promise<MarketReportLoadResult> {
  const query = reportDate ? `?${new URLSearchParams({ date: reportDate })}` : "";
  const report = await getJson(`/api/market-report${query}`, marketReportSnapshotSchema, signal);
  if (reportDate && report.report_date !== reportDate) throw new Error("报告日期与请求日期不一致");
  if (!report.finalized_at) throw new Error(`${report.report_date} 市场点评尚未生成，请稍后刷新`);
  return { report, resourceIssues: [] };
}

export async function saveMarketReport(
  report: ReportData,
  focusText: string,
  signal?: AbortSignal,
): Promise<MarketReportSnapshot> {
  const parsedReport = reportDataSchema.strip().parse(report);
  const query = new URLSearchParams({ date: parsedReport.report_date });
  const payload = await getJson(
    `/api/market-report?${query}`,
    marketReportSnapshotSchema,
    signal,
    "PUT",
    { report: parsedReport, focusText },
  );
  return marketReportSnapshotSchema.parse(payload);
}
