import { z } from "zod";

import {
  DataApiRequestError,
  dataApiErrorCode,
  formatDataApiError,
} from "./data-api-error.ts";

import {
  bondInfosSchema,
  cfetsRatesSchema,
  favoriteQuotesSchema,
  futuresQuotesSchema,
  governmentBondsSchema,
  industrySnapshotSchema,
  marginBalancesSchema,
  omoOperationsSchema,
  primaryIssuesSchema,
  stockSummarySchema,
  todayTradesSchema,
} from "./data-contracts.ts";
import {
  marketReportSnapshotSchema,
  reportDataSchema,
} from "./market-report.ts";
import {
  buildReportData,
  dayOffset,
  previousTradingDate,
  referencedBondCodes,
} from "./market-report-resources.ts";
import type {
  MarketBriefing,
  MarketReportSnapshot,
  ReportData,
} from "./types";

const marketBriefingSchema = z.object({
  report_date: z.string(),
  content: z.string(),
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
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
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

export function generateMarketBriefing(
  reportDate: string,
  signal?: AbortSignal,
): Promise<MarketBriefing> {
  const query = new URLSearchParams({ date: reportDate });
  return getJson(
    `/api/market-briefing?${query}`,
    marketBriefingSchema,
    signal,
    "POST",
  );
}

export async function fetchReport(
  reportDate: string,
  _refresh: boolean,
  signal?: AbortSignal,
): Promise<MarketReportSnapshot> {
  const omoQuery = new URLSearchParams({
    startDate: dayOffset(reportDate, -35),
    endDate: reportDate,
    fields: "operationDate,operationName,duration,interestRate,operationAmount",
  });
  const industryQuery = new URLSearchParams({
    date: reportDate,
    fields: "dataDate,equities,industries,turnoverYi,turnoverChangeYi,tradingDates",
  });
  const industryPromise = getJson(
    `/data/industry?${industryQuery}`,
    industrySnapshotSchema,
    signal,
  );
  const stockPromise = getJson(
    `/data/stock-summary?date=${reportDate}&fields=title,time,paragraphs`,
    stockSummarySchema,
    signal,
  ).catch((error: unknown) => {
    if (
      error instanceof DataApiRequestError
      && error.status === 404
      && error.code === "RESOURCE_NOT_AVAILABLE"
    ) {
      return { title: "", time: null, paragraphs: [] };
    }
    throw error;
  });
  const primaryPromise = industryPromise.then(async (industry) => {
    const previousDate = previousTradingDate(industry, reportDate);
    const primaryQuery = new URLSearchParams({
      date: reportDate,
      startDate: previousDate,
      fields: [
        "bidStartDate", "issueStartDate", "biddingTime", "comShortName",
        "issuerShortName", "issuerShortNameCn", "comFullName", "issuerName",
        "publicOffering", "publicOfferingText", "offeringType", "issueWay",
        "raisingMode", "bondTypeText", "bondShortName", "issueTenor",
        "planIssueAmount", "issueCouponRate",
      ].join(","),
    });
    return {
      previousDate,
      payload: await getJson(
        `/data/primary-issues?${primaryQuery}`,
        primaryIssuesSchema,
        signal,
      ),
    };
  });
  const todayTradesPromise = getJson(
    "/data/today-trades?limit=300&fields=bondUniCode,remainingTenor,cbYte,tradeYield,tradeYieldSubCb",
    todayTradesSchema,
    signal,
  );
  const favoriteQuotesPromise = getJson(
    "/data/favorite-quotes?limit=100&fields=bondUniCode,bondShortName,remainingTenor,remainingTenorDay,cbYield,bidYield,bidEntryPrice,ofrYield,ofrEntryPrice,tradeEntryPrice,tradeYieldSubCb",
    favoriteQuotesSchema,
    signal,
  );
  const bondInfosPromise = Promise.all([
    todayTradesPromise,
    favoriteQuotesPromise,
  ]).then(([todayTrades, favoriteQuotes]) => {
    const codes = referencedBondCodes(todayTrades, favoriteQuotes);
    if (codes.length === 0) return [];
    const bondQuery = new URLSearchParams({
      codes: codes.join(","),
      fields: "bondUniCode,bondShortName,comShortName,bondType,bondOfferingType",
    });
    return getJson(`/data/bond-infos?${bondQuery}`, bondInfosSchema, signal);
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
  ] = await Promise.all([
    getJson(`/data/omo?${omoQuery}`, omoOperationsSchema, signal),
    getJson(
      `/data/cfets?date=${reportDate}&source=DR&fields=bondCode,weightedYield,weightedYieldUpDownValueBp`,
      cfetsRatesSchema,
      signal,
    ),
    getJson(
      `/data/cfets?date=${reportDate}&source=DIBO&fields=bondCode,weightedYield,weightedYieldUpDownValueBp`,
      cfetsRatesSchema,
      signal,
    ),
    getJson(
      `/data/bond-top-case?date=${reportDate}&fields=ordinateName,abscissaName,bondCode,tradeNum,yield,yieldSubYtdCloseBp`,
      governmentBondsSchema,
      signal,
    ),
    getJson(
      "/data/futures-latest?fields=contractCode,lastPrice,upDownValuePct",
      futuresQuotesSchema,
      signal,
    ),
    stockPromise,
    getJson(
      `/data/margin?date=${reportDate}&fields=DIM_DATE,TOTAL_RZRQYE,TOTAL_RZYE,TOTAL_RQYE`,
      marginBalancesSchema,
      signal,
    ),
    industryPromise,
    primaryPromise,
    todayTradesPromise,
    favoriteQuotesPromise,
    bondInfosPromise,
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
    focus_text: "",
    cached_at: generatedAt,
    finalized_at: null,
  });
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
