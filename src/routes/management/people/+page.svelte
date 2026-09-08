<script lang="ts">
import { enhance } from '$app/forms';
import { untrack } from 'svelte';
import type { SubmitFunction } from '@sveltejs/kit';
import ModuleCard from '../../../components/ModuleCard.svelte';
import PanelHeading from '$lib/trading-research/PanelHeading.svelte';
import { PERMISSION_CODES, PERMISSION_DEFINITIONS, PERMISSION_DOMAINS, hasPermission } from '$lib/permissions';
import { globalMessages } from '$lib/global-messages';
import '../../financing/management.css';

let { data } = $props();
let selectedRole = $state(untrack(() => data.roles[0]?.id ?? ''));
let configurations = $state(untrack(() => structuredClone(data.configurations)));
let drafts = $state<Record<string, string[]>>(untrack(() => Object.fromEntries(Object.entries(data.configurations).map(([id, config]) => [id, [...config.permissions]]))));
let query = $state('');
let saving = $state(false);
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
<ModuleCard>
  <PanelHeading id="authorization-title" title="角色权限配置" />
  <div class="authorization-state">
    <strong>{data.mode === 'beta-open' ? '内测全开放' : '按角色授权'}</strong>
    <span>{data.mode === 'beta-open' ? '所有已登录账号当前均可使用全部功能。保存的配置将在启用角色校验后生效。' : '账号权限由 Auth0 角色及以下授权共同决定。'}</span>
    <a href="https://manage.auth0.com/dashboard/eu/hasbai/users" target="_blank" rel="noreferrer">在 Auth0 管理人员和角色</a>
  </div>
  {#if !canConfigure}<p>当前账号可查看权限，不能修改配置。</p>{/if}
  {#if !data.roles.length}<p>Auth0 中尚无角色，请先在 Auth0 创建角色。</p>{:else}
  <div class="permission-controls">
    <label>角色<select bind:value={selectedRole} disabled={saving}>{#each data.roles as item}<option value={item.id}>{item.name}</option>{/each}</select></label>
    <label>搜索权限<input type="search" bind:value={query} placeholder="名称、权限代码或操作" /></label>
    <span>{selected.length} / {PERMISSION_CODES.length} 项{dirty ? ' · 未保存' : ''}</span>
  </div>
  {#if role?.description}<p>{role.description}</p>{/if}
  <form method="post" action="?/saveRolePermissions" use:enhance={save}>
    <input type="hidden" name="roleId" value={selectedRole} />
    <input type="hidden" name="version" value={configurations[selectedRole]?.version ?? ''} />
    {#each selected as code}<input type="hidden" name="permissions" value={code} />{/each}
    <fieldset disabled={!canConfigure || saving}>
      <legend class="sr-only">{role?.name} 的权限</legend>
      <div class="permission-actions">
        <button type="button" onclick={() => setGroup(PERMISSION_CODES, true)}>全选</button>
        <button type="button" onclick={() => setGroup(PERMISSION_CODES, false)}>清空</button>
        <button type="button" disabled={!dirty} onclick={() => drafts[selectedRole] = [...(configurations[selectedRole]?.permissions ?? [])]}>撤销修改</button>
        <button type="submit" class="primary" disabled={!dirty}>{saving ? '保存中…' : '保存角色权限'}</button>
      </div>
      {#each groups as group}
      <section class="permission-domain" aria-labelledby={`permission-domain-${group.domain}`}>
        <div class="domain-heading"><h2 id={`permission-domain-${group.domain}`}>{group.label}</h2>
        <label><input type="checkbox" checked={group.permissions.every(([code]) => selected.includes(code))}
          indeterminate={group.permissions.some(([code]) => selected.includes(code)) && !group.permissions.every(([code]) => selected.includes(code))}
          onchange={(event) => setGroup(group.permissions.map(([code]) => code), event.currentTarget.checked)} />选择本组显示的权限</label></div>
        <div class="permission-grid">
        {#each group.permissions as [code, name, description]}
          <label class="permission-item"><input type="checkbox" checked={selected.includes(code)} onchange={(event) => toggle(code, event.currentTarget.checked)} />
          <span><strong>{name}</strong><code>{code}</code><span>{description}</span></span></label>
        {/each}
        </div>
      </section>
      {/each}
      {#if !groups.length}<p>没有匹配的权限。</p>{/if}
    </fieldset>
  </form>
  {/if}
</ModuleCard>
</div>
<style>
.permissions-page { display: grid; gap: 1rem; }
.authorization-state { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; padding-block: 0.5rem 1rem; }
.authorization-state strong { color: var(--color-primary); }
.authorization-state span { flex: 1 1 24rem; }
a { color: var(--color-primary); min-height: 44px; display: inline-flex; align-items: center; }
.permission-controls { display: flex; flex-wrap: wrap; align-items: end; gap: 1rem; margin-bottom: 1rem; }
.permission-controls label { display: grid; gap: 0.5rem; flex: 1 1 16rem; }
input[type='search'], select { width: 100%; min-height: 44px; padding: 0.5rem 0.75rem; border: 1px solid var(--color-base-300); border-radius: 6px; background: var(--color-base-100); }
fieldset { min-width: 0; border: 0; margin: 0; padding: 0; }
.permission-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; padding-bottom: 1rem; }
button { min-height: 44px; padding: 0.5rem 1rem; border: 1px solid var(--color-base-300); border-radius: 6px; background: var(--color-base-100); cursor: pointer; }
button.primary { background: var(--color-primary); color: var(--color-primary-content); margin-left: auto; }
button:disabled { opacity: 0.55; cursor: default; }
.permission-domain { padding-block: 1rem; border-top: 1px solid var(--color-base-300); }
.domain-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem; }
h2 { font-size: 1.125rem; font-weight: bold; margin: 0; }
.domain-heading label { display: flex; align-items: center; gap: 0.5rem; min-height: 44px; }
.permission-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(19rem, 100%), 1fr)); gap: 0.75rem; }
.permission-item { display: flex; align-items: start; gap: 0.75rem; padding: 0.75rem; border: 1px solid var(--color-base-300); border-radius: 6px; min-width: 0; cursor: pointer; }
.permission-item > span { display: grid; gap: 0.375rem; overflow-wrap: anywhere; }
.permission-item strong { font-size: 1rem; }
.permission-item code, .permission-item span span { font-family: inherit; font-size: 0.875rem; color: var(--color-base-content); }
input[type='checkbox'] { margin-top: 0.25rem; width: 1.125rem; height: 1.125rem; flex-shrink: 0; accent-color: var(--color-primary); }
</style>
