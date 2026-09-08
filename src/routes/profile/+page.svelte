<script lang="ts">
  import './profile.css';
  import { invalidateAll } from '$app/navigation';
  import PanelHeading from '$lib/trading-research/PanelHeading.svelte';
  import { onMount } from 'svelte';
  import ModuleCard from '../../components/ModuleCard.svelte';
  import { globalMessages } from '$lib/global-messages';
  import { isLoginRedirecting } from '$lib/auth-client';
  import { type AccountProfile } from '$lib/profile';
  import { PERMISSION_DOMAINS } from '$lib/permissions';
  import { readPreferences, savePreferences, type MarketColorConvention } from '$lib/preferences';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
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
      if (typeof result.name === 'string') { profile = { ...profile, name: result.name }; name = result.name; await invalidateAll(); }
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
    <form class="logout-form" method="post" action="/auth/logout"><button class="btn btn-outline profile-button" type="submit">退出登录</button></form>
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
        <PanelHeading id="profile-email-title" title="登录邮箱" />
        <form class="profile-form" onsubmit={(event) => { event.preventDefault(); void submit('email'); }}>
          <label for="profile-email">邮箱地址 {#if profile}<span class="field-status">{profile.emailVerified ? '已验证' : '待验证'}</span>{/if}</label>
          <input class="input" id="profile-email" name="email" type="email" autocomplete="email" bind:value={email} required maxlength="254" pattern="[^@\s]+@18\.[cC][nN]" disabled={!profile || pending !== null} aria-describedby="email-help" />
          <p class="profile-help" id="email-help">仅支持 18.cn 邮箱。修改后请验证新邮箱，并重新登录。</p>
          <label class="profile-choice"><input class="checkbox checkbox-primary" type="checkbox" bind:checked={confirmed} disabled={!profile || pending !== null} /><span>确认修改登录邮箱</span></label>
          <div class="profile-actions"><button class="btn btn-primary profile-button primary" type="submit" disabled={!profile || pending !== null || !confirmed || email.trim().toLowerCase() === profile.email.toLowerCase()}>{pending === 'email' ? '正在更新' : '更新邮箱并退出登录'}</button></div>
        </form>
      </ModuleCard>
      <ModuleCard labelledBy="profile-password-title">
        <PanelHeading id="profile-password-title" title="登录密码" />
        <div class="profile-form">
          <p class="profile-help">向当前登录邮箱发送密码重置邮件，在邮件中的安全页面设置新密码。</p>
          <div class="profile-actions"><button class="btn btn-outline profile-button" type="button" disabled={!profile || pending !== null} onclick={() => submit('password')}>{pending === 'password' ? '正在请求' : '发送密码重置邮件'}</button></div>
        </div>
      </ModuleCard>
      <ModuleCard labelledBy="profile-preferences-title">
        <PanelHeading id="profile-preferences-title" title="个性化配置" />
        <form class="profile-form" onsubmit={(event) => { event.preventDefault(); persistPreferences(); }}>
          <fieldset class="fieldset"><legend class="fieldset-legend">行情颜色逻辑</legend>
            <label class="profile-choice"><input class="radio radio-primary" type="radio" name="marketColorConvention" bind:group={marketColorConvention} value="red-up-green-down" /><span>红涨绿跌（默认）</span></label>
            <label class="profile-choice"><input class="radio radio-primary" type="radio" name="marketColorConvention" bind:group={marketColorConvention} value="green-up-red-down" /><span>绿涨红跌</span></label>
          </fieldset>
          <p class="profile-help">沿用此浏览器已保存的配置，保存后立即生效。</p>
          <div class="profile-actions"><button class="btn btn-primary profile-button primary" type="submit">保存个性化配置</button></div>
        </form>
      </ModuleCard>
      <div class="profile-permissions">
        <ModuleCard labelledBy="profile-permissions-title">
          <PanelHeading id="profile-permissions-title" title="账号权限" />
          <h3>已分配角色</h3>
          {#if profile}
            {#if profile.roles.length}<ul class="permission-list">{#each profile.roles as role}<li>{role.name}{#if role.description && role.description !== role.name}<span>{role.description}</span>{/if}</li>{/each}</ul>{:else}<p class="profile-help">未分配业务角色</p>{/if}
            <h3>当前有效权限</h3>
            {#if profile.permissions.length}
              <ul class="permission-list">{#each profile.permissions as permission}<li><strong>{permission.description || permission.name}</strong><span>{permission.name}</span><span>{PERMISSION_DOMAINS[permission.resource] ?? permission.resource}</span></li>{/each}</ul>
            {:else}<p class="profile-help">未分配额外业务权限</p>{/if}
            <p class="profile-help">角色及成员由 Auth0 管理，应用权限由管理中心统一配置。</p>
          {:else}<p class="profile-help">{loading ? '正在读取角色与权限…' : '角色与权限暂时无法读取，请重新读取个人信息'}</p>{/if}
        </ModuleCard>
      </div>
    </div>
  </main>
</div>
