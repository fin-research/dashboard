// Run after pnpm build: real SvelteKit HTTP/data handling, mocked Auth0/JWKS.
// No browser, real login, external account changes or production data access.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Server } from '../.svelte-kit/output/server/index.js';
import { manifest } from '../.svelte-kit/output/server/manifest.js';

const { vars } = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const origin = 'https://eastmoney.hasbai.xyz';
const { privateKey, publicKey } = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(publicKey), kid: 'navigation-test', alg: 'RS256', use: 'sig' };
const token = await new SignJWT({ type: 'app', email: 'test@18.cn', custom: { eastmoney_user_id: 'auth0|navigation-test' } })
  .setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).setSubject('navigation-test')
  .setIssuer(`https://${vars.ACCESS_TEAM_DOMAIN}`).setAudience(vars.ACCESS_AUD).setIssuedAt().setExpirationTime('5m').sign(privateKey);
const account = { user_id: 'auth0|navigation-test', email: 'test@18.cn', name: '测试账号',
  email_verified: true, identities: [{ connection: 'eastmoney-email' }], user_metadata: { department: '测试' } };
const upstream = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async input => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  upstream.push(url.pathname);
  if (url.href === `https://${vars.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
  assert.equal(url.origin, `https://${vars.AUTH0_DOMAIN}`, 'Unexpected external service');
  if (url.pathname === '/oauth/token') return Response.json({ access_token: 'unit-fixture', expires_in: 3600 });
  if (url.pathname.endsWith('/roles')) return Response.json([]);
  assert.equal(url.pathname, '/api/v2/users/auth0%7Cnavigation-test');
  return Response.json(account);
};
const env = { ...vars, AUTH0_MANAGEMENT_CLIENT_SECRET: 'unit-fixture' };
const server = new Server(manifest);
await server.init({ env });
const respond = (path, authenticated = true, extra = {}) => server.respond(
  new Request(origin + path, { headers: { ...(authenticated ? { Cookie: `CF_Authorization=${token}` } : {}), ...extra } }),
  { getClientAddress: () => '127.0.0.1', platform: { env, context: { waitUntil() {} } } },
);
async function data(path, authenticated = true) {
  const response = await respond(path, authenticated);
  assert.equal(response.status, 200);
  return JSON.parse((await response.text()).trim());
}
let checks = 0;
try {
  const bootstrap = await data('/trading-research/research/__data.json?x-sveltekit-invalidated=11');
  assert.equal(bootstrap.type, 'data');
  const root = bootstrap.nodes[0];
  assert.equal(root.type, 'data');
  assert.deepEqual(root.uses.dependencies, ['site:session']);
  assert.ok(!root.uses.url && !root.uses.route && !root.uses.parent);
  assert.deepEqual(root.uses.params ?? [], []);
  assert.doesNotMatch(JSON.stringify(root), /routePath|CF_Authorization|unit-fixture/);
  checks++;

  // These are the invalidation masks Kit sends when root dependencies survive.
  // Client-only view changes have no server load at all; SSR pages load only
  // their own data, without transferring the root permission snapshot again.
  for (const path of ['/trading-research/market-hotspots', '/trading-research/policy-tracking', '/credit-workbench/calendar', '/profile']) {
    const payload = await data(path + '/__data.json?x-sveltekit-invalidated=01');
    assert.equal(payload.nodes[0].type, 'skip', path);
    assert.doesNotMatch(JSON.stringify(payload), /research\.workspace:read|permissions|expiresAt/, path);
    checks++;
  }
  const refreshed = await data('/profile/__data.json?x-sveltekit-invalidated=10');
  assert.equal(refreshed.nodes[0].type, 'data', 'explicit site:session invalidation refreshes the snapshot');
  checks++;

  const countBefore = upstream.length;
  const sessionResponse = await respond('/auth/session');
  assert.equal(sessionResponse.status, 200);
  assert.match(sessionResponse.headers.get('cache-control'), /no-store/);
  const session = await sessionResponse.json();
  assert.equal(session.user.email, 'test@18.cn');
  assert.equal(session.account.name, '测试账号');
  assert.ok(session.expiresAt > Date.now() / 1000);
  assert.deepEqual(session.roles, []);
  assert.ok(session.permissions.includes('research.workspace:read'));
  assert.equal(upstream.length - countBefore, 2, 'one account + one roles lookup, no duplicate handler lookup');
  checks++;

  const anonBefore = upstream.length;
  const anonymous = await (await respond('/auth/session', false)).json();
  assert.equal(anonymous.user, null);
  assert.deepEqual(anonymous.permissions, []);
  assert.equal(upstream.length, anonBefore, 'anonymous bootstrap never calls Auth0');
  const rejected = await data('/profile/__data.json?x-sveltekit-invalidated=01', false);
  assert.equal(rejected.type, 'redirect');
  assert.match(rejected.location, /^\/auth\/login\?/);
  assert.equal((await respond('/api/profile', false)).status, 401);
  checks++;

  account.blocked = true;
  assert.equal((await respond('/api/profile')).status, 403, 'a cached front-end snapshot cannot bypass account revocation');
  assert.equal((await respond('/auth/session')).status, 403);
  checks++;
  console.log(`Navigation route verification: ${checks} checks passed; stable root dependencies, skipped permission payloads, session bootstrap and server denial verified.`);
} finally { globalThis.fetch = originalFetch; }
