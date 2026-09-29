<script lang="ts">
  import { invalidate } from '$app/navigation';
  import { Button } from '$lib/components/ui/button/index.js';
  import ManagementPeopleView from '$lib/management/ManagementPeopleView.svelte';
  import ModuleCard from '../../../components/ModuleCard.svelte';
  import PanelHeading from '$lib/trading-research/PanelHeading.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

{#await data.view}
  <div class="people-loading" role="status" aria-label="正在加载人员" aria-busy="true">
    <ModuleCard class="people-loading__card">
      <PanelHeading id="loading-people-title" title="人员" />
      <div class="people-loading__line" aria-hidden="true"></div>
      <div class="people-loading__line people-loading__line--short" aria-hidden="true"></div>
    </ModuleCard>
    <ModuleCard class="people-loading__card">
      <PanelHeading id="loading-profile-title" title="人员资料" />
      <div class="people-loading__line" aria-hidden="true"></div>
      <div class="people-loading__line" aria-hidden="true"></div>
    </ModuleCard>
  </div>
{:then view}
  <ManagementPeopleView data={{ ...view, permissions: data.permissions }} />
{:catch}
  <ModuleCard>
    <PanelHeading id="people-load-error-title" title="人员" />
    <p role="alert">人员资料加载失败</p>
    <Button variant="outline" type="button" onclick={() => invalidate('management:people')}>重试</Button>
  </ModuleCard>
{/await}

<style>
  .people-loading { display: grid; grid-template-columns: 230px minmax(0, 1fr); gap: 1.25rem; }
  .people-loading :global(.people-loading__card) { height: clamp(24rem, 65dvh, 40rem); }
  .people-loading__line { height: 44px; margin-bottom: .75rem; border-radius: var(--radius-control); background: var(--bg-page); }
  .people-loading__line--short { width: 70%; }
  @media (max-width: 900px) {
    .people-loading { grid-template-columns: 1fr; }
    .people-loading :global(.people-loading__card) { height: 14rem; }
  }
</style>
