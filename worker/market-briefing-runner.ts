import type { WorkflowStep } from "cloudflare:workers";
import { knownMarketClosure } from "../src/lib/server/market-calendar.ts";
import { currentReportDate } from "../src/report-date.ts";
import { generateMarketBriefingFromNews } from "../src/lib/server/market-briefing.ts";
import {
  collectFocusNews, collectOpenMarket, collectFixedIncome, collectEquity,
  collectPrimary, collectSecondary, collectInventory,
} from "../src/lib/server/market-report-modules.ts";
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
    const modules = await Promise.allSettled([
      step.do("collect-focus-news", { ...DATA_STEP_OPTIONS, timeout: "10 minutes" }, async () => {
        return await collectFocusNews(env, reportDate);
      }),
      step.do("collect-open-market", DATA_STEP_OPTIONS, async () => {
        return await collectOpenMarket(env, reportDate);
      }),
      step.do("collect-fixed-income", DATA_STEP_OPTIONS, async () => {
        return await collectFixedIncome(env, reportDate);
      }),
      step.do("collect-equity", DATA_STEP_OPTIONS, async () => {
        return await collectEquity(env, reportDate);
      }),
      step.do("collect-primary", DATA_STEP_OPTIONS, async () => {
        return await collectPrimary(env, reportDate);
      }),
      step.do("collect-secondary", DATA_STEP_OPTIONS, async () => {
        return await collectSecondary(env, reportDate);
      }),
      step.do("collect-inventory", DATA_STEP_OPTIONS, async () => {
        return await collectInventory(env, reportDate);
      }),
    ]);
    const news = stepValue(modules[0]);
    const report = {
      report_date: reportDate,
      generated_at: new Date().toISOString(),
      ...stepValue(modules[1]),
      ...stepValue(modules[2]),
      ...stepValue(modules[3]),
      ...stepValue(modules[4]),
      ...stepValue(modules[5]),
      ...stepValue(modules[6]),
    };
    const focus = await step.do("generate-focus", {
      retries: { limit: 2, delay: "1 minute", backoff: "exponential" }, timeout: "15 minutes",
    }, () => dependencies.generateMarketBriefingFromNews(env, reportDate, news, { retry: false }));

    const saved = await step.do("archive-report", DATA_STEP_OPTIONS, async () => {
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
