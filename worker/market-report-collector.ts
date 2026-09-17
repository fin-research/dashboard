import type { z } from "zod";
import type { WorkflowStep } from "cloudflare:workers";
import { completeAll, fetchDataJson, type MarketDataLoader } from "../src/lib/server/market-briefing.ts";
import {
  bondInfosSchema, cfetsRatesSchema, favoriteQuotesSchema, futuresQuotesSchema,
  governmentBondsSchema, marginBalancesSchema, omoOperationsSchema,
  primaryIssuesSchema, todayTradesSchema, type IndustrySnapshot, type StockSummary,
} from "../src/data-contracts.ts";
import { dayOffset, previousTradingDate, referencedBondCodes } from "../src/market-report-resources.ts";
import { currentReportDate } from "../src/report-date.ts";

export const MARKET_DATA_STEP_OPTIONS = {
  retries: { limit: 3, delay: "30 seconds", backoff: "exponential" }, timeout: "3 minutes",
} as const;

/** Project DTOs before checkpointing; live requests may not cross the report date. */
export function createMarketDataLoader(env: Env, step: WorkflowStep, reportDate: string): MarketDataLoader {
  return async function load<T>(
    name: string, path: string, schema: z.ZodType<T>, validate?: (value: T) => void,
  ): Promise<T> {
    const value = await step.do(`fetch-${name}`, MARKET_DATA_STEP_OPTIONS, async () => {
      if (currentReportDate() !== reportDate) throw new Error("采集已跨日，不能混入其他日期的实时行情");
      const data = await fetchDataJson(env, `https://data.internal/data/${path}`, schema);
      validate?.(data);
      if (new TextEncoder().encode(JSON.stringify(data)).byteLength > 900 * 1024) throw new Error(`${name} 数据超过步骤大小限制`);
      // Data schemas project JSON DTOs; keep the platform serialization type at this boundary.
      return data as Rpc.Serializable<T>;
    });
    return value as T;
  };
}

/** Independent sources start together; only primary issues and bond metadata wait for dependencies. */
export async function collectMarketReport(
  load: MarketDataLoader, reportDate: string, industry: Promise<IndustrySnapshot>, stock: Promise<StockSummary>,
) {
  const primary = industry.then(snapshot => {
    const previousDate = previousTradingDate(snapshot, reportDate);
    if (!previousDate) throw new Error("上一交易日数据缺失");
    const query = new URLSearchParams({
      date: reportDate, startDate: previousDate,
      fields: ["bidStartDate", "issueStartDate", "biddingTime", "comShortName", "issuerShortName", "issuerShortNameCn",
        "comFullName", "issuerName", "publicOffering", "publicOfferingText", "offeringType", "issueWay", "raisingMode",
        "bondTypeText", "bondShortName", "issueTenor", "planIssueAmount", "issueCouponRate"].join(","),
    });
    return load("primary", `primary-issues?${query}`, primaryIssuesSchema);
  });
  const todayTrades = load("today-trades", "today-trades?limit=300&fields=bondUniCode,remainingTenor,cbYte,tradeYield,tradeYieldSubCb", todayTradesSchema);
  const favoriteQuotes = load("favorite-quotes", "favorite-quotes?limit=100&fields=bondUniCode,bondShortName,remainingTenor,remainingTenorDay,cbYield,bidYield,bidEntryPrice,ofrYield,ofrEntryPrice,tradeEntryPrice,tradeYieldSubCb", favoriteQuotesSchema);
  const bondInfos = completeAll([todayTrades, favoriteQuotes]).then(([trades, quotes]) => {
    const codes = referencedBondCodes(trades, quotes);
    if (!codes.length) return [];
    const query = new URLSearchParams({ codes: codes.join(","), fields: "bondUniCode,bondShortName,comShortName,bondType,bondOfferingType,sciTechInnoBondStatus" });
    return load("bond-infos", `bond-infos?${query}`, bondInfosSchema);
  });
  const [omo, dr, dibo, governmentBonds, futures, stockData, margin, primaryData, trades, quotes, infos, industryData] = await completeAll([
    load("omo", `omo?startDate=${dayOffset(reportDate, -35)}&endDate=${reportDate}&fields=operationDate,operationName,duration,interestRate,operationAmount`, omoOperationsSchema),
    load("funding-dr", `cfets?date=${reportDate}&source=DR&fields=bondCode,weightedYield,weightedYieldUpDownValueBp`, cfetsRatesSchema),
    load("funding-dibo", `cfets?date=${reportDate}&source=DIBO&fields=bondCode,weightedYield,weightedYieldUpDownValueBp`, cfetsRatesSchema),
    load("government-bonds", `bond-top-case?date=${reportDate}&fields=ordinateName,abscissaName,bondCode,tradeNum,yield,yieldSubYtdCloseBp`, governmentBondsSchema),
    load("futures", "futures-latest?fields=contractCode,lastPrice,upDownValuePct", futuresQuotesSchema),
    stock,
    load("margin", `margin?date=${reportDate}&fields=DIM_DATE,TOTAL_RZRQYE,TOTAL_RZYE,TOTAL_RQYE`, marginBalancesSchema),
    primary,
    todayTrades, favoriteQuotes, bondInfos, industry,
  ]);
  return {
    reportDate, previousPrimaryDate: previousTradingDate(industryData, reportDate)!,
    omo, dr, dibo, governmentBonds, futures, stock: stockData, margin, industry: industryData, primary: primaryData,
    todayTrades: trades, favoriteQuotes: quotes, bondInfos: infos,
  };
}
