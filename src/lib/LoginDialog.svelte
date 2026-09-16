<script lang="ts">
  import Modal from "$lib/components/Modal.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { onMount, onDestroy } from 'svelte';
  import type { ClientSession } from './client-session';
  import { createLoginPopup } from './login-popup';
  import { globalMessages } from './global-messages';

  let { session }: { session: ClientSession } = $props();
  let dialog: Modal;
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

<Modal bind:this={dialog}  aria-labelledby="site-login-title" oncancel={() => finish(false)} onclose={() => { if (!dialog.isOpen() && pending) finish(false); }}>
  <div class="dialog-body site-login-box">
    <h2 id="site-login-title">{waiting ? '等待登录' : '登录后继续'}</h2>
    <div class="dialog-actions">
      <Button data-ui-owner="lib-LoginDialog-svelte" variant="ghost" type="button" class={"ui-button "} onclick={() => finish(false)}>取消</Button>
      {#if waiting}<Button data-ui-owner="lib-LoginDialog-svelte" variant="ghost" type="button" class={"ui-button "} onclick={() => popup?.verify()}>已完成登录</Button>{/if}
      <Button data-ui-owner="lib-LoginDialog-svelte" variant="default" type="button" class={"ui-button "} onclick={() => popup?.open()}>{waiting ? '重新打开登录窗口' : '登录 / 注册'}</Button>
    </div>
  </div>
</Modal>

<style>
  .site-login-box { max-width: 30rem; max-height: calc(100dvh - 2rem); overflow-y: auto; }
  h2 { margin: 0 0 1rem; font-size: 1.25rem; }
  .dialog-actions { flex-wrap: wrap; }
</style>
