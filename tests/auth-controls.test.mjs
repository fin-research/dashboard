import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { Window } from 'happy-dom';
import { installAuthControls } from '../src/lib/auth-controls.ts';
import { installAuthInteraction } from '../src/lib/auth-client.ts';
import { createClientSession } from '../src/lib/client-session.ts';

const anonymous = { user: null, account: null, roles: [], permissions: [], expiresAt: null };
const authenticated = { ...anonymous, user: { email: 'test@18.cn' }, permissions: ['financing.project:create', 'fund.report:read'], expiresAt: Date.now() / 1000 + 3600 };

test('native forms preserve submitter and draft, deduplicate pending clicks, and stop denied submits', async t => {
  const host = new Window({ url: 'https://eastmoney.hasbai.xyz/financing/projects' });
  for (const name of ['Element', 'HTMLFormElement', 'HTMLButtonElement', 'HTMLInputElement']) {
    const old = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value: host[name] });
    t.after(() => old ? Object.defineProperty(globalThis, name, old) : delete globalThis[name]);
  }
  const { document } = host;
  document.body.innerHTML = '<form method="post"><input name="name" value="保留的项目草稿"><button formaction="?/createProject">保存</button></form><a href="/fund-report" data-sveltekit-preload-data="hover">报告</a>';
  const form = document.querySelector('form'), button = document.querySelector('button'), anchor = document.querySelector('a');
  const state = createClientSession(anonymous); let complete; let logins = 0; let sent = 0;
  const errors = [];
  const login = installAuthInteraction({ session: state, login: () => { logins++; return new Promise(resolve => { complete = resolve; }); }, error: value => errors.push(value) });
  const cleanup = installAuthControls(state, document, assert.fail);
  t.after(() => { cleanup(); login(); });
  anchor.dispatchEvent(new host.MouseEvent('mousemove', { bubbles: true }));
  assert.equal(anchor.getAttribute('data-sveltekit-preload-data'), 'off'); assert.equal(logins, 0);
  form.addEventListener('submit', event => { event.preventDefault(); sent++; assert.equal(event.submitter, button); assert.equal(form.querySelector('input').value, '保留的项目草稿'); });
  const submit = () => form.dispatchEvent(new host.SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: button }));
  submit(); submit(); await setImmediate(); assert.equal(logins, 1); assert.equal(sent, 0);
  state.seed(authenticated); complete(true); await setImmediate(); assert.equal(sent, 1);
  anchor.dispatchEvent(new host.MouseEvent('mousemove', { bubbles: true }));
  assert.equal(anchor.getAttribute('data-sveltekit-preload-data'), 'hover');
  state.seed({ ...authenticated, permissions: [] }); submit(); await setImmediate();
  assert.equal(sent, 1); assert.equal(errors.length, 1);
});
