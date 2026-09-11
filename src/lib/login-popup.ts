import type { ClientSession } from './client-session';

export type LoginPopupMessage = { type: 'eastmoney:login'; id: string; ok: boolean };
export function isLoginPopupMessage(data: unknown, id: string): data is LoginPopupMessage {
  if (!data || typeof data !== 'object') return false;
  const value = data as Partial<LoginPopupMessage>;
  return value.type === 'eastmoney:login' && value.id === id && typeof value.ok === 'boolean';
}

/** Notifications are hints only: identity is always loaded from the HttpOnly session. */
export function createLoginPopup(state: ClientSession, options: {
  complete: () => void;
  error: (message: string) => void;
  waiting: (value: boolean) => void;
}, host: Window = window) {
  let popup: Window | null = null;
  let channel: BroadcastChannel | null = null;
  let id = '';
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let verifying = false;
  let revision = 0;
  function stop() {
    revision++;
    id = '';
    if (timeout) clearTimeout(timeout);
    host.removeEventListener('message', onMessage);
    host.removeEventListener('focus', onFocus);
    channel?.close(); channel = null;
    popup?.close(); popup = null;
    options.waiting(false);
  }
  async function verify() {
    if (verifying || !id) return;
    const attempt = revision;
    verifying = true;
    try {
      // Drain a pre-login bootstrap before forcing a fresh post-login snapshot.
      await state.load();
      if (attempt !== revision) return;
      const session = await state.load(true);
      if (attempt === revision && session.user) { stop(); options.complete(); }
    } catch (error) {
      if (attempt === revision) options.error(error instanceof Error ? error.message : '登录状态读取失败，请重试');
    } finally { verifying = false; }
  }
  function receive(data: unknown) {
    if (!isLoginPopupMessage(data, id)) return;
    if (data.ok) void verify();
    else { stop(); options.error('登录未完成，请重试'); }
  }
  function onMessage(event: MessageEvent) {
    if (event.origin === host.location.origin && event.source === popup) receive(event.data);
  }
  function onFocus() { void verify(); }
  function open() {
    stop();
    id = crypto.randomUUID().replaceAll('-', '');
    host.addEventListener('message', onMessage);
    host.addEventListener('focus', onFocus);
    // BroadcastChannel also works when the identity provider severs window.opener via COOP.
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel('eastmoney:login:' + id);
      channel.onmessage = event => receive(event.data);
    }
    popup = host.open('/auth/login?popup=' + id, 'eastmoney-login-' + id, 'popup,width=480,height=720');
    if (!popup) { stop(); options.error('登录窗口被拦截，请允许弹出窗口后重试'); return; }
    options.waiting(true);
    popup.focus();
    timeout = setTimeout(() => { stop(); options.error('登录等待已超时，请重试'); }, 10 * 60 * 1000);
  }
  return { open, stop, verify };
}
