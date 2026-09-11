import { z } from "zod";
import { readSse } from "./lib/sse.ts";

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
import { currentReportDate } from "./report-date.ts";
import {
  buildReportData,
  dayOffset,
  previousTradingDate,
  referencedBondCodes,
} from "./market-report-resources.ts";
import type {
  MarketBriefing,
  MarketBriefingProgress,
  MarketReportLoadResult,
  MarketReportResource,
  MarketReportResourceIssue,
  MarketReportSnapshot,
  ReportData,
} from "./types";

const RESOURCE_ORDER: MarketReportResource[] = [
  "omo",
  "fundingDr",
  "fundingDibo",
  "governmentBonds",
  "futures",
  "stock",
  "margin",
  "industry",
  "primary",
  "todayTrades",
  "favoriteQuotes",
  "bondInfos",
];

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

async function recoverResource<T>(
  issues: MarketReportResourceIssue[],
  resource: MarketReportResource,
  label: string,
  load: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    issues.push({
      resource,
      label,
      detail: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
}

function addHistoricalUnavailable(
  issues: MarketReportResourceIssue[],
  resource: MarketReportResource,
  label: string,
): void {
  issues.push({
    resource,
    label,
    detail: `${label}不支持历史日期回溯`,
  });
}

function sortResourceIssues(
  issues: MarketReportResourceIssue[],
): MarketReportResourceIssue[] {
  return [...issues].sort(
    (left, right) =>
      RESOURCE_ORDER.indexOf(left.resource) -
      RESOURCE_ORDER.indexOf(right.resource),
  );
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
  currentDate = currentReportDate(),
): Promise<MarketReportLoadResult> {
  const resourceIssues: MarketReportResourceIssue[] = [];
  let historicalFallback = false;
  if (reportDate < currentDate) {
    const query = new URLSearchParams({ date: reportDate });
    try {
      return {
        report: await getJson(
          `/api/market-report?${query}`,
          marketReportSnapshotSchema,
          signal,
        ),
        resourceIssues,
      };
    } catch (error) {
      if (
        !(error instanceof DataApiRequestError)
        || error.status !== 404
        || error.code !== "REPORT_NOT_FINALIZED"
      ) {
        throw error;
      }
      historicalFallback = true;
    }
  }

  const omoQuery = new URLSearchParams({
    startDate: dayOffset(reportDate, -35),
    endDate: reportDate,
    fields: "operationDate,operationName,duration,interestRate,operationAmount",
  });
  const industryQuery = new URLSearchParams({
    date: reportDate,
    fields: "dataDate,equities,industries,turnoverYi,turnoverChangeYi,tradingDates",
  });
  const industryPromise = recoverResource(
    resourceIssues,
    "industry",
    "权益与行业行情",
    () => getJson(
      `/data/industry?${industryQuery}`,
      industrySnapshotSchema,
      signal,
    ),
    {
      dataDate: reportDate,
      equities: [],
      industries: [],
      turnoverYi: null,
      turnoverChangeYi: null,
      tradingDates: [],
    },
  );
  const stockPromise = recoverResource(
    resourceIssues,
    "stock",
    "A股收评",
    () => getJson(
      `/data/stock-summary?date=${reportDate}&fields=title,time,paragraphs`,
      stockSummarySchema,
      signal,
    ),
    { title: "", time: null, paragraphs: [] },
  );
  const primaryPromise = industryPromise.then(async (industry) => {
    return recoverResource(
      resourceIssues,
      "primary",
      "一级发行",
      async () => {
        const previousDate = previousTradingDate(industry, reportDate);
        const primaryQuery = new URLSearchParams({
          date: reportDate,
          startDate: previousDate ?? reportDate,
          fields: [
            "bidStartDate", "issueStartDate", "biddingTime", "comShortName",
            "issuerShortName", "issuerShortNameCn", "comFullName", "issuerName",
            "publicOffering", "publicOfferingText", "offeringType", "issueWay",
            "raisingMode", "bondTypeText", "bondShortName", "issueTenor",
            "planIssueAmount", "issueCouponRate",
          ].join(","),
        });
        return {
          previousDate: previousDate ?? "",
          payload: await getJson(
            `/data/primary-issues?${primaryQuery}`,
            primaryIssuesSchema,
            signal,
          ),
        };
      },
      { previousDate: "", payload: [] },
    );
  });
  if (historicalFallback) {
    addHistoricalUnavailable(resourceIssues, "futures", "国债期货");
    addHistoricalUnavailable(resourceIssues, "todayTrades", "当日债券成交");
    addHistoricalUnavailable(resourceIssues, "favoriteQuotes", "东财债券报价");
  }
  const todayTradesPromise = historicalFallback
    ? Promise.resolve([])
    : recoverResource(
        resourceIssues,
        "todayTrades",
        "当日债券成交",
        () => getJson(
          "/data/today-trades?limit=300&fields=bondUniCode,remainingTenor,cbYte,tradeYield,tradeYieldSubCb",
          todayTradesSchema,
          signal,
        ),
        [],
      );
  const favoriteQuotesPromise = historicalFallback
    ? Promise.resolve([])
    : recoverResource(
        resourceIssues,
        "favoriteQuotes",
        "东财债券报价",
        () => getJson(
          "/data/favorite-quotes?limit=100&fields=bondUniCode,bondShortName,remainingTenor,remainingTenorDay,cbYield,bidYield,bidEntryPrice,ofrYield,ofrEntryPrice,tradeEntryPrice,tradeYieldSubCb",
          favoriteQuotesSchema,
          signal,
        ),
        [],
      );
  const bondInfosPromise = Promise.all([
    todayTradesPromise,
    favoriteQuotesPromise,
  ]).then(([todayTrades, favoriteQuotes]) => {
    const codes = referencedBondCodes(todayTrades, favoriteQuotes);
    if (codes.length === 0) return [];
    const bondQuery = new URLSearchParams({
      codes: codes.join(","),
      fields: "bondUniCode,bondShortName,comShortName,bondType,bondOfferingType,sciTechInnoBondStatus",
    });
    return recoverResource(
      resourceIssues,
      "bondInfos",
      "债券基础信息",
      () => getJson(`/data/bond-infos?${bondQuery}`, bondInfosSchema, signal),
      [],
    );
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
    recoverResource(
      resourceIssues,
      "omo",
      "公开市场操作",
      () => getJson(`/data/omo?${omoQuery}`, omoOperationsSchema, signal),
      [],
    ),
    recoverResource(
      resourceIssues,
      "fundingDr",
      "DR资金利率",
      () => getJson(
        `/data/cfets?date=${reportDate}&source=DR&fields=bondCode,weightedYield,weightedYieldUpDownValueBp`,
        cfetsRatesSchema,
        signal,
      ),
      [],
    ),
    recoverResource(
      resourceIssues,
      "fundingDibo",
      "同业拆借利率",
      () => getJson(
        `/data/cfets?date=${reportDate}&source=DIBO&fields=bondCode,weightedYield,weightedYieldUpDownValueBp`,
        cfetsRatesSchema,
        signal,
      ),
      [],
    ),
    recoverResource(
      resourceIssues,
      "governmentBonds",
      "利率债成交",
      () => getJson(
        `/data/bond-top-case?date=${reportDate}&fields=ordinateName,abscissaName,bondCode,tradeNum,yield,yieldSubYtdCloseBp`,
        governmentBondsSchema,
        signal,
      ),
      [],
    ),
    historicalFallback
      ? Promise.resolve([])
      : recoverResource(
          resourceIssues,
          "futures",
          "国债期货",
          () => getJson(
            "/data/futures-latest?fields=contractCode,lastPrice,upDownValuePct",
            futuresQuotesSchema,
            signal,
          ),
          [],
        ),
    stockPromise,
    recoverResource(
      resourceIssues,
      "margin",
      "融资融券",
      () => getJson(
        `/data/margin?date=${reportDate}&fields=DIM_DATE,TOTAL_RZRQYE,TOTAL_RZYE,TOTAL_RQYE`,
        marginBalancesSchema,
        signal,
      ),
      [],
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
  return {
    report: marketReportSnapshotSchema.parse({
      ...report,
      focus_text: "",
      cached_at: generatedAt,
      finalized_at: null,
    }),
    resourceIssues: sortResourceIssues(resourceIssues),
  };
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
