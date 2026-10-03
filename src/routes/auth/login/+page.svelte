<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { loginRedirect } from '$lib/bearer-auth';
  let failure = $state('');
  let pending = $state(false);
  let returnTo = '/';
  async function retry() {
    if (pending) return;
    pending = true;
    try { await loginRedirect(returnTo); }
    catch { failure = '登录暂时不可用'; pending = false; }
  }
  onMount(() => {
    const params = new URL(window.location.href).searchParams;
    returnTo = params.get('returnTo') ?? '/';
    if (params.has('error')) failure = params.get('error') === 'callback' ? '登录未完成' : '登录暂时不可用';
    else void retry();
  });
</script>
<svelte:head><title>登录 · 资金管理部</title></svelte:head>
{#if failure}<main class="login-retry"><h1>{failure}</h1><Button onclick={retry} disabled={pending}>{pending ? '正在登录' : '重新登录'}</Button><Button variant="ghost" href="/">返回首页</Button></main>{/if}
<style>.login-retry{min-height:100dvh;display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:1rem;padding:2rem}h1{width:100%;text-align:center;font-size:1.25rem}</style>
