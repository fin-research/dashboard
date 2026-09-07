import test from 'node:test';
import assert from 'node:assert/strict';
import registration from '../auth0/actions/eastmoney-registration.cjs';
import synchronization from '../auth0/actions/eastmoney-signup-profile.cjs';

function signup(body = { 'ulp-name': '  张三  ', 'ulp-department': '  资金管理部  ' }) {
  const calls = { denied: [], errors: [], metadata: {}, app: {} };
  return { event: { connection: { name: 'eastmoney-email' }, user: { email: 'new@18.cn' }, request: { body } },
    api: { access: { deny: (...args) => calls.denied.push(args) }, validation: { error: (...args) => calls.errors.push(args) },
      user: { setUserMetadata: (key, value) => calls.metadata[key] = value, setAppMetadata: (key, value) => calls.app[key] = value } }, calls };
}

test('signup persists trimmed name and department without granting business permissions', async () => {
  const { event, api, calls } = signup();
  event.request.body.app_metadata = { role: 'admin' };
  await registration.onExecutePreUserRegistration(event, api);
  assert.deepEqual(calls, { denied: [], errors: [], metadata: { name: '张三', department: '资金管理部' },
    app: { eastmoney_signup_profile_pending: true } });
});

test('signup rejects absent, blank, malformed and oversized fields before writing any metadata', async () => {
  for (const field of ['ulp-name', 'ulp-department']) for (const value of [undefined, null, '  ', [], {}, 'x'.repeat(101), '<script>', 'a\nb']) {
    const { event, api, calls } = signup({ 'ulp-name': '张三', 'ulp-department': '资金管理部', [field]: value });
    await registration.onExecutePreUserRegistration(event, api);
    assert.equal(calls.errors.length, 1);
    assert.deepEqual(calls.metadata, {});
    assert.deepEqual(calls.app, {});
  }
});

test('signup preserves email-domain restrictions and ignores other connections', async () => {
  const denied = signup(); denied.event.user.email = 'person@example.com';
  await registration.onExecutePreUserRegistration(denied.event, denied.api);
  assert.equal(denied.calls.denied.length, 1); assert.deepEqual(denied.calls.metadata, {});
  const other = signup(); other.event.connection.name = 'other';
  await registration.onExecutePreUserRegistration(other.event, other.api);
  assert.deepEqual(other.calls, { denied: [], errors: [], metadata: {}, app: {} });
});

function login() {
  const calls = { denied: [], app: [] };
  return { event: { client: { client_id: 'eastmoney' }, connection: { name: 'eastmoney-email' },
    secrets: { EASTMONEY_CLIENT_ID: 'eastmoney', PROFILE_CLIENT_ID: 'profile', PROFILE_CLIENT_SECRET: 'test-secret' },
    user: { user_id: 'auth0|new', user_metadata: { name: '张三', department: '资金管理部' }, app_metadata: { eastmoney_signup_profile_pending: true } } },
    api: { access: { deny: (message) => calls.denied.push(message) }, user: { setAppMetadata: (...args) => calls.app.push(args) } }, calls };
}

test('initial login stores the real name in Auth0 name and nickname with no username or role write', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push({ url, ...init, body: JSON.parse(init.body) });
    assert.equal(init.redirect, 'manual');
    if (url.endsWith('/oauth/token')) return Response.json({ access_token: 'test-token' });
    assert.equal(url, 'https://hasbai.eu.auth0.com/api/v2/users/auth0%7Cnew');
    assert.equal(init.headers.Authorization, 'Bearer test-token');
    return Response.json({ name: '张三', nickname: '张三' });
  });
  const { event, api, calls } = login();
  await synchronization.onExecutePostLogin(event, api);
  assert.deepEqual(requests[1].body, { name: '张三', nickname: '张三' });
  assert.deepEqual(calls, { denied: [], app: [['eastmoney_signup_profile_pending', false]] });
});

test('existing accounts, unrelated applications and completed synchronizations perform no management requests', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected request'); });
  for (const mutate of [e => e.user.app_metadata = {}, e => e.user.app_metadata.eastmoney_signup_profile_pending = false,
    e => e.client.client_id = 'other', e => e.connection.name = 'other']) {
    const { event, api, calls } = login(); mutate(event);
    await synchronization.onExecutePostLogin(event, api);
    assert.deepEqual(calls, { denied: [], app: [] });
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('management failure preserves the pending marker for a later login retry and never leaks credentials', async (t) => {
  for (const status of [302, 400, 401, 403, 429, 500]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => new Response('test-secret', { status }));
    const { event, api, calls } = login();
    await synchronization.onExecutePostLogin(event, api);
    assert.deepEqual(calls, { denied: ['暂时无法保存注册资料，请稍后重新登录'], app: [] });
    mock.mock.restore();
  }
});
