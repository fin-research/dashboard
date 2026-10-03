import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoginPopup } from '../src/lib/login-popup.ts';
import { createClientSession } from '../src/lib/client-session.ts';
import { publicSession } from '../src/lib/identity.ts';
const anonymous = publicSession(null);
const authenticated = { ...anonymous, user: { id: 'auth0|test', email: 'test@18.cn', auth0Id: 'auth0|test' }, expiresAt: Date.now()/1000 + 3600 };
function fixture(blocked = false) {
  const child = { close() {} };
  return { child, open: () => blocked ? null : child };
}
test('SDK popup is opened synchronously and only a Gateway validated snapshot completes login', async () => {
  const host = fixture(); const state = createClientSession(anonymous); let complete = 0, opened = false;
  host.open = () => { opened = true; return host.child; };
  const popup = createLoginPopup(state, { complete: () => complete++, error: assert.fail, waiting() {} }, host, async child => {
    assert.equal(opened, true); assert.equal(child, host.child); return authenticated;
  });
  await popup.open(); assert.equal(complete, 1); assert.deepEqual(state.current(), authenticated);
});
test('cancelled popup cannot seed a late result; anonymous and SDK failures do not authenticate', async () => {
  let resolve; const state = createClientSession(anonymous); let complete = 0; const errors = [];
  const popup = createLoginPopup(state, { complete: () => complete++, error: error => errors.push(error), waiting() {} }, fixture(), () => new Promise(done => resolve = done));
  const pending = popup.open(); popup.stop(); resolve(authenticated); await pending;
  assert.equal(complete, 0); assert.equal(state.current().user, null);
  for (const authenticate of [async () => anonymous, async () => { throw Error('cancelled'); }]) {
    await createLoginPopup(state, { complete: assert.fail, error: error => errors.push(error), waiting() {} }, fixture(), authenticate).open();
  }
  assert.equal(errors.length, 2); assert.equal(state.current().user, null);
});
test('blocked popup reports error without calling the SDK', async () => {
  const errors = [];
  await createLoginPopup(createClientSession(anonymous), { complete: assert.fail, error: value => errors.push(value), waiting() {} }, fixture(true), async () => assert.fail()).open();
  assert.equal(errors.length, 1);
});
