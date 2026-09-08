<script lang="ts">
import './layout.css';
import { navigating, page } from '$app/state';
import WorkbenchShell from '$lib/workbench/WorkbenchShell.svelte';
import type { WorkbenchIconName } from '$lib/trading-research/demo-data';
import { hasPermission } from '$lib/permissions';
import { withBase, withoutBase } from '$lib/financing/app-paths';
let { data, children } = $props();
let navigationSlow = $state(false);
$effect(() => {
  navigationSlow = false;
  if (!navigating.to) return;
  const timer = setTimeout(() => (navigationSlow = true), 300);
  return () => clearTimeout(timer);
});
const views = $derived([
  { id: 'overview', href: '/financing/', label: '仪表盘', icon: 'overview' as WorkbenchIconName },
  { id: 'liability-report', href: '/financing/liability-report', label: '负债周报', icon: 'file' as WorkbenchIconName },
  { id: 'projects', href: '/financing/projects', label: '项目进度', icon: 'workflow' as WorkbenchIconName },
  { id: 'sop', href: '/financing/sop', label: 'SOP 管理', icon: 'check' as WorkbenchIconName },
  ...(hasPermission(data.permissions, 'financing.data:read') ? [{ id: 'data', href: '/financing/data', label: '融资数据', icon: 'database' as WorkbenchIconName }] : [])
]);
const path = $derived(withoutBase(page.url.pathname));
const activeViewId = $derived(path === '/' || path.startsWith('/debts/') ? 'overview' : path.split('/')[1] ?? 'overview');
const isLiabilityReport = $derived(path === '/liability-report');
</script>

{#if data.user}
<WorkbenchShell title="融资工作台" homeHref="/financing/" {views} {activeViewId}
  class="financing-scope" layoutReport={isLiabilityReport} reportKind={isLiabilityReport ? 'liability' : null}>
  {#snippet actions()}
    {#if isLiabilityReport}
      {#await import('$lib/financing/LiabilityReportActions.svelte') then module}
        <module.default permissions={data.permissions} />
      {/await}
    {/if}
  {/snippet}
  {#snippet status()}
    {#if navigationSlow}<div class="navigation-progress" role="progressbar" aria-label="页面加载中"></div>{/if}
    {#if data.reminders.total > 0}
      <details class="collapse collapse-arrow financing-reminders"><summary class="collapse-title">待办提醒 <span class="badge badge-info">{data.reminders.total}</span></summary>
        <div class="collapse-content">
        {#each data.reminders.items as reminder}
          <a href={withBase(reminder.href)}>{reminder.projectName} · {reminder.taskName} · {reminder.dueLabel}</a>
        {/each}
        </div>
      </details>
    {/if}
  {/snippet}
  <div class:liability-report-content={isLiabilityReport} class="financing-content" aria-busy={Boolean(navigating.to)}>{@render children()}</div>
</WorkbenchShell>
{:else}{@render children()}{/if}
