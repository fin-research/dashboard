<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { ClientSession } from './client-session';
  import { createLoginPopup } from './login-popup';
  import { globalMessages } from './global-messages';

  let { session }: { session: ClientSession } = $props();
  let dialog: HTMLDialogElement;
  let waiting = $state(false);
  let resolveLogin: ((result: boolean) => void) | null = null;
  let pending: Promise<boolean> | null = null;
  let popup: ReturnType<typeof createLoginPopup> | undefined;
  function finish(result: boolean) {
    const resolve = resolveLogin;
    resolveLogin = null; pending = null;
    popup?.stop();
    dialog?.close();
    resolve?.(result);
  }
  export function open(): Promise<boolean> {
    if (pending) return pending;
    pending = new Promise(resolve => { resolveLogin = resolve; });
    dialog.showModal();
    return pending;
  }
  onMount(() => {
    popup = createLoginPopup(session, {
      complete: () => finish(true), error: message => globalMessages.error(message), waiting: value => { waiting = value; },
    });
  });
  onDestroy(() => finish(false));
</script>

<dialog bind:this={dialog} class="modal" aria-labelledby="site-login-title" oncancel={() => finish(false)} onclose={() => { if (!dialog.open && pending) finish(false); }}>
  <div class="modal-box site-login-box">
    <h2 id="site-login-title">登录后继续</h2>
    <p>{waiting ? '请在登录窗口完成登录。当前页面和输入会保留。' : '此操作需要登录。登录完成后可继续当前操作。'}</p>
    <div class="modal-action">
      <button type="button" class="btn btn-ghost" onclick={() => finish(false)}>取消</button>
      {#if waiting}<button type="button" class="btn btn-ghost" onclick={() => popup?.verify()}>已完成登录</button>{/if}
      <button type="button" class="btn btn-primary" onclick={() => popup?.open()}>{waiting ? '重新打开登录窗口' : '登录 / 注册'}</button>
    </div>
  </div>
</dialog>

<style>
  .site-login-box { max-width: 30rem; max-height: calc(100dvh - 2rem); overflow-y: auto; }
  h2 { margin: 0 0 1rem; font-size: 1.25rem; }
  p { color: var(--muted); line-height: 1.6; }
  .modal-action { flex-wrap: wrap; }
</style>
