// Run after pnpm build. No production bindings, account changes, or email delivery.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Server } from '../.svelte-kit/output/server/index.js';
import { manifest } from '../.svelte-kit/output/server/manifest.js';

const { vars } = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const { privateKey, publicKey } = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
const origin = 'https://eastmoney.hasbai.xyz';
const token = await new SignJWT({ type: 'app', email: 'route-test@18.cn', custom: { eastmoney_user_id: 'auth0|route-test' } })
  .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setSubject('access-subject').setIssuer(`https://${vars.ACCESS_TEAM_DOMAIN}`)
  .setAudience(vars.ACCESS_AUD).setIssuedAt().setExpirationTime('5m').sign(privateKey);
const storage = new Map();
const account = { user_id: 'auth0|route-test', email: 'route-test@18.cn', name: '路由测试', email_verified: true, identities: [{ connection: 'eastmoney-email' }] };
const mutations = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.href === `https://${vars.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
  assert.equal(url.origin, `https://${vars.AUTH0_DOMAIN}`, 'Unexpected network request');
  if (url.pathname === '/oauth/token') return Response.json({ access_token: 'test-management-token' });
  if (url.pathname.endsWith('/roles') || url.pathname.endsWith('/permissions')) return Response.json([]);
  assert.equal(url.pathname, '/api/v2/users/auth0%7Croute-test');
  if (init.method === 'PATCH') {
    const body = JSON.parse(init.body);
    mutations.push(body);
    Object.assign(account, body);
  }
  return Response.json(account);
};
const env = { ...vars, AUTH0_MANAGEMENT_CLIENT_SECRET: 'test-only-secret', EASTMONEY: {
  async list() { return { objects: [...storage].map(([key, value]) => ({ key, size: value.byteLength, uploaded: new Date() })), truncated: false }; },
  async head(key) { return storage.has(key) ? { key } : null; },
  async put(key, value) { storage.set(key, value); return { key, etag: "mock-etag" }; },
} };
const server = new Server(manifest);
await server.init({ env });
const respond = (path, { authenticated = false, method = 'GET', headers = {}, body } = {}) => server.respond(
  new Request(origin + path, { method, headers: { Accept: 'text/html', Origin: origin, ...(authenticated ? { Cookie: `CF_Authorization=${token}` } : {}), ...headers }, body }),
  { getClientAddress: () => '127.0.0.1', platform: { env, context: { waitUntil() {} } } },
);
let checks = 0;
try {
  for (const method of ['GET', 'POST']) {
    const response = await respond('/auth/logout?returnTo=https://other.test', { method });
    assert.equal(response.status, 303);
    const destination = new URL(response.headers.get('location'));
    assert.equal(destination.origin, `https://${vars.AUTH0_LOGIN_DOMAIN}`);
    assert.equal(destination.pathname, '/v2/logout');
    assert.equal(destination.searchParams.get('client_id'), vars.AUTH0_CLIENT_ID);
    const accessLogout = new URL(destination.searchParams.get('returnTo'));
    assert.equal(accessLogout.origin, `https://${vars.ACCESS_TEAM_DOMAIN}`);
    assert.equal(accessLogout.pathname, '/cdn-cgi/access/logout');
    assert.equal(accessLogout.searchParams.get('returnTo'), `${origin}/`);
    assert.equal(response.headers.get('cache-control'), 'no-store, private');
    assert.match(response.headers.get('set-cookie'), /CF_Authorization=;/);
    assert.match(response.headers.get('set-cookie'), /financing_session=;/);
    checks++;
  }
  for (const path of ['/profile', '/trading-research', '/trading-research/credit']) {
    const response = await respond(path);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), `/auth/login?returnTo=${encodeURIComponent(path)}`);
    checks++;
    const data = await respond(`${path}/__data.json`, { headers: { Accept: '*/*' } });
    assert.deepEqual(await data.json(), { type: 'redirect', location: `/auth/login?returnTo=${encodeURIComponent(path)}` });
    checks++;
  }
  const notice = await respond('/auth/verify-email?state=opaque-test-state&email=must-not-render%4018.cn');
  assert.equal(notice.status, 200);
  assert.match(notice.headers.get('cache-control'), /no-store/);
  assert.equal(notice.headers.get('referrer-policy'), 'no-referrer');
  const noticeHtml = await notice.text();
  assert.match(noticeHtml, /请检查验证邮件/);
  assert.match(noticeHtml, /我已验证，继续登录/);
  assert.doesNotMatch(noticeHtml, /opaque-test-state|must-not-render|access_denied|role="alert"/);
  checks++;
  const denied = await respond('/api/fund-report', { method: 'POST', headers: { Accept: '*/*' } });
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).code, 'LOGIN_REQUIRED');
  assert.equal(storage.size, 0); checks++;
  const legacy = await respond('/management?upload=1', { authenticated: true });
  assert.equal(legacy.headers.get('location'), '/fund-report?upload=1'); checks++;
  const history = await respond('/fund-report');
  assert.equal(history.status, 200);
  assert.match(await history.text(), /上传资金日报/); checks++;
  const profile = await respond('/profile', { authenticated: true });
  assert.equal(profile.status, 200);
  assert.match(profile.headers.get('cache-control'), /no-store/);
  assert.match(await profile.text(), /个性化配置/); checks++;
  const profileApi = await respond('/api/profile', { authenticated: true, headers: { Accept: 'application/json' } });
  assert.equal(profileApi.status, 200);
  assert.equal((await profileApi.json()).email, account.email); checks++;
  const html = '<!doctype html><html><body>route smoke</body></html>';
  const uploaded = await respond('/api/fund-report', { authenticated: true, method: 'POST', headers: {
    Accept: 'application/json', 'Content-Type': 'text/html', 'X-Fund-Report-Filename': encodeURIComponent('资金日报_20260907.html'),
    'X-Fund-Report-Size': String(Buffer.byteLength(html)),
  }, body: html });
  assert.equal(uploaded.status, 201);
  assert.equal((await uploaded.json()).fileName, '2026-09-07.html');
  assert.equal(storage.size, 1); checks++;
  const updatedHistory = await respond('/fund-report');
  assert.match(await updatedHistory.text(), /2026-09-07\.html/); checks++;
  const crossSite = await respond('/api/profile', { authenticated: true, method: 'POST', headers: { Accept: 'application/json', Origin: 'https://other.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'name', name: 'bad' }) });
  assert.equal(crossSite.status, 403);
  assert.equal(mutations.length, 0); checks++;
  const update = await respond('/api/profile', { authenticated: true, method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'email', email: 'updated@18.cn', confirmed: true }) });
  assert.equal(update.status, 200);
  assert.equal((await update.json()).logout, true);
  assert.match(update.headers.get('set-cookie'), /CF_Authorization=;/); checks++;
  const stale = await respond('/api/profile', { authenticated: true, headers: { Accept: 'application/json' } });
  assert.equal(stale.status, 401); checks++;
  console.log(`Profile route smoke: ${checks} checks passed (mock Auth0/JWKS, in-memory R2).`);
} finally { globalThis.fetch = originalFetch; }
