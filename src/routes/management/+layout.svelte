<script lang="ts">
import '../financing/layout.css';
import { page } from '$app/state';
import WorkbenchShell from '$lib/workbench/WorkbenchShell.svelte';
import type { WorkbenchIconName } from '$lib/trading-research/demo-data';
let { children } = $props();
const views = [
  { id: 'overview', label: '管理入口', href: '/management', icon: 'overview' as WorkbenchIconName },
  { id: 'profile', label: '个人信息', href: '/profile', icon: 'menu' as WorkbenchIconName },
  { id: 'people', label: '人员与权限', href: '/management/people', icon: 'credit' as WorkbenchIconName },
  { id: 'financing-profile', label: '融资人员资料', href: '/management/financing-profile', icon: 'file' as WorkbenchIconName },
  { id: 'fund-report', label: '资金日报', href: '/fund-report?upload=1', icon: 'funds' as WorkbenchIconName }
];
const activeViewId = $derived(page.url.pathname.split('/')[2] ?? 'overview');
</script>
<WorkbenchShell title="管理中心" homeHref="/management" {views} {activeViewId} class="financing-scope">
  {@render children()}
</WorkbenchShell>
