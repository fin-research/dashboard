<script lang="ts">
  import './profile.css';
  import { invalidate } from '$app/navigation';
  import PanelHeading from '$lib/trading-research/PanelHeading.svelte';
  import { onMount } from 'svelte';
  import ModuleCard from '../../components/ModuleCard.svelte';
  import { globalMessages } from '$lib/global-messages';
  import { isLoginRedirecting } from '$lib/auth-client';
  import { type AccountProfile } from '$lib/profile';
  import { RefreshCw, ShieldCheck } from '@lucide/svelte';
  import { roleLabel } from '$lib/permissions/permission-tree';
  import PermissionExplorer from '$lib/permissions/PermissionExplorer.svelte';
  import { readPreferences, savePreferences, type MarketColorConvention } from '$lib/preferences';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let permissions = $state<string[]>([]);
  async function loadPermissions() {
    try {
      const response = await fetch('/auth/permissions', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || '权限读取失败');
      permissions = result.permissions;
      await invalidate('site:session');
    } catch (error) { globalMessages.error(error instanceof Error ? error.message : '权限读取失败'); }
  }
  let profile = $state<AccountProfile | null>(null);
  let loading = $state(true);
  let loadError = $state('');
  let name = $state('');
  let email = $state('');
  let confirmed = $state(false);
  let pending = $state<'name' | 'email' | 'password' | null>(null);
  let marketColorConvention = $state<MarketColorConvention>('red-up-green-down');

  async function loadProfile(signal?: AbortSignal) {
    loading = true;
    loadError = '';
    try {
      const response = await fetch('/api/profile', { cache: 'no-store', signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || '个人信息读取失败');
      profile = payload as AccountProfile;
      name = profile.name;
      email = profile.email;
    } catch (error) {
      if (!signal?.aborted && !isLoginRedirecting()) loadError = error instanceof Error ? error.message : '个人信息读取失败';
    } finally { loading = false; }
  }

  async function submit(action: 'name' | 'email' | 'password') {
    if (pending || !profile) return;
    pending = action;
    try {
      const body = action === 'name' ? { action, name } : action === 'email' ? { action, email, confirmed } : { action };
      const response = await fetch('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || '个人信息保存失败');
      if (typeof result.name === 'string') { profile = { ...profile, name: result.name }; name = result.name; await invalidate('site:session'); }
      globalMessages.success(result.message, { key: 'profile-action', duration: 10000 });
      if (result.logout) { window.location.assign('/auth/logout'); return; }
    } catch (error) {
      if (!isLoginRedirecting()) globalMessages.error(error instanceof Error ? error.message : '个人信息保存失败', { key: 'profile-action' });
    } finally { pending = null; }
  }

  function persistPreferences() {
    try {
      savePreferences({ marketColorConvention });
      globalMessages.success('个性化配置已保存', { key: 'profile-preferences' });
    } catch { globalMessages.error('浏览器无法保存个性化配置，请检查存储权限'); }
  }

  onMount(() => {
    marketColorConvention = readPreferences().marketColorConvention;
    const controller = new AbortController();
    void loadProfile(controller.signal);
    void loadPermissions();
    return () => controller.abort();
  });
</script>

<svelte:head>
  <title>个人管理 · 资金管理部</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="profile-page">
  <header class="profile-header">
    <a class="btn btn-ghost btn-square profile-back" href="/" aria-label="返回市场研究门户"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12.5 4-6 6 6 6" /></svg></a>
    <h1>个人管理</h1>
  </header>
  <main class="profile-content">
    <div class="profile-summary">
      <span class="profile-avatar" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></svg></span>
      <div><strong>{profile?.name || data.account?.name || '我的账号'} / {data.account?.department || '未填写部门'}</strong><span>{profile?.email || data.email}</span></div>
      <span class="badge badge-success profile-tag">已登录</span>
    </div>
    {#if loading}
      <div class="profile-state" role="status">正在读取个人信息…</div>
    {:else if loadError}
      <div class="profile-state" role="alert"><p>{loadError}</p><button class="btn btn-outline profile-button" type="button" onclick={() => loadProfile()}>重新读取</button></div>
    {/if}
    <div class="profile-grid">
      <ModuleCard labelledBy="profile-details-title">
        <PanelHeading id="profile-details-title" title="个人资料" />
        <form class="profile-form" onsubmit={(event) => { event.preventDefault(); void submit('name'); }}>
          <label for="profile-name">显示姓名</label>
          <input class="input" id="profile-name" name="name" autocomplete="name" bind:value={name} required maxlength="50" disabled={!profile || pending !== null} />
          <label for="profile-department">部门</label>
          <input class="input" id="profile-department" value={data.account?.department || '未填写部门'} readonly />
          <div class="profile-actions"><button class="btn btn-primary profile-button primary" type="submit" disabled={!profile || pending !== null}>{pending === 'name' ? '正在保存' : '保存个人资料'}</button></div>
        </form>
      </ModuleCard>
      <ModuleCard labelledBy="profile-email-title">
        <PanelHeading id="profile-email-title" title="登录邮箱" accent="var(--color-accent)" />
        <form class="profile-form" onsubmit={(event) => { event.preventDefault(); void submit('email'); }}>
          <label for="profile-email">邮箱地址 · @18.cn {#if profile}<span class="field-status">{profile.emailVerified ? '已验证' : '待验证'}</span>{/if}</label>
          <input class="input" id="profile-email" name="email" type="email" autocomplete="email" bind:value={email} required maxlength="254" pattern="[^@\s]+@18\.[cC][nN]" disabled={!profile || pending !== null} />
          <label class="profile-choice"><input class="checkbox checkbox-primary" type="checkbox" bind:checked={confirmed} disabled={!profile || pending !== null} /><span>确认修改邮箱并重新验证</span></label>
          <div class="profile-actions"><button class="btn btn-primary profile-button primary" type="submit" disabled={!profile || pending !== null || !confirmed || email.trim().toLowerCase() === profile.email.toLowerCase()}>{pending === 'email' ? '正在更新' : '更新邮箱并退出登录'}</button></div>
        </form>
      </ModuleCard>
      <ModuleCard labelledBy="profile-password-title">
        <PanelHeading id="profile-password-title" title="登录密码" accent="var(--color-warning-content)" />
        <div class="profile-form">
          <label for="password-recipient">收件邮箱</label>
          <input class="input" id="password-recipient" value={profile?.email || data.email} readonly />
          <div class="profile-actions"><button class="btn btn-outline profile-button" type="button" disabled={!profile || pending !== null} onclick={() => submit('password')}>{pending === 'password' ? '正在请求' : '发送密码重置邮件'}</button></div>
        </div>
      </ModuleCard>
      <ModuleCard labelledBy="profile-preferences-title">
        <PanelHeading id="profile-preferences-title" title="个性化配置" accent="var(--color-secondary)" />
        <form class="profile-form" onsubmit={(event) => { event.preventDefault(); persistPreferences(); }}>
          <fieldset class="fieldset"><legend class="fieldset-legend">行情颜色逻辑</legend>
            <label class="profile-choice"><input class="radio radio-primary" type="radio" name="marketColorConvention" bind:group={marketColorConvention} value="red-up-green-down" /><span>红涨绿跌</span></label>
            <label class="profile-choice"><input class="radio radio-primary" type="radio" name="marketColorConvention" bind:group={marketColorConvention} value="green-up-red-down" /><span>绿涨红跌</span></label>
          </fieldset>
          <div class="profile-actions"><button class="btn btn-primary profile-button primary" type="submit">保存个性化配置</button></div>
        </form>
      </ModuleCard>
      <div class="profile-permissions">
        <ModuleCard labelledBy="profile-permissions-title">
          <PanelHeading id="profile-permissions-title" title="账号权限" />
          {#if profile}
            <ul class="permission-roles" aria-label="已分配角色">
              {#each profile.roles as role}<li><ShieldCheck size={16} aria-hidden="true" /><span>{roleLabel(role.name)}</span></li>{:else}<li>暂无角色</li>{/each}
            </ul>
            <PermissionExplorer {permissions} grantedOnly />
            <div class="permission-footer">
              <a class="btn btn-outline profile-button" href="/auth/login?returnTo=%2Fprofile"><RefreshCw size={18} aria-hidden="true" />刷新权限</a>
            </div>
          {:else}<div class="permission-status" role="status">{#if loading}<span class="loading loading-spinner" aria-label="加载权限"></span>{:else}<button class="btn btn-outline" type="button" onclick={() => loadProfile()}>重新加载</button>{/if}</div>{/if}
        </ModuleCard>
      </div>
    </div>
    <div class="profile-footer"><form method="post" action="/auth/logout"><button class="btn btn-outline profile-button" type="submit">退出登录</button></form></div>
  </main>
</div>
