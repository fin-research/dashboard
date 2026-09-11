import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createLoginPopup, isLoginPopupMessage } from '../src/lib/login-popup.ts';
import { createClientSession } from '../src/lib/client-session.ts';

const anonymous = { user: null, account: null, roles: [], permissions: [], expiresAt: null };
const authenticated = { ...anonymous, user: { email: 'test@18.cn' }, expiresAt: Date.now() / 1000 + 3600 };
function hostFixture(blocked = false) {
  const handlers = new Map();
  const child = { focus() {}, close() {} };
  const host = { location: { origin: 'https://eastmoney.hasbai.xyz' }, addEventListener: (type, fn) => handlers.set(type, fn), removeEventListener: type => handlers.delete(type),
    open(url) { this.url = url; return blocked ? null : child; } };
  return { host, child, handlers, message(data, origin = host.location.origin, source = child) { handlers.get('message')?.({ data, origin, source }); } };
}

test('popup ignores wrong origin/window/transaction and verifies a matching hint before completion', async () => {
  const f = hostFixture();
  let requests = 0, completed = 0;
  const state = createClientSession(anonymous, async () => { requests++; return Response.json(authenticated); });
  const popup = createLoginPopup(state, { complete: () => completed++, error: assert.fail, waiting() {} }, f.host);
  try {
    popup.open();
    const id = new URL(f.host.url, f.host.location.origin).searchParams.get('popup');
    const data = { type: 'eastmoney:login', id, ok: true };
    for (const bad of [null, {}, { ...data, id: 'old' }, { ...data, ok: 'yes' }]) assert.equal(isLoginPopupMessage(bad, id), false);
    f.message(data, 'https://evil.test'); f.message(data, f.host.location.origin, {}); f.message({ ...data, id: 'old' });
    await setImmediate(); assert.equal(requests, 0); assert.equal(completed, 0);
    f.message(data); await setImmediate();
    assert.equal(requests, 1); assert.equal(completed, 1); assert.equal(state.current().user.email, 'test@18.cn');
    assert.equal(f.handlers.size, 0);
  } finally { popup.stop(); }
});

test('a matching forged success cannot manufacture identity and cancelled verification cannot resume', async () => {
  const f = hostFixture(); let completed = 0;
  const state = createClientSession(anonymous, async () => Response.json(anonymous));
  const popup = createLoginPopup(state, { complete: () => completed++, error: assert.fail, waiting() {} }, f.host);
  try {
    popup.open();
    const id = new URL(f.host.url, f.host.location.origin).searchParams.get('popup');
    f.message({ type: 'eastmoney:login', id, ok: true });
    await setImmediate(); assert.equal(completed, 0);
    const attempt = popup.verify(); popup.stop(); await attempt;
    assert.equal(completed, 0);
  } finally { popup.stop(); }
});

test('blocked popup stays on the current page and allows retry without leaving listeners or timers', () => {
  const f = hostFixture(true); const errors = [];
  const popup = createLoginPopup(createClientSession(anonymous), { complete: assert.fail, error: value => errors.push(value), waiting() {} }, f.host);
  popup.open();
  assert.match(errors[0], /拦截/); assert.equal(f.handlers.size, 0);
  popup.stop();
});
