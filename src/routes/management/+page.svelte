<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import { ArrowUpRight, ShieldCheck, UserRound, FileUp } from '@lucide/svelte';
  import ModuleCard from '../../components/ModuleCard.svelte';
  import PanelHeading from '$lib/trading-research/PanelHeading.svelte';
  const entries = [
    { href: '/management/people', title: '角色权限', icon: ShieldCheck, tone: 'primary', actionClass: 'ui-tone-info' },
    { href: '/profile', title: '个人管理', icon: UserRound, tone: 'secondary', actionClass: 'ui-tone-secondary' },
    { href: '/fund-report?upload=1', title: '资金日报', icon: FileUp, tone: 'accent', actionClass: 'ui-tone-success' }
  ];
</script>

<div class="management-overview">
  <PanelHeading id="management-overview-title" title="管理" />
  <div class="management-entry-grid">
    {#each entries as entry}
      <ModuleCard class="management-entry">
        <div class={`management-icon management-icon--${entry.tone}`}><entry.icon size={28} aria-hidden="true" /></div>
        <h2>{entry.title}</h2>
        <Button data-ui-owner="routes-management--page-svelte" variant="outline" class={`ui-button ${entry.actionClass} management-entry-action`} href={entry.href}>进入{entry.title}<ArrowUpRight size={18} aria-hidden="true" /></Button>
      </ModuleCard>
    {/each}
  </div>
</div>

<style>
  .management-overview { display: grid; gap: .5rem; }
  .management-entry-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr)); gap: 1.25rem; }
  .management-entry-grid :global(.management-entry) { display: flex; flex-direction: column; align-items: flex-start; gap: 1.25rem; padding: 1.5rem; }
  .management-icon { width: 56px; height: 56px; display: grid; place-items: center; border-radius: var(--radius-card); }
  .management-icon--primary { color: var(--color-primary); background: var(--brand-soft); }
  .management-icon--secondary { color: var(--business-purple); background: color-mix(in srgb, var(--business-purple) 9%, white); }
  .management-icon--accent { color: var(--business-accent); background: color-mix(in srgb, var(--business-accent) 9%, white); }
  h2 { margin: 0; font-size: 1.25rem; font-weight: bold; }
  .management-entry-action { width: 100%; margin-top: auto; justify-content: space-between; }
</style>
