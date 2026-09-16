import { knownMarketClosure } from "../src/lib/server/market-calendar.ts";
import type { WorkflowStep } from "cloudflare:workers";
import { industrySnapshotSchema } from "../src/data-contracts.ts";
import { reportDataSchema } from "../src/market-report.ts";
import { currentReportDate } from "../src/report-date.ts";
import { fetchDataJson, generateMarketBriefing } from "../src/lib/server/market-briefing.ts";
import { collectMarketReport, MARKET_DATA_STEP_OPTIONS } from "./market-report-collector.ts";
import { saveMarketReport } from "../src/lib/server/market-report.ts";
import { sendMarketBriefingResult } from "../src/lib/server/market-briefing-email.ts";

import type { MarketBriefingParams } from "../src/lib/market-briefing-types.ts";
export type { MarketBriefingParams } from "../src/lib/market-briefing-types.ts";
export const MARKET_BRIEFING_CRON = "0 9 * * MON-FRI";

export async function startMarketBriefing(env: Env, scheduledTime: number) {
  const reportDate = currentReportDate(new Date(scheduledTime));
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
  dependencies = { collectMarketReport, generateMarketBriefing, saveMarketReport, sendMarketBriefingResult },
) {
  const { reportDate } = params;
  let result: { finalizedAt: string | null; focus: string };
  try {
    const industry = await step.do("trading-day", MARKET_DATA_STEP_OPTIONS, async () => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)
        || new Date(`${reportDate}T00:00:00Z`).toISOString().slice(0, 10) !== reportDate) throw new Error("报告日期无效");
      // The live-only sources cannot replay earlier days. Never label current trades as history.
      if (currentReportDate() !== reportDate) throw new Error("仅支持生成当日市场点评，历史行情不可回放");
      if (knownMarketClosure(reportDate) === true) return null;
      const industry = await fetchDataJson(env,
        `https://data.internal/data/industry?date=${reportDate}&fields=dataDate,equities,industries,turnoverYi,turnoverChangeYi,tradingDates`,
        industrySnapshotSchema);
      if (!industry.tradingDates.includes(reportDate)) throw new Error("当日行情尚未更新或交易日历未确认，请重试");
      return industry;
    });
    if (!industry) return { reportDate, status: "skipped", reason: "非交易日" };

    // allSettled waits for every durable branch, including its configured retries.
    const branches = await Promise.allSettled([
      dependencies.collectMarketReport(env, step, reportDate, industry),
      step.do("generate-focus", {
        retries: { limit: 2, delay: "1 minute", backoff: "exponential" }, timeout: "15 minutes",
      }, () => dependencies.generateMarketBriefing(env, reportDate)),
    ]);
    const failures = branches.filter(branch => branch.status === "rejected");
    if (failures.length) throw new Error(failures.map(branch => String(branch.reason instanceof Error ? branch.reason.message : branch.reason)).join("；"));
    const [report, focus] = branches;
    if (report.status !== "fulfilled" || focus.status !== "fulfilled") throw new Error("市场点评数据不完整");
    result = await step.do("aggregate-and-save-r2", MARKET_DATA_STEP_OPTIONS, async () => {
      const snapshot = await dependencies.saveMarketReport(env.EASTMONEY, reportDate,
        reportDataSchema.parse(report.value), `1、${focus.value.stock}\n2、${focus.value.bond}`);
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
