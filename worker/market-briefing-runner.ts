import { knownMarketClosure } from "../src/lib/server/market-calendar.ts";
import type { WorkflowStep } from "cloudflare:workers";
import { industrySnapshotSchema, stockSummarySchema } from "../src/data-contracts.ts";
import { buildReportData } from "../src/market-report-resources.ts";
import { reportDataSchema } from "../src/market-report.ts";
import { currentReportDate } from "../src/report-date.ts";
import { completeAll, fetchBriefingNews, generateMarketBriefingFromNews } from "../src/lib/server/market-briefing.ts";
import { collectMarketReport, createMarketDataLoader, MARKET_DATA_STEP_OPTIONS } from "./market-report-collector.ts";
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

/** Durable orchestration is separate from its runtime entrypoint for behavioral tests. */
export async function runMarketBriefing(
  env: Env,
  step: WorkflowStep,
  params: MarketBriefingParams,
  instanceId: string,
  dependencies = { generateMarketBriefingFromNews, saveMarketReport, sendMarketBriefingResult },
) {
  const { reportDate } = params;
  let result: { finalizedAt: string | null; focus: string };
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)
      || new Date(`${reportDate}T00:00:00Z`).toISOString().slice(0, 10) !== reportDate) throw new Error("报告日期无效");
    if (knownMarketClosure(reportDate) === true) return { reportDate, status: "skipped", reason: "非交易日" };

    const load = createMarketDataLoader(env, step, reportDate);
    const industry = load("industry",
      `industry?date=${reportDate}&fields=dataDate,equities,industries,turnoverYi,turnoverChangeYi,tradingDates`,
      industrySnapshotSchema, snapshot => {
        if (!snapshot.tradingDates.includes(reportDate)) throw new Error("当日行情尚未更新或交易日历未确认，请重试");
      });
    const stock = load("stock", `stock-summary?date=${reportDate}&fields=title,time,paragraphs`, stockSummarySchema);
    const [resources, focus] = await completeAll([
      collectMarketReport(load, reportDate, industry, stock),
      fetchBriefingNews(env, reportDate, undefined, { stock, load }).then(news =>
        step.do("generate-focus", {
          retries: { limit: 2, delay: "1 minute", backoff: "exponential" }, timeout: "15 minutes",
        }, () => dependencies.generateMarketBriefingFromNews(env, reportDate, news, { retry: false }))),
    ]);
    result = await step.do("aggregate-and-save-r2", MARKET_DATA_STEP_OPTIONS, async () => {
      const snapshot = await dependencies.saveMarketReport(env.EASTMONEY, reportDate,
        reportDataSchema.parse(buildReportData({ ...resources, generatedAt: new Date().toISOString() })),
        `1、${focus.stock}\n2、${focus.bond}`);
      return { finalizedAt: snapshot.finalized_at, focus: snapshot.focus_text };
    });
  } catch (error) {
    try {
      await step.do("notify-failure", MARKET_DATA_STEP_OPTIONS, () => dependencies.sendMarketBriefingResult(env, {
        reportDate, instanceId, status: "failed", detail: "数据获取、AI生成或归档未完成。请检查 Workflow 失败步骤后重试。",
      }));
    } catch (notificationError) {
      console.error(JSON.stringify({ event: "market_briefing_failure_notification_failed", instanceId,
        error: notificationError instanceof Error ? notificationError.message : String(notificationError) }));
    }
    throw error;
  }
  // Notification failures leave the archived report intact and fail only this step.
  const notification = await step.do("notify-success", MARKET_DATA_STEP_OPTIONS, () => dependencies.sendMarketBriefingResult(env, {
    reportDate, instanceId, status: "success", detail: `报告已归档。\n\n${result.focus}`,
  }));
  return { reportDate, status: "complete", finalizedAt: result.finalizedAt, notification };
}
