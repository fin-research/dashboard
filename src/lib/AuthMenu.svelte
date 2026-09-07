<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  let enabled = $state(false);
  let email = $state<string | null>(null);
  onMount(() => {
    const controller = new AbortController();
    void fetch('/auth/session', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const session = await response.json();
        enabled = session.enabled === true;
        email = typeof session.user?.email === 'string' ? session.user.email : null;
      }).catch(() => {});
    return () => controller.abort();
  });
</script>

{#if enabled}
  <nav class="auth-menu" aria-label="统一账号">
    {#if email}
      <form method="post" action="/auth/logout">
        <button type="submit" title={email} aria-label={`退出登录：${email}`}>退出登录</button>
      </form>
    {:else}
      <a data-sveltekit-reload href={`/auth/login?returnTo=${encodeURIComponent(page.url.pathname + page.url.search)}`}>登录 / 注册</a>
    {/if}
  </nav>
{/if}

<style>
  .auth-menu { display: inline-flex; align-items: center; flex: 0 0 auto; }
  form { margin: 0; }
  a, button { display: inline-flex; align-items: center; justify-content: center; min-height: 2.75rem; padding: .5rem .75rem; border: 1px solid var(--border, #d8e0ec); border-radius: .5rem; background: var(--surface, #fff); color: var(--brand, #2f6fd6); font: inherit; font-size: .875rem; text-decoration: none; cursor: pointer; }
  a:focus-visible, button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
  @media print { .auth-menu { display: none; } }
</style>
