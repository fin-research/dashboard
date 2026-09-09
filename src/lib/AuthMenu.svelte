<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import type { AccountSummary } from '$lib/identity';

  const currentAccount = getContext<() => AccountSummary | null>('site-account') ?? (() => null);
  let sessionAccount = $state<AccountSummary | null>(null);
  let checking = $state(true);
  const account = $derived(currentAccount() ?? sessionAccount);

  onMount(() => {
    if (currentAccount()) { checking = false; return; }
    const controller = new AbortController();
    void fetch('/auth/session', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) return;
        const session = await response.json();
        if (!controller.signal.aborted) sessionAccount = session.account ?? null;
      })
      .catch(() => {})
      .finally(() => { if (!controller.signal.aborted) checking = false; });
    return () => controller.abort();
  });
</script>

<a class="btn btn-ghost account-button" href="/profile" aria-label={account ? `个人管理：${account.name}，${account.department || '未填写部门'}` : '个人管理'}>
  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></svg>
  <span>{account?.name || (checking ? '个人管理' : '登录 / 注册')}{#if account}<span class="account-divider" aria-hidden="true">&nbsp;/&nbsp;</span><span class="account-department">{account.department || '未填写部门'}</span>{/if}</span>
</a>

<style>
  svg { width: 20px; height: 20px; flex-shrink: 0; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .account-button { max-width: 100%; margin-inline-start: auto; flex-shrink: 0; gap: .5rem; padding-inline: .75rem; font-size: 1rem; text-decoration: none; }
  .account-button > span { overflow-wrap: anywhere; text-align: left; }
  .account-department, .account-divider { color: var(--muted); font-weight: normal; }
  @media print { .account-button { display: none; } }
</style>
