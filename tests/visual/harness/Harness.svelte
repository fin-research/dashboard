<script lang="ts">
  import { setContext, type Component } from "svelte";
  import { createClientSession, CLIENT_SESSION_CONTEXT } from '../../../src/lib/client-session';
  import { PERMISSION_CODES } from '../../../src/lib/permissions';
  import { provideAiClient } from '../../../src/lib/ai-client.svelte';
  // Component fixtures only; no authentication service or production identity bypass.
  setContext(CLIENT_SESSION_CONTEXT, createClientSession({user:{id:'auth0|test',auth0Id:'auth0|test',email:'test@18.cn'},account:null,roles:[{id:'rol_Fixture',name:'admin'}],permissions:[...PERMISSION_CODES],expiresAt:2100000000}));
  const aiClient = provideAiClient();
  import GlobalMessages from '../../../src/lib/GlobalMessages.svelte';
  import AiPanel from '../../../src/lib/AiPanel.svelte';
  const path = window.location.pathname;
  const view = path.split('/')[2];
  const component: Promise<{ default: Component<any> }> = path === '/' ? import('../../../src/routes/+page.svelte')
    : path.startsWith('/trading-research') ? import('../../../src/lib/trading-research/WorkbenchPage.svelte')
    : path.startsWith('/credit-workbench') ? import('../../../src/lib/credit-workbench/CreditWorkbenchPage.svelte')
    : path.startsWith('/news/') ? import('../../../src/routes/news/[id]/+page.svelte')
    : path.startsWith('/articles/') ? import('../../../src/routes/articles/[id]/+page.svelte')
    : path.startsWith('/commentaries/') ? import('../../../src/routes/commentaries/[id]/+page.svelte')
    : path === '/fund-report' ? import('./FundReports.svelte')
    : ['/management/people','/management/me','/management/notifications'].includes(path) ? import('./ManagementAudit.svelte')
    : path === '/management/messenger' ? import('./Messenger.svelte')
    : path === '/management/permissions' ? import('./Permissions.svelte')
    : path === '/ui-contracts' ? import('./Primitives.svelte')
    : path === '/financing' || path === '/financing/' ? import('./FinancingDashboard.svelte')
    : path.startsWith('/financing/projects') ? import('./FinancingProjects.svelte')
    : path === '/financing/liability-report' ? import('./LiabilityReport.svelte')
    : path === '/financing/schedule' ? import('./Schedule.svelte')
    : path.startsWith('/financing/sop/') ? import('./FinancingSopDetail.svelte')
    : path === '/financing/sop' ? import('./FinancingSop.svelte')
    : path === '/financing/bond-investors' ? import('./FinancingInvestors.svelte')
    : path.startsWith('/financing/debts/') ? import('./FinancingDebt.svelte')
    : path === '/financing/filters' ? import('./FinancingFilters.svelte')
    : path === '/financing/data' ? import('./FinancingData.svelte')
    : path === '/financing/clients' ? import('./FinancingClients.svelte')
    : path.startsWith('/market-briefing') ? import('../../../src/App.svelte')
    : Promise.reject(new Error(`Unregistered visual scenario: ${path}`));
</script>
<GlobalMessages />
<AiPanel client={aiClient} />
{#await component then module}
  <module.default viewId={view || 'overview'} {...(/^(?:\/news|\/articles|\/commentaries)\//.test(path) ? {data:{id:view}} : {})} />
{:catch error}
  <pre role="alert">{error.message}</pre>
{/await}
