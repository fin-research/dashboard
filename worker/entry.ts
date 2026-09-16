import { MARKET_BRIEFING_CRON, startMarketBriefing } from "./market-briefing-runner.ts";
import svelteKitWorker from "../.svelte-kit/cloudflare/_worker.js";
import { creditAssistantHttp } from "./credit-assistant-http.ts";
import { dashboardAccessFailure } from '../src/lib/server/dashboard-access.ts';
import { readBindingContext, CONTEXT_HEADER } from '../src/lib/server/gateway-context.ts';
import { WorkerEntrypoint } from 'cloudflare:workers';

/** Only the provisioned Gateway binding can select this entrypoint. */
export class GatewayDashboard extends WorkerEntrypoint<Cloudflare.Env> {
  override async fetch(request: Request): Promise<Response> {
    try {
      const gateway = readBindingContext(request);
      const headers = new Headers(request.headers);
      headers.delete(CONTEXT_HEADER);
      request = new Request(request, { headers });
      const env = { ...this.env, GATEWAY_CONTEXT: gateway };
      if (new URL(request.url).pathname.startsWith('/api/credit-assistant/')) return await creditAssistantHttp(request, env, gateway.user);
      return await svelteKitWorker.fetch(request, env, this.ctx);
    } catch (error) { return dashboardAccessFailure(request, error); }
  }
}

export { MarketBriefingWorkflow } from "./market-briefing-workflow.ts";
export { BondLedgerImportWorkflow } from "./bond-ledger-workflow.ts";
export { CreditAgent } from "./credit-agent.ts";
export { DebtImportWorkflow } from './financing-debt-import.ts';

const worker: ExportedHandler<Cloudflare.Env> = {
  fetch() { return new Response('Not Found', { status: 404 }); },
  scheduled(controller, env, context) {
    if (controller.cron === MARKET_BRIEFING_CRON) {
      context.waitUntil(startMarketBriefing(env, controller.scheduledTime));
      return;
    }
    if (controller.cron === '0 * * * *') {
      context.waitUntil(import('../src/lib/server/financing/reminder-scheduler.js')
        .then(({ runScheduledReminderCheck }) => runScheduledReminderCheck({ scheduledTime: controller.scheduledTime, env }))
        .then(summary => { console.log(JSON.stringify(summary)); }));
      return;
    }
  },
};

export default worker;
