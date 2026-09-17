<script lang="ts">
  import { setContext, type Component } from "svelte";
  import { createClientSession, CLIENT_SESSION_CONTEXT } from '../../../src/lib/client-session';
  import { PERMISSION_CODES } from '../../../src/lib/permissions';
  // Component fixtures only; no authentication service or production identity bypass.
  setContext(CLIENT_SESSION_CONTEXT, createClientSession({user:{id:'auth0|test',auth0Id:'auth0|test',email:'test@18.cn'},account:null,roles:[{id:'rol_Fixture',name:'admin'}],permissions:[...PERMISSION_CODES],expiresAt:2100000000}));
  import GlobalMessages from '../../../src/lib/GlobalMessages.svelte';
  const path = window.location.pathname;
  const view = path.split('/')[2];
  const component: Promise<{ default: Component<any> }> = path === '/' ? import('../../../src/routes/+page.svelte')
    : path.startsWith('/trading-research') ? import('../../../src/lib/trading-research/WorkbenchPage.svelte')
    : path.startsWith('/credit-workbench') ? import('../../../src/lib/credit-workbench/CreditWorkbenchPage.svelte')
    : path === '/management/messenger' ? import('./Messenger.svelte')
    : path === '/ui-contracts' ? import('./Primitives.svelte')
    : path === '/financing/schedule' ? import('./Schedule.svelte')
    : path === '/market-briefing' ? import('../../../src/App.svelte')
    : Promise.reject(new Error(`Unregistered visual scenario: ${path}`));
</script>
<GlobalMessages />
{#await component then module}
  <module.default viewId={view || 'overview'} />
{:catch error}
  <pre role="alert">{error.message}</pre>
{/await}
