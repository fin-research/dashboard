import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { management } from './lib/auth0-management.mjs';

const apply = process.argv.includes('--apply');
const { vars } = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const domain = vars.AUTH0_LOGIN_DOMAIN;
if (domain !== 'auth.hasbai.xyz') throw new Error('Unexpected approved login domain');
const configured = management('get', 'custom-domains').find((item) => item.domain === domain);
if (configured?.status !== 'ready') throw new Error('Verify the Auth0 custom domain first');
const discovery = await fetch(`https://${domain}/.well-known/openid-configuration`, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
assert.equal(discovery.status, 200);
const oidc = await discovery.json();
assert.equal(oidc.issuer, `https://${domain}/`);
for (const [key, path] of [['authorization_endpoint', '/authorize'], ['token_endpoint', '/oauth/token'], ['jwks_uri', '/.well-known/jwks.json']]) assert.equal(oidc[key], `https://${domain}${path}`);
const token = process.env.CLOUDFLARE_ACCESS_API_TOKEN;
if (!token) throw new Error('Set CLOUDFLARE_ACCESS_API_TOKEN');
const base = `https://api.cloudflare.com/client/v4/accounts/${vars.CLOUDFLARE_ACCOUNT_ID}/access`;
async function access(path, method = 'GET', body) {
  const response = await fetch(`${base}/${path}`, { method, redirect: 'manual', signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const payload = await response.json();
  if (!response.ok || !payload.success) throw new Error(`Access ${method} ${path} failed (${response.status})`);
  return payload.result;
}
const providers = await access('identity_providers');
const provider = providers.find((item) => item.name === 'eastmoney Auth0');
if (provider?.type !== 'oidc' || provider.config?.client_id !== vars.AUTH0_CLIENT_ID) throw new Error('Unexpected Access identity provider');
const app = management('get', `clients/${vars.AUTH0_CLIENT_ID}`);
if (typeof app.client_secret !== 'string' || !app.client_secret) throw new Error('Auth0 application credential is unavailable');
if (!app.callbacks?.includes(`https://${vars.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/callback`)
  || !app.allowed_logout_urls?.includes(`https://${vars.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/logout`)) throw new Error('Check Auth0 callback / logout allowlists');
const config = { ...provider.config, auth_url: oidc.authorization_endpoint, token_url: oidc.token_endpoint, certs_url: oidc.jwks_uri };
delete config.redirect_url;
console.log(JSON.stringify({ mode: apply ? 'apply' : 'plan', domain, providerId: provider.id,
  auth_url: config.auth_url, token_url: config.token_url, certs_url: config.certs_url, callback: `https://${vars.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/callback` }));
if (!apply) process.exit(0);
const backupDirectory = await mkdtemp(join(tmpdir(), 'eastmoney-auth0-domain-'));
await writeFile(join(backupDirectory, 'before.json'), JSON.stringify({ ...provider, config: { ...provider.config, client_secret: undefined } }, null, 2), { mode: 0o600 });
// Cloudflare GET omits the client secret. Read it from the existing Auth0 app;
// keep it in memory and preserve all existing scopes, claims and PKCE settings.
await access(`identity_providers/${provider.id}`, 'PUT', { name: provider.name, type: provider.type, config: { ...config, client_secret: app.client_secret } });
const updated = await access(`identity_providers/${provider.id}`);
for (const key of ['auth_url', 'token_url', 'certs_url', 'scopes', 'claims', 'pkce_enabled', 'client_id']) assert.deepEqual(updated.config[key], config[key]);
console.log(JSON.stringify({ verified: true, domain, backupDirectory }));
