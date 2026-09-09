import svelteKitWorker from "../.svelte-kit/cloudflare/_worker.js";
import { runEconomicIndicatorScheduledSync } from "./economic-indicator-scheduled.ts";
import { creditAssistantHttp } from "./credit-assistant-http.ts";
import { dashboardAccessFailure } from '../src/lib/server/dashboard-access.ts';
import { authorizeRequest } from '../src/lib/server/authorization.ts';
import { WorkerEntrypoint } from 'cloudflare:workers';

/** Data calls this private entrypoint; HTTP headers cannot select or bypass it. */
export class Authorization extends WorkerEntrypoint<Cloudflare.Env> {
  override async fetch(request: Request): Promise<Response> {
    try {
      await authorizeRequest(request, this.env, '/data/[...path]');
      return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store, private' } });
    } catch (error) { return dashboardAccessFailure(request, error); }
  }
}

export { BondLedgerImportWorkflow } from "./bond-ledger-workflow.ts";
export { EconomicIndicatorSyncWorkflow } from "./economic-indicator-workflow.ts";
export { CreditAgent } from "./credit-agent.ts";
export { DebtImportWorkflow } from './financing-debt-import.ts';

const worker: ExportedHandler<Cloudflare.Env> = {
  async fetch(request, env, context) {
    if (new URL(request.url).pathname.startsWith("/api/credit-assistant/")) {
      try {
        const route = new URL(request.url).pathname.replace(/\/files\/[a-f0-9]{24}$/, '/files/[id]');
        const { user } = await authorizeRequest(request, env, route);
        return await creditAssistantHttp(request, env, user);
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
