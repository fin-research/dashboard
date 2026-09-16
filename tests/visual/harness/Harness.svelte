<script lang="ts">
  import type { Component } from "svelte";
  import GlobalMessages from '../../../src/lib/GlobalMessages.svelte';
  const path = window.location.pathname;
  const view = path.split('/')[2];
  const component: Promise<{ default: Component<any> }> = path === '/' ? import('../../../src/routes/+page.svelte')
    : path.startsWith('/trading-research') ? import('../../../src/lib/trading-research/WorkbenchPage.svelte')
    : path.startsWith('/credit-workbench') ? import('../../../src/lib/credit-workbench/CreditWorkbenchPage.svelte')
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
