import assert from 'node:assert/strict';
import { installDom, loadComponent } from './svelte-dom.mjs';
const host = installDom();
const { mount, unmount, flushSync } = await import('svelte');
const { createClientSession } = await import('../../src/lib/client-session.ts');
const anonymous = { user: null, account: null, roles: [], permissions: [], expiresAt: null };
const state = createClientSession(anonymous, async () => Response.json({ ...anonymous, user: { email: 'test@18.cn' }, expiresAt: Date.now() / 1000 + 86400 }));
const target = document.createElement('div'); document.body.append(target);
const LoginDialog = await loadComponent('src/lib/LoginDialog.svelte');
const component = mount(LoginDialog, { target, props: { session: state } }); flushSync();
try {
  const first = component.open(); assert.equal(first, component.open());
  assert.equal(document.querySelector('dialog').open, true);
  document.querySelector('dialog').dispatchEvent(new host.Event('cancel')); flushSync();
  assert.equal(await first, false); assert.equal(document.querySelector('dialog').open, false);
  const next = component.open(); flushSync(); assert.equal(document.querySelector('dialog').open, true);
  const child = { focus() {}, close() {} }; let loginUrl;
  host.open = (url) => { loginUrl = url; return child; };
  [...document.querySelectorAll('button')].find(button => button.textContent.includes('登录 / 注册')).click(); flushSync();
  const id = new URL(loginUrl, host.location.origin).searchParams.get('popup');
  host.dispatchEvent(new host.MessageEvent('message', { origin: host.location.origin, source: child, data: { type: 'eastmoney:login', id, ok: true } }));
  assert.equal(await next, true); flushSync();
  assert.equal(document.querySelector('dialog').open, false);
  assert.equal(host.location.pathname, '/credit-workbench/assistant');
  console.log('Login dialog cancellation, retry and completion preserve the page');
} finally { await unmount(component); }
