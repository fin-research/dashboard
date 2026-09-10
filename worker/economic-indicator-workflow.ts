import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import type { EconomicIndicatorSyncParams } from "../src/lib/server/economic-indicator-sync.ts";
import { persistEconomicIndicators } from "../src/lib/server/economic-indicators-repository.ts";
import { requestEconomicIndicatorData } from "../src/lib/server/economic-indicator-request.ts";
import { withPostgres } from "../src/lib/server/postgres.ts";
import { runEconomicIndicatorSync } from "./economic-indicator-run.ts";
export type { EconomicIndicatorSyncResult } from "./economic-indicator-run.ts";

export class EconomicIndicatorSyncWorkflow extends WorkflowEntrypoint<Cloudflare.Env, EconomicIndicatorSyncParams> {
  async run(event: Readonly<WorkflowEvent<EconomicIndicatorSyncParams>>, step: WorkflowStep) {
    const scheduledTime = event.payload?.scheduledTime ?? event.schedule?.scheduledTime ?? event.timestamp.getTime();
    const result = await runEconomicIndicatorSync(step, event.instanceId, scheduledTime,
      (path, parameters) => requestEconomicIndicatorData(this.env.DATA, path, parameters),
      (rows) => withPostgres(this.env.HYPERDRIVE?.connectionString, "eastmoney-edb-workflow",
        (client) => persistEconomicIndicators(client, rows)));
    if (result.status === "failed") {
      // All branches have settled and the durable summary is already saved.
      throw new Error(JSON.stringify(result));
    }
    return result;
  }
}
