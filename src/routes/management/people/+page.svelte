<script lang="ts">
  import { Badge as UiBadge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
import { untrack } from 'svelte';
import { invalidate } from '$app/navigation';
import ModuleCard from '../../../components/ModuleCard.svelte';
import PanelHeading from '$lib/trading-research/PanelHeading.svelte';
import { roleLabel } from '$lib/permissions/permission-tree';
import PermissionExplorer from '$lib/permissions/PermissionExplorer.svelte';
import { hasPermission } from '$lib/permissions';
import { globalMessages } from '$lib/global-messages';
import { ExternalLink, RefreshCw } from '@lucide/svelte';
let { data } = $props();
let selectedRole = $state(untrack(() => data.roles[0]?.id ?? ''));
let refreshing = $state(false);
const role = $derived(data.roles.find(item => item.id === selectedRole));
async function refreshCache() {
  refreshing = true;
  try {
    const response = await fetch('/auth/permissions/refresh', { method: 'POST' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || '刷新失败');
    await Promise.all([invalidate('auth:permissions'), invalidate('site:session')]);
    globalMessages.success('授权已刷新');
  } catch (error) { globalMessages.error(error instanceof Error ? error.message : '刷新失败'); }
  finally { refreshing = false; }
}
</script>
<div class="permissions-page">
  <div class="permission-controls">
    <Button data-ui-owner="routes-management-people--page-svelte" variant="outline" class={"ui-button "} href="https://manage.auth0.com/dashboard/eu/hasbai/roles" target="_blank" rel="noreferrer">在 Auth0 管理<ExternalLink size={16} aria-hidden="true" /></Button>
    {#if hasPermission(data.permissions, 'auth.permission:update')}<Button data-ui-owner="routes-management-people--page-svelte" variant="default" class={"ui-button "} type="button" disabled={refreshing} onclick={refreshCache}><RefreshCw size={16} aria-hidden="true" />{refreshing ? '正在同步…' : '刷新授权缓存'}</Button>{/if}
  </div>
  <div class="permission-workspace">
    <ModuleCard class="role-catalog">
      <PanelHeading id="role-catalog-title" title="角色" />
      <ul class="role-list" aria-labelledby="role-catalog-title">
        {#each data.roles as item}<li><Button data-ui-owner="routes-management-people--page-svelte" variant="ghost" class={["ui-button ", selectedRole === item.id && "is-selected"]}  type="button" aria-pressed={selectedRole === item.id} onclick={() => selectedRole = item.id}><span>{roleLabel(item.name)}</span><UiBadge variant="secondary" class="ui-badge ui-tone-neutral">{data.configurations[item.id]?.permissions.length ?? 0}</UiBadge></Button></li>{/each}
      </ul>
    </ModuleCard>
    <ModuleCard class="permission-editor">
      {#if role}<PanelHeading id="role-permissions-title" title={roleLabel(role.name)}><UiBadge variant="secondary" class="ui-badge ui-tone-neutral">只读</UiBadge></PanelHeading><PermissionExplorer permissions={data.configurations[selectedRole]?.permissions ?? []} />{:else}<p>暂无角色。</p>{/if}
    </ModuleCard>
  </div>
</div>
<style>
.permissions-page { display: grid; gap: 1.25rem; }
.permission-controls { display: flex; flex-wrap: wrap; align-items: center; gap: .75rem; }
.permission-workspace { display: grid; grid-template-columns: 230px minmax(0, 1fr); gap: 1.25rem; align-items: start; }
.role-list { list-style: none; padding: 0; margin: 0; display: grid; gap: .375rem; }
:global(.role-list button[data-ui-owner="routes-management-people--page-svelte"]) { width: 100%; min-height: 44px; height: auto; justify-content: space-between; text-align: left; }
:global(.role-list button[data-ui-owner="routes-management-people--page-svelte"] > span:first-child) { overflow-wrap: anywhere; min-width: 0; }
@media (max-width: 900px) { .permission-workspace { grid-template-columns: 1fr; } .role-list { grid-template-columns: repeat(auto-fit, minmax(min(190px, 100%), 1fr)); } }
</style>
