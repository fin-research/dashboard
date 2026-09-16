import type { z } from "zod";
import type { WorkflowStep } from "cloudflare:workers";
import { fetchDataJson } from "../src/lib/server/market-briefing.ts";
import {
  bondInfosSchema, cfetsRatesSchema, favoriteQuotesSchema, futuresQuotesSchema,
  governmentBondsSchema, marginBalancesSchema, omoOperationsSchema,
  primaryIssuesSchema, stockSummarySchema, todayTradesSchema, type IndustrySnapshot,
} from "../src/data-contracts.ts";
import { reportDataSchema } from "../src/market-report.ts";
import { buildReportData, dayOffset, previousTradingDate, referencedBondCodes } from "../src/market-report-resources.ts";
import { currentReportDate } from "../src/report-date.ts";

export const MARKET_DATA_STEP_OPTIONS = {
  retries: { limit: 3, delay: "30 seconds", backoff: "exponential" }, timeout: "3 minutes",
} as const;

/** Wait for all durable branches before propagating an error. */
async function completeAll<T extends readonly unknown[]>(promises: { [K in keyof T]: Promise<T[K]> }): Promise<T> {
  const results = await Promise.allSettled(promises);
  const failure = results.find(result => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  return results.map(result => result.status === "fulfilled" ? result.value : undefined) as unknown as T;
}

export async function collectMarketReport(env: Env, step: WorkflowStep, reportDate: string, industry: IndustrySnapshot) {
  // DTOs consist of JSON data; Zod projects away all unused upstream fields before checkpointing.
  async function load<T extends Rpc.Serializable<T>>(name: string, path: string, schema: z.ZodType<T>): Promise<T> {
    const value = await step.do(`fetch-${name}`, MARKET_DATA_STEP_OPTIONS, async () => {
      if (currentReportDate() !== reportDate) throw new Error("采集已跨日，不能混入其他日期的实时行情");
      const data = await fetchDataJson(env, `https://data.internal/data/${path}`, schema);
      if (new TextEncoder().encode(JSON.stringify(data)).byteLength > 900 * 1024) throw new Error(`${name} 数据超过步骤大小限制`);
      return data;
    });
    return value as T;
  }
  const previousDate = previousTradingDate(industry, reportDate);
  if (!previousDate) throw new Error("上一交易日数据缺失");
  const primaryQuery = new URLSearchParams({
    date: reportDate, startDate: previousDate,
    fields: ["bidStartDate", "issueStartDate", "biddingTime", "comShortName", "issuerShortName", "issuerShortNameCn",
      "comFullName", "issuerName", "publicOffering", "publicOfferingText", "offeringType", "issueWay", "raisingMode",
      "bondTypeText", "bondShortName", "issueTenor", "planIssueAmount", "issueCouponRate"].join(","),
  });
  const todayTrades = load("today-trades", "today-trades?limit=300&fields=bondUniCode,remainingTenor,cbYte,tradeYield,tradeYieldSubCb", todayTradesSchema);
  const favoriteQuotes = load("favorite-quotes", "favorite-quotes?limit=100&fields=bondUniCode,bondShortName,remainingTenor,remainingTenorDay,cbYield,bidYield,bidEntryPrice,ofrYield,ofrEntryPrice,tradeEntryPrice,tradeYieldSubCb", favoriteQuotesSchema);
  const bondInfos = completeAll([todayTrades, favoriteQuotes]).then(([trades, quotes]) => {
    const codes = referencedBondCodes(trades, quotes);
    if (!codes.length) return [];
    const query = new URLSearchParams({ codes: codes.join(","), fields: "bondUniCode,bondShortName,comShortName,bondType,bondOfferingType,sciTechInnoBondStatus" });
    return load("bond-infos", `bond-infos?${query}`, bondInfosSchema);
  });
  const [omo, dr, dibo, governmentBonds, futures, stock, margin, primary, trades, quotes, infos] = await completeAll([
    load("omo", `omo?startDate=${dayOffset(reportDate, -35)}&endDate=${reportDate}&fields=operationDate,operationName,duration,interestRate,operationAmount`, omoOperationsSchema),
    load("funding-dr", `cfets?date=${reportDate}&source=DR&fields=bondCode,weightedYield,weightedYieldUpDownValueBp`, cfetsRatesSchema),
    load("funding-dibo", `cfets?date=${reportDate}&source=DIBO&fields=bondCode,weightedYield,weightedYieldUpDownValueBp`, cfetsRatesSchema),
    load("government-bonds", `bond-top-case?date=${reportDate}&fields=ordinateName,abscissaName,bondCode,tradeNum,yield,yieldSubYtdCloseBp`, governmentBondsSchema),
    load("futures", "futures-latest?fields=contractCode,lastPrice,upDownValuePct", futuresQuotesSchema),
    load("stock", `stock-summary?date=${reportDate}&fields=title,time,paragraphs`, stockSummarySchema),
    load("margin", `margin?date=${reportDate}&fields=DIM_DATE,TOTAL_RZRQYE,TOTAL_RZYE,TOTAL_RQYE`, marginBalancesSchema),
    load("primary", `primary-issues?${primaryQuery}`, primaryIssuesSchema),
    todayTrades, favoriteQuotes, bondInfos,
  ]);
  return step.do("assemble-report", MARKET_DATA_STEP_OPTIONS, async () => reportDataSchema.parse(buildReportData({
    reportDate, generatedAt: new Date().toISOString(), previousPrimaryDate: previousDate,
    omo, dr, dibo, governmentBonds, futures, stock, margin, industry, primary,
    todayTrades: trades, favoriteQuotes: quotes, bondInfos: infos,
  })));
}
