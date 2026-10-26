import type { WorkflowStep } from "cloudflare:workers";
import type { MarketBriefingNewsBatchParams } from "../src/lib/market-briefing-types.ts";
import { fetchBriefingNewsDetailBatch } from "../src/lib/server/market-briefing.ts";

export async function runMarketBriefingNewsBatch(env: Env, step: WorkflowStep, params: MarketBriefingNewsBatchParams) {
  return step.do("collect-news-details", {
    retries: { limit: 2, delay: "30 seconds", backoff: "exponential" }, timeout: "2 minutes",
  }, () => fetchBriefingNewsDetailBatch(env, params));
}
