import svelteKitWorker from "../.svelte-kit/cloudflare/_worker.js";
import { runEconomicIndicatorScheduledSync } from "./economic-indicator-scheduled.ts";

export { BondLedgerImportWorkflow } from "./bond-ledger-workflow.ts";
export { EconomicIndicatorSyncWorkflow } from "./economic-indicator-workflow.ts";

const worker: ExportedHandler<Cloudflare.Env> = {
  fetch: svelteKitWorker.fetch,
  scheduled(controller, env, context) {
    context.waitUntil(
      runEconomicIndicatorScheduledSync(env, controller.scheduledTime),
    );
  },
};

export default worker;
