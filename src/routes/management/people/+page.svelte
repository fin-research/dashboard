<script lang="ts">
import { untrack } from 'svelte';
import { invalidate } from '$app/navigation';
import ModuleCard from '../../../components/ModuleCard.svelte';
import PanelHeading from '$lib/trading-research/PanelHeading.svelte';
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
    globalMessages.success('当前节点的授权缓存已更新，其他节点最长 1 小时内更新');
  } catch (error) { globalMessages.error(error instanceof Error ? error.message : '刷新失败'); }
  finally { refreshing = false; }
}
</script>
<div class="permissions-page">
  <div class="permission-controls">
    <a class="btn btn-outline" href="https://manage.auth0.com/dashboard/eu/hasbai/roles" target="_blank" rel="noreferrer">在 Auth0 管理<ExternalLink size={16} aria-hidden="true" /></a>
    {#if hasPermission(data.permissions, 'auth.permission:update')}<button class="btn btn-primary" type="button" disabled={refreshing} onclick={refreshCache}><RefreshCw size={16} aria-hidden="true" />{refreshing ? '正在同步…' : '刷新授权缓存'}</button>{/if}
    <span class="cache-time">更新于 {new Date(data.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })} · 缓存 1 小时</span>
  </div>
  <div class="permission-workspace">
    <ModuleCard class="role-catalog">
      <PanelHeading id="role-catalog-title" title="角色" />
      <ul class="role-list" aria-labelledby="role-catalog-title">
        {#each data.roles as item}<li><button class="btn btn-ghost" class:btn-active={selectedRole === item.id} type="button" aria-pressed={selectedRole === item.id} onclick={() => selectedRole = item.id}><span>{item.name}</span><span class="badge badge-ghost">{data.configurations[item.id]?.permissions.length ?? 0}</span></button></li>{/each}
      </ul>
    </ModuleCard>
    <ModuleCard class="permission-editor">
      {#if role}<PanelHeading id="role-permissions-title" title={role.name}><span class="badge badge-ghost">只读</span></PanelHeading><PermissionExplorer permissions={data.configurations[selectedRole]?.permissions ?? []} />{:else}<p>暂无角色。</p>{/if}
    </ModuleCard>
  </div>
</div>
<style>
.permissions-page { display: grid; gap: 1.25rem; }
.permission-controls { display: flex; flex-wrap: wrap; align-items: center; gap: .75rem; }
.cache-time { font-size: .875rem; color: var(--muted); }
.permission-workspace { display: grid; grid-template-columns: 230px minmax(0, 1fr); gap: 1.25rem; align-items: start; }
.role-list { list-style: none; padding: 0; margin: 0; display: grid; gap: .375rem; }
.role-list button { width: 100%; min-height: 44px; height: auto; justify-content: space-between; text-align: left; }
.role-list button > span:first-child { overflow-wrap: anywhere; min-width: 0; }
@media (max-width: 900px) { .permission-workspace { grid-template-columns: 1fr; } .role-list { grid-template-columns: repeat(auto-fit, minmax(min(190px, 100%), 1fr)); } }
</style>
