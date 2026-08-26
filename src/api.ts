import type {
  MarketBriefing,
  PrimarySummary,
  ReportData,
} from "./types";
import { primaryIssueDetails } from "./primary-issues.ts";

type ReportPayload = Omit<ReportData, "primary_summary"> & {
  primary_summary?: PrimarySummary;
};

type GraphQLMarketReport = {
  reportDate: string;
  generatedAt: string;
  omo: ReportData["omo"];
  rates: ReportData["rates"];
  stockParagraphs: string[];
  margin: ReportData["margin"];
  equities: Array<{
    name: string;
    close: number;
    changePct: number;
  }>;
  equityDataTime: string | null;
  turnoverYi: number | null;
  turnoverChangeYi: number | null;
  industries: Array<{
    name: string;
    changePct: number;
    marketCapYuan: number;
  }>;
  industryDataDate: string;
  primarySummary: {
    currentAmount: number;
    changeAmount: number | null;
  };
  primary: ReportData["primary"];
  secondary: ReportData["secondary"];
  inventory: ReportData["inventory"];
};

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
  detail?: string;
  error?: string;
};

const MARKET_REPORT_QUERY = `
  query MarketReport($date: Date!, $refresh: Boolean!) {
    marketReport(date: $date, refresh: $refresh) {
      reportDate
      generatedAt
      omo
      rates
      stockParagraphs
      margin
      equities {
        name
        close
        changePct
      }
      equityDataTime
      turnoverYi
      turnoverChangeYi
      industries {
        name
        changePct
        marketCapYuan
      }
      industryDataDate
      primarySummary {
        currentAmount
        changeAmount
      }
      primary
      secondary
      inventory
    }
  }
`;

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
    `/api/market-briefing?${query}`,
    signal,
    "POST",
  );
}

export function fetchReport(
  reportDate: string,
  refresh: boolean,
  signal?: AbortSignal,
): Promise<ReportData> {
  return queryGraphQL<{ marketReport: GraphQLMarketReport }>(
    MARKET_REPORT_QUERY,
    { date: reportDate, refresh },
    signal,
  ).then(({ marketReport }) =>
    normalizeReport(reportPayloadFromGraphQL(marketReport)),
  );
}

export function normalizeReport(payload: ReportPayload): ReportData {
  const fallbackAmount = primaryIssueDetails(
    payload.primary,
    payload.report_date,
  )
    .filter((issue) => issue.issue_date_key === payload.report_date)
    .reduce((total, issue) => total + issue.amount, 0);
  return {
    ...payload,
    primary_summary: payload.primary_summary ?? {
      current_amount: fallbackAmount,
      change_amount: null,
    },
  };
}

async function queryGraphQL<T>(
  query: string,
  variables: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch("/data/graphql", {
    method: "POST",
    signal,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = (await response.json()) as GraphQLResponse<T>;
  if (!response.ok) {
    throw new Error(payload.detail || payload.error || "上游数据读取失败");
  }
  if (payload.errors?.length) {
    const messages = payload.errors
      .map((item) => item.message?.trim())
      .filter((item): item is string => Boolean(item));
    throw new Error(messages.join("；") || "市场点评数据读取失败");
  }
  if (!payload.data) throw new Error("市场点评数据响应缺少 data");
  return payload.data;
}

function reportPayloadFromGraphQL(
  report: GraphQLMarketReport,
): ReportPayload {
  return {
    report_date: report.reportDate,
    generated_at: report.generatedAt,
    omo: report.omo,
    rates: report.rates,
    stock_paragraphs: report.stockParagraphs,
    margin: report.margin,
    equities: report.equities.map((item) => ({
      name: item.name,
      close: item.close,
      change_pct: item.changePct,
    })),
    equity_data_time: report.equityDataTime,
    turnover_yi: report.turnoverYi,
    turnover_change_yi: report.turnoverChangeYi,
    industries: report.industries.map((item) => ({
      name: item.name,
      change_pct: item.changePct,
      market_cap_yuan: item.marketCapYuan,
    })),
    industry_data_date: report.industryDataDate,
    primary_summary: {
      current_amount: report.primarySummary.currentAmount,
      change_amount: report.primarySummary.changeAmount,
    },
    primary: report.primary,
    secondary: report.secondary,
    inventory: report.inventory,
  };
}
