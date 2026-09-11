<script lang="ts">
import { getContext } from 'svelte';
import { CLIENT_SESSION_CONTEXT, type ClientSession } from '$lib/client-session';
import ModuleCard from '../../../components/ModuleCard.svelte';
	import '../management.css';
	import FinanceParametersPanel from '$lib/financing/FinanceParametersPanel.svelte';
	import DebtImportPanel from '$lib/financing/DebtImportPanel.svelte';
	import { hasPermission } from '$lib/permissions';

	let { data } = $props();
	const session = getContext<ClientSession>(CLIENT_SESSION_CONTEXT);
	const permissions = $derived($session?.permissions ?? data.permissions);
</script>

<svelte:head>
	<title>数据后台 · 融资工作台</title>
</svelte:head>

<div class="management-page data-page">
	{#if hasPermission(permissions, 'financing.data:read')}
		{#if hasPermission(permissions, 'financing.data:import')}<DebtImportPanel />{/if}
		<FinanceParametersPanel permissions={permissions} />
		<!-- 通用大表格保留在 $lib/DataAdminTable.svelte，需要恢复时重新挂载。 -->
	{:else}
		<ModuleCard class="section-card permission-empty">
			<h2>暂无数据后台权限</h2>
			<p>请联系具有“权限配置”权限的人员，为当前角色开通数据后台。</p>
		</ModuleCard>
	{/if}
</div>

<style>
	.data-page { padding-bottom: 5.5rem; }
	:global(.permission-empty) { padding: 1.25rem; }
	:global(.permission-empty) h2 { margin: 0; }
	:global(.permission-empty) p { margin: 0.5rem 0 0; color: #475467; }
</style>
