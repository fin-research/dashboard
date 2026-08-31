import {
  marketReportFinalizationSchema,
  marketReportSnapshotSchema,
  reportDataSchema,
} from "./market-report.ts";
import {
  bondCodesFromPayloads,
  buildReportData,
  dayOffset,
  previousTradingDate,
} from "./market-report-resources.ts";
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
  _refresh: boolean,
  signal?: AbortSignal,
): Promise<MarketReportSnapshot> {
  const query = new URLSearchParams({ date: reportDate });
  const omoQuery = new URLSearchParams({
    startDate: dayOffset(reportDate, -35),
    endDate: reportDate,
  });
  const industryPromise = getJson<unknown>(`/data/industry?${query}`, signal);
  const primaryPromise = industryPromise.then(async (industry) => {
    const previousDate = previousTradingDate(industry, reportDate);
    const primaryQuery = new URLSearchParams({
      date: reportDate,
      startDate: previousDate,
    });
    return {
      previousDate,
      payload: await getJson<unknown>(`/data/primary-issues?${primaryQuery}`, signal),
    };
  });
  const todayTradesPromise = getJson<unknown>(
    "/data/today-trades?limit=300",
    signal,
  );
  const favoriteQuotesPromise = getJson<unknown>(
    "/data/favorite-quotes?limit=100",
    signal,
  );
  const bondInfosPromise = Promise.all([
    todayTradesPromise,
    favoriteQuotesPromise,
  ]).then(([todayTrades, favoriteQuotes]) => {
    const codes = bondCodesFromPayloads(todayTrades, favoriteQuotes);
    if (codes.length === 0) return { data: [] };
    const bondQuery = new URLSearchParams({ codes: codes.join(",") });
    return getJson<unknown>(`/data/bond-infos?${bondQuery}`, signal);
  });

  const [
    omoPayload,
    drPayload,
    diboPayload,
    governmentPayload,
    futuresPayload,
    stockPayload,
    marginPayload,
    industryPayload,
    primaryResult,
    todayTradesPayload,
    favoriteQuotesPayload,
    bondInfosPayload,
    stored,
  ] = await Promise.all([
    getJson<unknown>(`/data/omo?${omoQuery}`, signal),
    getJson<unknown>(`/data/cfets?date=${reportDate}&source=DR`, signal),
    getJson<unknown>(`/data/cfets?date=${reportDate}&source=DIBO`, signal),
    getJson<unknown>(`/data/bond-top-case?${query}`, signal),
    getJson<unknown>("/data/futures-latest", signal),
    getJson<unknown>(`/data/stock-summary?${query}`, signal),
    getJson<unknown>(`/data/margin?${query}`, signal),
    industryPromise,
    primaryPromise,
    todayTradesPromise,
    favoriteQuotesPromise,
    bondInfosPromise,
    readStoredSnapshot(reportDate, signal),
  ]);

  const generatedAt = new Date().toISOString();
  const report = reportDataSchema.parse(
    buildReportData({
      reportDate,
      generatedAt,
      previousPrimaryDate: primaryResult.previousDate,
      omo: omoPayload,
      dr: drPayload,
      dibo: diboPayload,
      governmentBonds: governmentPayload,
      futures: futuresPayload,
      stock: stockPayload,
      margin: marginPayload,
      industry: industryPayload,
      primary: primaryResult.payload,
      todayTrades: todayTradesPayload,
      favoriteQuotes: favoriteQuotesPayload,
      bondInfos: bondInfosPayload,
    }),
  );
  return marketReportSnapshotSchema.parse({
    ...report,
    focus_text: stored?.focus_text ?? "",
    cached_at: stored?.cached_at ?? generatedAt,
    finalized_at: stored?.finalized_at ?? null,
  });
}

async function readStoredSnapshot(
  reportDate: string,
  signal?: AbortSignal,
): Promise<{
  focus_text: string;
  cached_at: string;
  finalized_at: string | null;
} | null> {
  const query = new URLSearchParams({ date: reportDate });
  const response = await fetch(`/api/market-report?${query}`, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (response.status === 404 || !response.ok) return null;
  try {
    return marketReportFinalizationSchema.parse(await response.json());
  } catch {
    return null;
  }
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
