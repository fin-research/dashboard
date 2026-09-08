import svelteKitWorker from "../.svelte-kit/cloudflare/_worker.js";
import { runEconomicIndicatorScheduledSync } from "./economic-indicator-scheduled.ts";
import { creditAssistantHttp } from "./credit-assistant-http.ts";
import { dashboardAccessFailure, dashboardIdentity, requireSameOrigin } from '../src/lib/server/dashboard-access.ts';

export { BondLedgerImportWorkflow } from "./bond-ledger-workflow.ts";
export { EconomicIndicatorSyncWorkflow } from "./economic-indicator-workflow.ts";
export { CreditAgent } from "./credit-agent.ts";
export { DebtImportWorkflow } from './financing-debt-import.ts';

const worker: ExportedHandler<Cloudflare.Env> = {
  async fetch(request, env, context) {
    if (new URL(request.url).pathname.startsWith("/api/credit-assistant/")) {
      try {
        await dashboardIdentity(request, env);
        if (String(env.ACCESS_MODE) === 'enforce') requireSameOrigin(request);
        return await creditAssistantHttp(request, env);
      } catch (error) {
        return dashboardAccessFailure(request, error);
      }
    }
    return svelteKitWorker.fetch(request, env, context);
  },
  scheduled(controller, env, context) {
    if (controller.cron === '0 * * * *') {
      context.waitUntil(import('../src/lib/server/financing/reminder-scheduler.js')
        .then(({ runScheduledReminderCheck }) => runScheduledReminderCheck({ scheduledTime: controller.scheduledTime, env }))
        .then(summary => { console.log(JSON.stringify(summary)); }));
      return;
    }
    controller.noRetry();
    context.waitUntil(
      runEconomicIndicatorScheduledSync(env, controller.scheduledTime),
    );
  },
};

export default worker;
