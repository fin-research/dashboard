import svelteKitWorker from "../.svelte-kit/cloudflare/_worker.js";
import { runEconomicIndicatorScheduledSync } from "./economic-indicator-scheduled.ts";
import { creditAssistantHttp } from "./credit-assistant-http.ts";

export { BondLedgerImportWorkflow } from "./bond-ledger-workflow.ts";
export { EconomicIndicatorSyncWorkflow } from "./economic-indicator-workflow.ts";
export { CreditAgent } from "./credit-agent.ts";

const worker: ExportedHandler<Cloudflare.Env> = {
  fetch(request, env, context) {
    if (new URL(request.url).pathname.startsWith("/api/credit-assistant/")) return creditAssistantHttp(request, env);
    return svelteKitWorker.fetch(request, env, context);
  },
  scheduled(controller, env, context) {
    controller.noRetry();
    context.waitUntil(
      runEconomicIndicatorScheduledSync(env, controller.scheduledTime),
    );
  },
};

export default worker;
