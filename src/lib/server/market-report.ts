import {
  marketReportObjectKey,
  marketReportSnapshotSchema,
  reportDataSchema,
  type MarketReportSnapshotContract,
  type ReportDataContract,
} from "../../market-report.ts";

const MARKET_REPORT_QUERY = `
  query MarketReport($request: MarketReportInput!) {
    reportDate(request: $request)
    generatedAt(request: $request)
    omoOperations(request: $request) {
      operationDate operationName duration amountYi interestRate
    }
    fundingRates(request: $request) { code rate changeBp }
    governmentBonds(request: $request) {
      category tenor code yieldRate changeBp
    }
    futures(request: $request) { code lastPrice changePct }
    stockParagraphs(request: $request)
    margin(request: $request) {
      dataDate totalBalanceYi totalChangeYi financingBalanceYi
      financingChangeYi securitiesLendingBalanceYi securitiesLendingChangeYi
    }
    equities(request: $request) { name close changePct }
    equityDataTime(request: $request)
    turnoverYi(request: $request)
    turnoverChangeYi(request: $request)
    industries(request: $request) { name changePct marketCapYuan }
    industryDataDate(request: $request)
    primarySummary(request: $request) { currentAmount changeAmount }
    primaryIssues(request: $request) {
      issueDate issueDateKey issuer category bondNames tenors coupons amount
    }
    secondaryBonds(request: $request) {
      bondId bondName issuer tenorLabel tenorYears valuation tradeYield
    }
    inventoryBonds(request: $request) {
      bondName tenorLabel tenorYears valuation tradeYield tradeSpreadBp
      bidYield ofrYield
    }
  }
`;

export class MarketReportStoreError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "MarketReportStoreError";
    this.status = status;
  }
}

type EastmoneyBucket = Env["EASTMONEY"];

export async function loadMarketReport(
  bucket: EastmoneyBucket | undefined,
  dataApiBaseUrl: string | undefined,
  reportDate: string,
  refresh: boolean,
): Promise<MarketReportSnapshotContract> {
  const storage = requireBucket(bucket);
  const key = marketReportObjectKey(reportDate);
  const existing = await readSnapshot(storage, key);
  if (existing && !refresh) return existing;

  const report = await fetchUpstreamReport(dataApiBaseUrl, reportDate, refresh);
  const now = new Date().toISOString();
  const snapshot = marketReportSnapshotSchema.parse({
    ...report,
    focus_text: existing?.focus_text ?? "",
    cached_at: now,
    finalized_at: existing?.finalized_at ?? null,
  });
  await writeSnapshot(storage, key, snapshot);
  return snapshot;
}

export async function saveMarketReport(
  bucket: EastmoneyBucket | undefined,
  reportDate: string,
  report: unknown,
  focusText: unknown,
): Promise<MarketReportSnapshotContract> {
  const storage = requireBucket(bucket);
  let parsedReport: ReportDataContract;
  try {
    parsedReport = reportDataSchema.parse(report);
  } catch {
    throw new MarketReportStoreError(400, "市场点评定稿数据不符合规范契约");
  }
  if (parsedReport.report_date !== reportDate) {
    throw new MarketReportStoreError(400, "报告日期与保存日期不一致");
  }
  if (typeof focusText !== "string") {
    throw new MarketReportStoreError(400, "今日聚焦内容无效");
  }
  const now = new Date().toISOString();
  const snapshot = marketReportSnapshotSchema.parse({
    ...parsedReport,
    focus_text: focusText,
    cached_at: now,
    finalized_at: now,
  });
  await writeSnapshot(storage, marketReportObjectKey(reportDate), snapshot);
  return snapshot;
}

async function fetchUpstreamReport(
  dataApiBaseUrl: string | undefined,
  reportDate: string,
  refresh: boolean,
): Promise<ReportDataContract> {
  const baseUrl = dataApiBaseUrl?.replace(/\/$/, "");
  if (!baseUrl) {
    throw new MarketReportStoreError(503, "Data API 未配置");
  }
  const response = await fetch(`${baseUrl}/graphql`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      query: MARKET_REPORT_QUERY,
      variables: { request: { date: reportDate, refresh } },
    }),
  });
  const payload = (await response.json()) as {
    data?: GraphQLMarketReport;
    errors?: Array<{ message?: string }>;
  };
  if (!response.ok || payload.errors?.length || !payload.data) {
    const message = payload.errors
      ?.map((item) => item.message?.trim())
      .filter(Boolean)
      .join("；");
    throw new MarketReportStoreError(
      response.ok ? 502 : response.status,
      message || "Data API 市场点评读取失败",
    );
  }
  try {
    return reportDataSchema.parse(mapGraphQLReport(payload.data));
  } catch {
    throw new MarketReportStoreError(502, "Data API 市场点评响应不符合规范契约");
  }
}

async function readSnapshot(
  bucket: EastmoneyBucket,
  key: string,
): Promise<MarketReportSnapshotContract | null> {
  const object = await bucket.get(key);
  if (!object) return null;
  try {
    return marketReportSnapshotSchema.parse(await object.json());
  } catch (error) {
    console.error(JSON.stringify({ event: "market_report_cache_invalid", key }));
    return null;
  }
}

async function writeSnapshot(
  bucket: EastmoneyBucket,
  key: string,
  snapshot: MarketReportSnapshotContract,
): Promise<void> {
  const object = await bucket.put(key, JSON.stringify(snapshot), {
    httpMetadata: {
      contentType: "application/json; charset=utf-8",
      cacheControl: "private, no-store",
    },
    customMetadata: {
      reportDate: snapshot.report_date,
      cachedAt: snapshot.cached_at,
      ...(snapshot.finalized_at ? { finalizedAt: snapshot.finalized_at } : {}),
    },
  });
  if (!object) throw new MarketReportStoreError(503, "市场点评写入 R2 失败");
}

function requireBucket(bucket: EastmoneyBucket | undefined): EastmoneyBucket {
  if (!bucket) throw new MarketReportStoreError(503, "East Money R2 未配置");
  return bucket;
}

function mapGraphQLReport(data: GraphQLMarketReport): ReportDataContract {
  return {
    report_date: data.reportDate,
    generated_at: data.generatedAt,
    omo_operations: data.omoOperations.map((item) => ({
      operation_date: item.operationDate,
      operation_name: item.operationName,
      duration: item.duration,
      amount_yi: item.amountYi,
      interest_rate: item.interestRate,
    })),
    funding_rates: data.fundingRates.map((item) => ({
      code: item.code,
      rate: item.rate,
      change_bp: item.changeBp,
    })),
    government_bonds: data.governmentBonds.map((item) => ({
      category: item.category,
      tenor: item.tenor,
      code: item.code,
      yield_rate: item.yieldRate,
      change_bp: item.changeBp,
    })),
    futures: data.futures.map((item) => ({
      code: item.code,
      last_price: item.lastPrice,
      change_pct: item.changePct,
    })),
    stock_paragraphs: data.stockParagraphs,
    margin: {
      data_date: data.margin.dataDate,
      total: data.margin.totalBalanceYi,
      total_change: data.margin.totalChangeYi,
      financing: data.margin.financingBalanceYi,
      financing_change: data.margin.financingChangeYi,
      securities_lending: data.margin.securitiesLendingBalanceYi,
      securities_lending_change: data.margin.securitiesLendingChangeYi,
    },
    equities: data.equities.map((item) => ({
      name: item.name,
      close: item.close,
      change_pct: item.changePct,
    })),
    equity_data_time: data.equityDataTime,
    turnover_yi: data.turnoverYi,
    turnover_change_yi: data.turnoverChangeYi,
    industries: data.industries.map((item) => ({
      name: item.name,
      change_pct: item.changePct,
      market_cap_yuan: item.marketCapYuan,
    })),
    industry_data_date: data.industryDataDate,
    primary_summary: {
      current_amount: data.primarySummary.currentAmount,
      change_amount: data.primarySummary.changeAmount,
    },
    primary_issues: data.primaryIssues.map((item) => ({
      issue_date: item.issueDate,
      issue_date_key: item.issueDateKey,
      issuer: item.issuer,
      category: item.category,
      bond_names: item.bondNames,
      tenors: item.tenors,
      coupons: item.coupons,
      amount: item.amount,
    })),
    secondary_bonds: data.secondaryBonds.map((item) => ({
      bond_id: item.bondId,
      bond_name: item.bondName,
      issuer: item.issuer,
      tenor_label: item.tenorLabel,
      tenor_years: item.tenorYears,
      valuation: item.valuation,
      trade_yield: item.tradeYield,
    })),
    inventory_bonds: data.inventoryBonds.map((item) => ({
      bond_name: item.bondName,
      tenor_label: item.tenorLabel,
      tenor_years: item.tenorYears,
      valuation: item.valuation,
      trade_yield: item.tradeYield,
      trade_spread_bp: item.tradeSpreadBp,
      bid_yield: item.bidYield,
      ofr_yield: item.ofrYield,
    })),
  };
}

type GraphQLMarketReport = {
  reportDate: string;
  generatedAt: string;
  omoOperations: Array<{ operationDate: string; operationName: string; duration: string; amountYi: number | null; interestRate: number | null }>;
  fundingRates: Array<{ code: string; rate: number | null; changeBp: number | null }>;
  governmentBonds: Array<{ category: string; tenor: string; code: string; yieldRate: number | null; changeBp: number | null }>;
  futures: Array<{ code: string; lastPrice: number | null; changePct: number | null }>;
  stockParagraphs: string[];
  margin: { dataDate: string | null; totalBalanceYi: number | null; totalChangeYi: number | null; financingBalanceYi: number | null; financingChangeYi: number | null; securitiesLendingBalanceYi: number | null; securitiesLendingChangeYi: number | null };
  equities: Array<{ name: string; close: number; changePct: number }>;
  equityDataTime: string | null;
  turnoverYi: number | null;
  turnoverChangeYi: number | null;
  industries: Array<{ name: string; changePct: number; marketCapYuan: number }>;
  industryDataDate: string;
  primarySummary: { currentAmount: number; changeAmount: number | null };
  primaryIssues: Array<{ issueDate: string; issueDateKey: string; issuer: string; category: string; bondNames: string[]; tenors: string[]; coupons: Array<number | null>; amount: number }>;
  secondaryBonds: Array<{ bondId: string; bondName: string; issuer: string; tenorLabel: string; tenorYears: number; valuation: number | null; tradeYield: number }>;
  inventoryBonds: Array<{ bondName: string; tenorLabel: string; tenorYears: number; valuation: number; tradeYield: number | null; tradeSpreadBp: number | null; bidYield: number | null; ofrYield: number | null }>;
};
