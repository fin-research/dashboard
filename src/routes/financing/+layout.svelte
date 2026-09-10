<script lang="ts">
import './layout.css';
import { Bell } from '@lucide/svelte';
import { navigating, page } from '$app/state';
import WorkbenchShell from '$lib/workbench/WorkbenchShell.svelte';
import type { WorkbenchIconName } from '$lib/trading-research/demo-data';
import { hasPermission } from '$lib/permissions';
import { withBase, withoutBase } from '$lib/financing/app-paths';
let { data, children } = $props();
let navigationSlow = $state(false);
let remindersMenu = $state<HTMLDetailsElement>();
$effect(() => { page.url.pathname; if (remindersMenu) remindersMenu.open = false; });
$effect(() => {
  navigationSlow = false;
  if (!navigating.to) return;
  const timer = setTimeout(() => (navigationSlow = true), 300);
  return () => clearTimeout(timer);
});
const views = $derived([
  { id: 'overview', href: '/financing/', label: '仪表盘', icon: 'overview' as WorkbenchIconName },
  { id: 'liability-report', href: '/financing/liability-report', label: '负债周报', icon: 'file' as WorkbenchIconName },
  ...(hasPermission(data.permissions, 'financing.data:read') ? [{ id: 'bond-investors', href: '/financing/bond-investors', label: '债券投资人', icon: 'user' as WorkbenchIconName }] : []),
  { id: 'projects', href: '/financing/projects', label: '项目进度', icon: 'workflow' as WorkbenchIconName },
  { id: 'sop', href: '/financing/sop', label: 'SOP 管理', icon: 'check' as WorkbenchIconName },
  ...(hasPermission(data.permissions, 'financing.data:read') ? [{ id: 'data', href: '/financing/data', label: '融资数据', icon: 'database' as WorkbenchIconName }] : [])
]);
const path = $derived(withoutBase(page.url.pathname));
const activeViewId = $derived(path === '/' || path.startsWith('/debts/') ? 'overview' : path.split('/')[1] ?? 'overview');
const isLiabilityReport = $derived(path === '/liability-report');
const activeLabel = $derived(path.startsWith('/projects/') ? '项目详情' : path.startsWith('/debts/') ? '负债详情' : path === '/sop/reminders' ? '提醒发送历史' : path.startsWith('/sop/') ? 'SOP 配置' : '');
</script>

<svelte:window onkeydown={(event) => { if (event.key === 'Escape' && remindersMenu?.open) { remindersMenu.open = false; remindersMenu.querySelector('summary')?.focus(); } }} onpointerdown={(event) => { if (remindersMenu?.open && event.target instanceof Node && !remindersMenu.contains(event.target)) remindersMenu.open = false; }} />

{#if data.user}
<WorkbenchShell title="融资工作台" homeHref="/financing/" {views} {activeViewId} {activeLabel}
  class="financing-scope" tone="orange" layoutReport={isLiabilityReport} reportKind={isLiabilityReport ? 'liability' : null}>
  {#snippet actions()}
    <details class="dropdown dropdown-end financing-reminders" bind:this={remindersMenu}>
      <summary class="btn btn-ghost reminder-trigger" aria-label={`查看提醒，${data.reminders.total} 条待办`}>
        <Bell size={19} aria-hidden="true" /><span class="reminder-trigger-label">查看提醒</span>
        {#if data.reminders.total > 0}<span class="badge badge-info">{data.reminders.total}</span>{/if}
      </summary>
      <div class="dropdown-content card card-border bg-base-100 reminder-popover">
        <div class="reminder-popover-heading"><strong>待办与提醒</strong><span>{data.reminders.total} 条</span></div>
        {#each data.reminders.items as reminder}
          <a href={withBase(reminder.href)}><strong>{reminder.projectName}</strong><span>{reminder.taskName}</span><small>{reminder.dueLabel}</small></a>
        {:else}<p>当前没有需要处理的项目节点</p>{/each}
      </div>
    </details>
    {#if isLiabilityReport}
      {#await import('$lib/financing/LiabilityReportActions.svelte') then module}
        <module.default permissions={data.permissions} />
      {/await}
    {/if}
  {/snippet}
  {#snippet status()}
    {#if navigationSlow}<div class="navigation-progress" role="progressbar" aria-label="页面加载中"></div>{/if}
  {/snippet}
  <div class:liability-report-content={isLiabilityReport} class="financing-content" aria-busy={Boolean(navigating.to)}>{@render children()}</div>
</WorkbenchShell>
{:else}{@render children()}{/if}
