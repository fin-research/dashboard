<script lang="ts">
import { enhance } from '$app/forms';
import { untrack } from 'svelte';
import type { SubmitFunction } from '@sveltejs/kit';
import ModuleCard from '../../../components/ModuleCard.svelte';
import PanelHeading from '$lib/trading-research/PanelHeading.svelte';
import { PERMISSION_CODES, PERMISSION_DEFINITIONS, PERMISSION_DOMAINS, hasPermission } from '$lib/permissions';
import { globalMessages } from '$lib/global-messages';
import { Search, ShieldCheck, ExternalLink, Save, RotateCcw } from '@lucide/svelte';

let { data } = $props();
let selectedRole = $state(untrack(() => data.roles[0]?.id ?? ''));
let configurations = $state(untrack(() => structuredClone(data.configurations)));
let drafts = $state<Record<string, string[]>>(untrack(() => Object.fromEntries(Object.entries(data.configurations).map(([id, config]) => [id, [...config.permissions]]))));
let query = $state('');
let saving = $state(false);
let roleQuery = $state('');
const visibleRoles = $derived(data.roles.filter(item => `${item.name} ${item.description}`.toLowerCase().includes(roleQuery.toLowerCase())));
const canConfigure = $derived(hasPermission(data.permissions, 'auth.permission:update'));
const role = $derived(data.roles.find(item => item.id === selectedRole));
const selected = $derived(drafts[selectedRole] ?? []);
const dirty = $derived(JSON.stringify([...selected].sort()) !== JSON.stringify([...(configurations[selectedRole]?.permissions ?? [])].sort()));
const groups = $derived(Object.entries(PERMISSION_DOMAINS).map(([domain, label]) => ({ domain, label,
  permissions: PERMISSION_DEFINITIONS.filter(([code, name, description]) => code.startsWith(domain + '.') && `${code} ${name} ${description}`.toLowerCase().includes(query.toLowerCase())),
})).filter(group => group.permissions.length));
function toggle(code: string, checked: boolean) {
  drafts[selectedRole] = checked ? [...new Set([...selected, code])] : selected.filter(item => item !== code);
}
function setGroup(codes: readonly string[], checked: boolean) {
  drafts[selectedRole] = checked ? [...new Set([...selected, ...codes])] : selected.filter(code => !codes.includes(code));
}
const save: SubmitFunction = () => {
  saving = true;
  return async ({ result, update }) => {
    saving = false;
    if (result.type === 'success' && result.data?.configuration) {
      const id = String(result.data.roleId);
      configurations[id] = result.data.configuration as { permissions: string[]; version: string };
      drafts[id] = [...configurations[id].permissions];
      globalMessages.success(String(result.data.message));
    } else if (result.type === 'failure') globalMessages.error(String(result.data?.message ?? '保存失败'));
    else await update({ reset: false });
  };
};
</script>

<div class="permissions-page">
  <div class="alert alert-info authorization-state" role="status">
    <ShieldCheck size={22} aria-hidden="true" />
    <div><strong>{data.mode === 'beta-open' ? '内测全开放' : '按角色授权'}</strong><p>{data.mode === 'beta-open' ? '所有已登录账号当前均可使用全部功能。保存的配置将在启用角色校验后生效。' : '账号权限由角色及以下授权共同决定。'}</p></div>
    <a class="btn btn-ghost" href="https://manage.auth0.com/dashboard/eu/hasbai/users" target="_blank" rel="noreferrer">人员与角色<ExternalLink size={16} aria-hidden="true" /></a>
  </div>
  <div class="permission-workspace">
    <ModuleCard class="role-catalog">
      <PanelHeading id="role-catalog-title" title="角色"><span class="badge badge-ghost">{data.roles.length}</span></PanelHeading>
      <label class="input role-search"><Search size={18} aria-hidden="true" /><input type="search" bind:value={roleQuery} placeholder="查找角色" aria-label="查找角色" /></label>
      <ul class="role-list" aria-labelledby="role-catalog-title">
        {#each visibleRoles as item}
          <li><button type="button" class="btn" class:btn-soft={selectedRole === item.id} class:btn-secondary={selectedRole === item.id} class:btn-ghost={selectedRole !== item.id} disabled={saving} onclick={() => selectedRole = item.id} aria-pressed={selectedRole === item.id}>
            <span class="role-label">{item.name}</span><span class="badge badge-ghost">{(drafts[item.id] ?? []).length}</span>
          </button></li>
        {/each}
      </ul>
      {#if !visibleRoles.length}<p class="empty-copy">{data.roles.length ? '没有匹配的角色' : '请先在 Auth0 创建角色'}</p>{/if}
    </ModuleCard>
    <ModuleCard class="permission-editor">
      {#if role}
        <form method="post" action="?/saveRolePermissions" use:enhance={save}>
          <input type="hidden" name="roleId" value={selectedRole} />
          <input type="hidden" name="version" value={configurations[selectedRole]?.version ?? ''} />
          {#each selected as code}<input type="hidden" name="permissions" value={code} />{/each}
          <div class="permission-editor-heading">
            <PanelHeading id="authorization-title" title={role.name} />
            <span class="badge" class:badge-warning={dirty} class:badge-success={!dirty}>{dirty ? '未保存' : '已保存'}</span>
          </div>
          {#if role.description}<p class="role-description">{role.description}</p>{/if}
          <div class="permission-toolbar">
            <label class="input permission-search"><Search size={18} aria-hidden="true" /><input type="search" bind:value={query} placeholder="搜索权限名称、代码或操作" aria-label="搜索权限" /></label>
            <span class="permission-count">已选 <strong>{selected.length}</strong> / {PERMISSION_CODES.length} 项</span>
          </div>
          {#if !canConfigure}<div class="alert" role="status">当前账号可查看权限，不能修改配置。</div>{/if}
          <fieldset disabled={!canConfigure || saving}>
            <legend class="sr-only">{role.name} 的权限</legend>
            <div class="permission-actions">
              <button type="button" class="btn btn-ghost" onclick={() => setGroup(PERMISSION_CODES, true)}>全选</button>
              <button type="button" class="btn btn-ghost" onclick={() => setGroup(PERMISSION_CODES, false)}>清空</button>
              <button type="button" class="btn btn-ghost" disabled={!dirty} onclick={() => drafts[selectedRole] = [...(configurations[selectedRole]?.permissions ?? [])]}><RotateCcw size={16} aria-hidden="true" />撤销修改</button>
              <button type="submit" class="btn btn-primary permission-save" disabled={!dirty}>{#if saving}<span class="loading loading-spinner loading-sm"></span>{:else}<Save size={18} aria-hidden="true" />{/if}{saving ? '保存中…' : '保存角色权限'}</button>
            </div>
            {#each groups as group}
              <section class="permission-domain" aria-labelledby={`permission-domain-${group.domain}`}>
                <div class="domain-heading"><h2 id={`permission-domain-${group.domain}`}>{group.label}<span class="badge badge-ghost">{group.permissions.filter(([code]) => selected.includes(code)).length} / {group.permissions.length}</span></h2>
                  <label><input class="checkbox checkbox-primary checkbox-sm" type="checkbox" checked={group.permissions.every(([code]) => selected.includes(code))}
                    indeterminate={group.permissions.some(([code]) => selected.includes(code)) && !group.permissions.every(([code]) => selected.includes(code))}
                    onchange={(event) => setGroup(group.permissions.map(([code]) => code), event.currentTarget.checked)} />选择本组</label>
                </div>
                <div class="permission-grid">
                  {#each group.permissions as [code, name, description]}
                    <label class="permission-item" class:permission-item--selected={selected.includes(code)}>
                      <input class="checkbox checkbox-primary checkbox-sm" type="checkbox" checked={selected.includes(code)} onchange={(event) => toggle(code, event.currentTarget.checked)} />
                      <span><strong>{name}</strong><span>{description}</span></span>
                      <code>{code}</code>
                    </label>
                  {/each}
                </div>
              </section>
            {/each}
            {#if !groups.length}<p class="empty-copy">没有匹配的权限。</p>{/if}
          </fieldset>
        </form>
      {:else}<div class="empty-copy">选择角色后配置业务权限。</div>{/if}
    </ModuleCard>
  </div>
</div>

<style>
  .permissions-page { display: grid; gap: 1.25rem; }
  .authorization-state { grid-template-columns: auto 1fr auto; }
  .authorization-state p { margin: .375rem 0 0; line-height: 1.6; }
  .permission-workspace { display: grid; grid-template-columns: 260px minmax(0, 1fr); align-items: start; gap: 1.25rem; }
  .permission-workspace :global(.role-catalog) { position: sticky; top: 1rem; }
  .role-search, .permission-search { width: 100%; }
  .role-list { display: grid; width: 100%; gap: .375rem; margin: 0; padding: .75rem 0 0; list-style: none; }
  .role-list button { display: flex; width: 100%; min-height: 48px; justify-content: space-between; gap: .5rem; padding-inline: .75rem; text-align: left; }
  .role-label { min-width: 0; overflow-wrap: anywhere; font-weight: normal; }
  .role-list button[aria-pressed="true"] .role-label { font-weight: bold; }
  .permission-editor-heading, .permission-toolbar, .domain-heading, .domain-heading h2 { display: flex; align-items: center; justify-content: space-between; gap: .75rem; flex-wrap: wrap; }
  .permission-editor-heading :global(.tr-panel-heading) { margin-bottom: 0; }
  .permission-editor-heading { margin-bottom: 1rem; }
  .role-description, .permission-count { color: var(--muted); font-size: .875rem; }
  .role-description { margin: 0 0 1rem; }
  .permission-search { flex: 1 1 260px; }
  .permission-count { white-space: nowrap; }
  .permission-count strong { color: var(--color-primary); }
  fieldset { min-width: 0; border: 0; margin: 0; padding: 0; }
  .permission-actions { display: flex; flex-wrap: wrap; gap: .5rem; padding: 1rem 0; position: sticky; top: 0; z-index: 2; background: var(--surface); border-bottom: 1px solid var(--line); }
  .permission-save { margin-left: auto; }
  .permission-domain { padding-top: 1.25rem; }
  .domain-heading { margin-bottom: .75rem; }
  .domain-heading h2 { justify-content: flex-start; margin: 0; font-size: 1rem; font-weight: bold; }
  .domain-heading label { display: flex; min-height: 44px; gap: .5rem; align-items: center; font-size: .875rem; }
  .permission-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: .75rem; }
  .permission-item { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: start; gap: .5rem .75rem; padding: 1rem; border: 1px solid var(--line); border-radius: var(--radius-control); min-width: 0; cursor: pointer; }
  .permission-item:hover { border-color: var(--color-primary); }
  .permission-item--selected { background: var(--brand-soft); border-color: color-mix(in srgb, var(--brand) 28%, var(--line)); }
  .permission-item > input { margin-top: .125rem; }
  .permission-item > span { display: grid; gap: .375rem; overflow-wrap: anywhere; }
  .permission-item > code { grid-column: 1 / -1; min-width: 0; overflow-wrap: anywhere; }
  .permission-item code, .permission-item span span { font-family: inherit; font-size: .875rem; color: var(--muted); line-height: 1.5; }
  .permission-item code { font-size: .8125rem; }
  .empty-copy { padding: 1rem 0; color: var(--muted); }
  @media (max-width: 1100px) { .permission-workspace { grid-template-columns: 1fr; } .permission-workspace :global(.role-catalog) { position: static; } .role-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr)); } }
  @media (max-width: 720px) { .authorization-state { grid-template-columns: auto 1fr; } .authorization-state > a { grid-column: 1 / -1; } .permission-save { width: 100%; } .permission-actions { position: static; } }
</style>
