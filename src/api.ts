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
  _refresh: boolean,
  signal?: AbortSignal,
): Promise<MarketReportSnapshot> {
  const query = new URLSearchParams({ date: reportDate });
  const segment = (name: string) =>
    getJson<unknown>(`/data/market-report/${name}?${query}`, signal);
  const industryPromise = getJson<unknown>(`/data/industry?${query}`, signal);
  const primaryPromise = industryPromise.then(async (payload) => {
    const industry = record(payload, "行业数据");
    const previousDate = strings(industry.tradingDates)
      .filter((date) => date < reportDate)
      .sort()
      .at(-1);
    if (!previousDate) throw new Error("Choice 未返回足够的同业发行交易日");
    const primaryQuery = new URLSearchParams({
      date: reportDate,
      previousDate,
    });
    return getJson<unknown>(
      `/data/market-report/primary?${primaryQuery}`,
      signal,
    );
  });

  const [
    omoPayload,
    fundingPayload,
    governmentPayload,
    futuresPayload,
    stockPayload,
    marginPayload,
    industryPayload,
    primaryPayload,
    secondaryPayload,
    inventoryPayload,
    stored,
  ] = await Promise.all([
    segment("omo"),
    segment("funding"),
    segment("government-bonds"),
    segment("futures"),
    getJson<unknown>(`/data/stock-summary?${query}`, signal),
    segment("margin"),
    industryPromise,
    primaryPromise,
    segment("secondary"),
    segment("inventory"),
    readStoredSnapshot(reportDate, signal),
  ]);

  const omo = record(omoPayload, "公开市场操作");
  const funding = record(fundingPayload, "资金利率");
  const government = record(governmentPayload, "国债行情");
  const futures = record(futuresPayload, "国债期货");
  const stock = record(stockPayload, "A股收评");
  const margin = record(record(marginPayload, "两融数据").margin, "两融数据");
  const industry = record(industryPayload, "行业数据");
  const primary = record(primaryPayload, "一级发行");
  const secondary = record(secondaryPayload, "二级成交");
  const inventory = record(inventoryPayload, "存量券");
  const generatedAt = new Date().toISOString();
  const report = reportDataSchema.parse({
    report_date: reportDate,
    generated_at: generatedAt,
    omo_operations: rows(omo.omoOperations).map((item) => ({
      operation_date: item.operationDate,
      operation_name: item.operationName,
      duration: item.duration,
      amount_yi: item.amountYi,
      interest_rate: item.interestRate,
    })),
    funding_rates: rows(funding.fundingRates).map((item) => ({
      code: item.code,
      rate: item.rate,
      change_bp: item.changeBp,
    })),
    government_bonds: rows(government.governmentBonds).map((item) => ({
      category: item.category,
      tenor: item.tenor,
      code: item.code,
      yield_rate: item.yieldRate,
      change_bp: item.changeBp,
    })),
    futures: rows(futures.futures).map((item) => ({
      code: item.code,
      last_price: item.lastPrice,
      change_pct: item.changePct,
    })),
    stock_paragraphs: strings(stock.paragraphs).slice(0, 2),
    margin: {
      data_date: margin.dataDate,
      total: margin.totalBalanceYi,
      total_change: margin.totalChangeYi,
      financing: margin.financingBalanceYi,
      financing_change: margin.financingChangeYi,
      securities_lending: margin.securitiesLendingBalanceYi,
      securities_lending_change: margin.securitiesLendingChangeYi,
    },
    equities: industry.equities,
    equity_data_time: null,
    turnover_yi: industry.turnoverYi,
    turnover_change_yi: industry.turnoverChangeYi,
    industries: industry.industries,
    industry_data_date: industry.dataDate,
    primary_summary: {
      current_amount: record(primary.primarySummary, "一级发行汇总").currentAmount,
      change_amount: record(primary.primarySummary, "一级发行汇总").changeAmount,
    },
    primary_issues: rows(primary.primaryIssues).map((item) => ({
      issue_date: item.issueDate,
      issue_date_key: item.issueDateKey,
      issuer: item.issuer,
      category: item.category,
      bond_names: item.bondNames,
      tenors: item.tenors,
      coupons: item.coupons,
      amount: item.amount,
    })),
    secondary_bonds: rows(secondary.secondaryBonds).map((item) => ({
      bond_id: item.bondId,
      bond_name: item.bondName,
      issuer: item.issuer,
      tenor_label: item.tenorLabel,
      tenor_years: item.tenorYears,
      valuation: item.valuation,
      trade_yield: item.tradeYield,
    })),
    inventory_bonds: rows(inventory.inventoryBonds).map((item) => ({
      bond_name: item.bondName,
      tenor_label: item.tenorLabel,
      tenor_years: item.tenorYears,
      valuation: item.valuation,
      trade_yield: item.tradeYield,
      trade_spread_bp: item.tradeSpreadBp,
      bid_yield: item.bidYield,
      ofr_yield: item.ofrYield,
    })),
  });
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
): Promise<MarketReportSnapshot | null> {
  const query = new URLSearchParams({ date: reportDate });
  const response = await fetch(`/api/market-report?${query}`, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (response.status === 404 || !response.ok) return null;
  try {
    return marketReportSnapshotSchema.parse(await response.json());
  } catch {
    return null;
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label}响应格式无效`);
  }
  return value as Record<string, unknown>;
}

function rows(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.map((item) => record(item, "市场点评明细"));
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
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
