import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { runMarketBriefing, type MarketBriefingParams } from "./market-briefing-runner.ts";

export class MarketBriefingWorkflow extends WorkflowEntrypoint<Env, MarketBriefingParams> {
  async run(event: Readonly<WorkflowEvent<MarketBriefingParams>>, step: WorkflowStep) {
    return await runMarketBriefing(this.env, step, event.payload);
  }
}

import type { MarketBriefingNewsBatchParams } from "../src/lib/market-briefing-types.ts";
import { runMarketBriefingNewsBatch } from "./market-briefing-news-runner.ts";

export class MarketBriefingNewsBatchWorkflow extends WorkflowEntrypoint<Env, MarketBriefingNewsBatchParams> {
  async run(event: Readonly<WorkflowEvent<MarketBriefingNewsBatchParams>>, step: WorkflowStep) {
    return runMarketBriefingNewsBatch(this.env, step, event.payload);
  }
}
