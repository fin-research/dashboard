import type { z } from "zod";
import type { WorkflowStep } from "cloudflare:workers";
import { knownMarketClosure } from "../src/lib/server/market-calendar.ts";
import {
  bondInfosSchema, cfetsRatesSchema, favoriteQuotesSchema, futuresQuotesSchema,
  governmentBondsSchema, industrySnapshotSchema, marginBalancesSchema, omoOperationsSchema,
  primaryIssuesSchema, stockSummarySchema, todayTradesSchema,
} from "../src/data-contracts.ts";
import { buildReportData, dayOffset, previousTradingDate, referencedBondCodes } from "../src/market-report-resources.ts";
import { reportDataSchema } from "../src/market-report.ts";
import { currentReportDate } from "../src/report-date.ts";
import {
  briefingNewsResponseSchema, briefingNewsDetailSchema, buildBriefingNews,
  fetchDataJson, generateMarketBriefingFromNews,
} from "../src/lib/server/market-briefing.ts";
import { saveMarketReport } from "../src/lib/server/market-report.ts";
import { sendMarketBriefingResult } from "../src/lib/server/market-briefing-email.ts";

import type { MarketBriefingParams } from "../src/lib/market-briefing-types.ts";
export type { MarketBriefingParams } from "../src/lib/market-briefing-types.ts";
export const MARKET_BRIEFING_CRON = "0 9 * * MON-FRI";

export async function startMarketBriefing(env: Env, scheduledTime: number) {
  const reportDate = currentReportDate(new Date(scheduledTime));
  if (knownMarketClosure(reportDate) === true) return;
  const id = `market-briefing-${reportDate}`;
  // create is atomic by ID; get only confirms a duplicate after an uncertain create.
  try { return await env.MARKET_BRIEFING.create({ id, params: { reportDate } }); }
  catch (error) {
    try {
      const instance = await env.MARKET_BRIEFING.get(id);
      await instance.status();
      return instance;
    } catch { throw error; }
  }
}

const DATA_STEP_OPTIONS = {
  retries: { limit: 3, delay: "30 seconds", backoff: "exponential" }, timeout: "3 minutes",
} as const;

/** Every durable step and its dependencies are visible here. */
export async function runMarketBriefing(
  env: Env,
  step: WorkflowStep,
  params: MarketBriefingParams,
  instanceId: string,
  dependencies = { generateMarketBriefingFromNews, saveMarketReport, sendMarketBriefingResult },
) {
  const { reportDate } = params;

  let outcome: PromiseSettledResult<{ finalizedAt: string | null; focus: string }>;
  try {
    // Native awaited batches are also the dependency boundaries used by Cloudflare's diagram parser.
    const sources = await Promise.allSettled([
      step.do("fetch-industry", DATA_STEP_OPTIONS, async () => {
        const snapshot = await fetchReportData(env, reportDate,
          `industry?date=${reportDate}&fields=dataDate,equities,industries,turnoverYi,turnoverChangeYi,tradingDates`, industrySnapshotSchema);
        if (!snapshot.tradingDates.includes(reportDate)) throw new Error("当日行情尚未更新或交易日历未确认，请重试");
        return snapshot;
      }),
      step.do("fetch-stock", DATA_STEP_OPTIONS, () => fetchReportData(env, reportDate,
        `stock-summary?date=${reportDate}&fields=title,time,paragraphs`, stockSummarySchema)),
      step.do("fetch-omo", DATA_STEP_OPTIONS, () => fetchReportData(env, reportDate,
        `omo?startDate=${dayOffset(reportDate, -35)}&endDate=${reportDate}&fields=operationDate,operationName,duration,interestRate,operationAmount`, omoOperationsSchema)),
      step.do("fetch-funding-dr", DATA_STEP_OPTIONS, () => fetchReportData(env, reportDate,
        `cfets?date=${reportDate}&source=DR&fields=bondCode,weightedYield,weightedYieldUpDownValueBp`, cfetsRatesSchema)),
      step.do("fetch-funding-dibo", DATA_STEP_OPTIONS, () => fetchReportData(env, reportDate,
        `cfets?date=${reportDate}&source=DIBO&fields=bondCode,weightedYield,weightedYieldUpDownValueBp`, cfetsRatesSchema)),
      step.do("fetch-government-bonds", DATA_STEP_OPTIONS, () => fetchReportData(env, reportDate,
        `bond-top-case?date=${reportDate}&fields=ordinateName,abscissaName,bondCode,tradeNum,yield,yieldSubYtdCloseBp`, governmentBondsSchema)),
      step.do("fetch-futures", DATA_STEP_OPTIONS, () => fetchReportData(env, reportDate,
        "futures-latest?fields=contractCode,lastPrice,upDownValuePct", futuresQuotesSchema)),
      step.do("fetch-margin", DATA_STEP_OPTIONS, () => fetchReportData(env, reportDate,
        `margin?date=${reportDate}&fields=DIM_DATE,TOTAL_RZRQYE,TOTAL_RZYE,TOTAL_RQYE`, marginBalancesSchema)),
      step.do("fetch-today-trades", DATA_STEP_OPTIONS, () => fetchReportData(env, reportDate,
        "today-trades?limit=300&fields=bondUniCode,remainingTenor,cbYte,tradeYield,tradeYieldSubCb", todayTradesSchema)),
      step.do("fetch-favorite-quotes", DATA_STEP_OPTIONS, () => fetchReportData(env, reportDate,
        "favorite-quotes?limit=100&fields=bondUniCode,bondShortName,remainingTenor,remainingTenorDay,cbYield,bidYield,bidEntryPrice,ofrYield,ofrEntryPrice,tradeEntryPrice,tradeYieldSubCb", favoriteQuotesSchema)),
      step.do("fetch-news", DATA_STEP_OPTIONS, () => fetchReportData(env, reportDate,
        `news?date=${reportDate}&important=true&pageSize=40&fields=sentimentId,title,time,tags,important`, briefingNewsResponseSchema)),
    ]);
    const industry = stepValue(sources[0]);
    const stock = stepValue(sources[1]);
    const omo = stepValue(sources[2]);
    const dr = stepValue(sources[3]);
    const dibo = stepValue(sources[4]);
    const governmentBonds = stepValue(sources[5]);
    const futures = stepValue(sources[6]);
    const margin = stepValue(sources[7]);
    const todayTrades = stepValue(sources[8]);
    const favoriteQuotes = stepValue(sources[9]);
    const news = stepValue(sources[10]);

    // Primary issues, bond metadata and the first five news details are independent at this point.
    const [primaryResult, bondInfosResult, ...firstDetails] = await Promise.allSettled([
      step.do("fetch-primary", DATA_STEP_OPTIONS, async () => {
        const previousDate = previousTradingDate(industry, reportDate);
        if (!previousDate) throw new Error("上一交易日数据缺失");
        const query = new URLSearchParams({
          date: reportDate, startDate: previousDate,
          fields: ["bidStartDate", "issueStartDate", "biddingTime", "comShortName", "issuerShortName", "issuerShortNameCn",
            "comFullName", "issuerName", "publicOffering", "publicOfferingText", "offeringType", "issueWay", "raisingMode",
            "bondTypeText", "bondShortName", "issueTenor", "planIssueAmount", "issueCouponRate"].join(","),
        });
        const issues = await fetchReportData(env, reportDate, `primary-issues?${query}`, primaryIssuesSchema);
        return { previousDate, issues };
      }),
      step.do("fetch-bond-infos", DATA_STEP_OPTIONS, async () => {
        const codes = referencedBondCodes(todayTrades, favoriteQuotes);
        if (!codes.length) return [];
        const query = new URLSearchParams({ codes: codes.join(","), fields: "bondUniCode,bondShortName,comShortName,bondType,bondOfferingType,sciTechInnoBondStatus" });
        return fetchReportData(env, reportDate, `bond-infos?${query}`, bondInfosSchema);
      }),
      ...news.slice(0, 5).map(summary => step.do(`fetch-news-${summary.sentimentId}`, DATA_STEP_OPTIONS,
        () => fetchReportData(env, reportDate,
          `news/${encodeURIComponent(summary.sentimentId)}?fields=sentimentId,title,time,tags,important,content,link`, briefingNewsDetailSchema))),
    ]);
    const primary = stepValue(primaryResult);
    const bondInfos = stepValue(bondInfosResult);
    const details = firstDetails.map(stepValue);
    for (let offset = 5; offset < news.length; offset += 5) {
      const batch = await Promise.allSettled(news.slice(offset, offset + 5).map(summary =>
        step.do(`fetch-news-${summary.sentimentId}`, DATA_STEP_OPTIONS, () => fetchReportData(env, reportDate,
          `news/${encodeURIComponent(summary.sentimentId)}?fields=sentimentId,title,time,tags,important,content,link`, briefingNewsDetailSchema))));
      details.push(...batch.map(stepValue));
    }
    const newsDetails = details.map((detail, index) => ({ ...news[index], ...detail }));

    const focus = await step.do("generate-focus", {
      retries: { limit: 2, delay: "1 minute", backoff: "exponential" }, timeout: "15 minutes",
    }, () => dependencies.generateMarketBriefingFromNews(env, reportDate,
      buildBriefingNews(stock, newsDetails), { retry: false }));

    const saved = await step.do("aggregate-and-save-r2", DATA_STEP_OPTIONS, async () => {
      const report = reportDataSchema.parse(buildReportData({
        reportDate, generatedAt: new Date().toISOString(), previousPrimaryDate: primary.previousDate,
        industry, stock, omo, dr, dibo, governmentBonds, futures, margin,
        todayTrades, favoriteQuotes, primary: primary.issues, bondInfos,
      }));
      const snapshot = await dependencies.saveMarketReport(env.EASTMONEY, reportDate,
        report, `1、${focus.stock}\n2、${focus.bond}`);
      return { finalizedAt: snapshot.finalized_at, focus: snapshot.focus_text };
    });
    outcome = { status: "fulfilled", value: saved };
  } catch (reason) {
    outcome = { status: "rejected", reason };
  }

  const notification = await step.do("notify-result", DATA_STEP_OPTIONS, () =>
    dependencies.sendMarketBriefingResult(env, {
      reportDate, instanceId,
      status: outcome.status === "fulfilled" ? "success" : "failed",
      detail: outcome.status === "fulfilled"
        ? `报告已归档。\n\n${outcome.value.focus}`
        : "数据获取、AI生成或归档未完成。请检查 Workflow 失败步骤后重试。",
    }));
  // Re-throw the original generation error only after the one terminal notification has finished.
  const result = stepValue(outcome);
  return { reportDate, status: "complete", finalizedAt: result.finalizedAt, notification };
}

function stepValue<T>(result: PromiseSettledResult<T>): T {
  if (result.status === "rejected") throw result.reason;
  return result.value;
}

/** Data validation only: this function never creates, combines or retries Workflow steps. */
async function fetchReportData<T>(env: Env, reportDate: string, path: string, schema: z.ZodType<T>): Promise<T> {
  if (currentReportDate() !== reportDate) throw new Error("采集已跨日，不能混入其他日期的实时行情");
  const data = await fetchDataJson(env, `https://data.internal/data/${path}`, schema);
  if (new TextEncoder().encode(JSON.stringify(data)).byteLength > 900 * 1024) throw new Error("数据超过步骤大小限制");
  return data;
}
