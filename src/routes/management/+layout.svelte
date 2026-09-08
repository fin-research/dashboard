<script lang="ts">
import { page } from '$app/state';
import WorkbenchShell from '$lib/workbench/WorkbenchShell.svelte';
import type { WorkbenchIconName } from '$lib/trading-research/demo-data';
let { children } = $props();
const views = [
  { id: 'overview', label: '管理总览', href: '/management', icon: 'overview' as WorkbenchIconName },
  { id: 'profile', label: '个人管理', href: '/profile', icon: 'menu' as WorkbenchIconName },
  { id: 'people', label: '角色权限', href: '/management/people', icon: 'credit' as WorkbenchIconName },
  { id: 'fund-report', label: '资金日报', href: '/fund-report?upload=1', icon: 'funds' as WorkbenchIconName }
];
const activeViewId = $derived(page.url.pathname.split('/')[2] ?? 'overview');
</script>
<WorkbenchShell title="管理" homeHref="/management" {views} {activeViewId} class="management-scope">
  {@render children()}
</WorkbenchShell>
