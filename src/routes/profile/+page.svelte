<script lang="ts">
  import '../../styles.css';
  import './profile.css';
  import { onMount } from 'svelte';
  import ModuleCard from '../../components/ModuleCard.svelte';
  import { globalMessages } from '$lib/global-messages';
  import { isLoginRedirecting } from '$lib/auth-client';
  import { DASHBOARD_PERMISSIONS, type AccountProfile } from '$lib/profile';
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
  const roleLabels: Record<string, string> = { admin: '管理员', handler: '经办', reviewer: '复核' };

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
      if (typeof result.name === 'string') { profile = { ...profile, name: result.name }; name = result.name; }
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
  <title>个人信息 · 资金管理部</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="profile-page">
  <header class="profile-header">
    <a class="profile-back" href="/" aria-label="返回市场研究门户"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12.5 4-6 6 6 6" /></svg></a>
    <h1>个人信息</h1>
    <form class="logout-form" method="post" action="/auth/logout"><button class="profile-button" type="submit">退出登录</button></form>
  </header>
  <main class="profile-content">
    <div class="profile-summary">
      <span class="profile-avatar" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></svg></span>
      <div><strong>{profile?.name || '我的账号'}</strong><span>{profile?.email || data.email}</span></div>
      <span class="profile-tag">已登录</span>
    </div>
    {#if loading}
      <div class="profile-state" role="status">正在读取个人信息…</div>
    {:else if loadError}
      <div class="profile-state" role="alert"><p>{loadError}</p><button class="profile-button" type="button" onclick={() => loadProfile()}>重新读取</button></div>
    {/if}
    <div class="profile-grid">
      <ModuleCard labelledBy="profile-details-title">
        <h2 id="profile-details-title">个人资料</h2>
        <form class="profile-form" onsubmit={(event) => { event.preventDefault(); void submit('name'); }}>
          <label for="profile-name">显示姓名</label>
          <input id="profile-name" name="name" autocomplete="name" bind:value={name} required maxlength="50" disabled={!profile || pending !== null} />
          <div class="profile-actions"><button class="profile-button primary" type="submit" disabled={!profile || pending !== null}>{pending === 'name' ? '正在保存' : '保存个人资料'}</button></div>
        </form>
      </ModuleCard>
      <ModuleCard labelledBy="profile-email-title">
        <h2 id="profile-email-title">登录邮箱</h2>
        <form class="profile-form" onsubmit={(event) => { event.preventDefault(); void submit('email'); }}>
          <label for="profile-email">邮箱地址 {#if profile}<span class="field-status">{profile.emailVerified ? '已验证' : '待验证'}</span>{/if}</label>
          <input id="profile-email" name="email" type="email" autocomplete="email" bind:value={email} required maxlength="254" pattern="[^@\s]+@18\.[cC][nN]" disabled={!profile || pending !== null} aria-describedby="email-help" />
          <p class="profile-help" id="email-help">仅支持 18.cn 邮箱。修改后请验证新邮箱，并重新登录。</p>
          <label class="profile-choice"><input type="checkbox" bind:checked={confirmed} disabled={!profile || pending !== null} /><span>确认修改登录邮箱</span></label>
          <div class="profile-actions"><button class="profile-button primary" type="submit" disabled={!profile || pending !== null || !confirmed || email.trim().toLowerCase() === profile.email.toLowerCase()}>{pending === 'email' ? '正在更新' : '更新邮箱并退出登录'}</button></div>
        </form>
      </ModuleCard>
      <ModuleCard labelledBy="profile-password-title">
        <h2 id="profile-password-title">登录密码</h2>
        <div class="profile-form">
          <p class="profile-help">向当前登录邮箱发送密码重置邮件，在邮件中的安全页面设置新密码。</p>
          <div class="profile-actions"><button class="profile-button" type="button" disabled={!profile || pending !== null} onclick={() => submit('password')}>{pending === 'password' ? '正在请求' : '发送密码重置邮件'}</button></div>
        </div>
      </ModuleCard>
      <ModuleCard labelledBy="profile-preferences-title">
        <h2 id="profile-preferences-title">个性化配置</h2>
        <form class="profile-form" onsubmit={(event) => { event.preventDefault(); persistPreferences(); }}>
          <fieldset><legend>行情颜色逻辑</legend>
            <label class="profile-choice"><input type="radio" name="marketColorConvention" bind:group={marketColorConvention} value="red-up-green-down" /><span>红涨绿跌（默认）</span></label>
            <label class="profile-choice"><input type="radio" name="marketColorConvention" bind:group={marketColorConvention} value="green-up-red-down" /><span>绿涨红跌</span></label>
          </fieldset>
          <p class="profile-help">沿用此浏览器已保存的配置，保存后立即生效。</p>
          <div class="profile-actions"><button class="profile-button primary" type="submit">保存个性化配置</button></div>
        </form>
      </ModuleCard>
      <div class="profile-permissions">
        <ModuleCard labelledBy="profile-permissions-title">
          <h2 id="profile-permissions-title">账号权限</h2>
          <h3>市场研究</h3>
          <ul class="permission-list">{#each DASHBOARD_PERMISSIONS as permission}<li>{permission}</li>{/each}</ul>
          <h3>已分配角色</h3>
          {#if profile}
            {#if profile.roles.length}<ul class="permission-list">{#each profile.roles as role}<li>{roleLabels[role.name] || role.name}{#if role.description && role.description !== role.name}<span>{role.description}</span>{/if}</li>{/each}</ul>{:else}<p class="profile-help">未分配业务角色</p>{/if}
            <h3>已分配业务权限</h3>
            {#if profile.permissions.length}
              <ul class="permission-list">{#each profile.permissions as permission}<li><strong>{permission.description || permission.name}</strong><span>{permission.name}</span><span>{permission.resource === 'https://eastmoney.hasbai.xyz/financing' ? '融资工作台' : permission.resource}</span></li>{/each}</ul>
            {:else}<p class="profile-help">未分配额外业务权限</p>{/if}
            <p class="profile-help">融资工作台还需关联已启用的业务人员。权限由管理员维护。</p>
          {:else}<p class="profile-help">{loading ? '正在读取角色与权限…' : '角色与权限暂时无法读取，请重新读取个人信息'}</p>{/if}
        </ModuleCard>
      </div>
    </div>
  </main>
</div>
