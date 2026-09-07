import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { AUTH0_DOMAIN, management } from './lib/auth0-management.mjs';

const apply = process.argv.includes('--apply');
const appName = 'eastmoney dashboard profile';
const scopes = ['read:users', 'update:users', 'read:roles'];
const audience = `https://${AUTH0_DOMAIN}/api/v2/`;
const configUrl = new URL('../wrangler.jsonc', import.meta.url);
const configText = await readFile(configUrl, 'utf8');
const config = JSON.parse(configText);
if (config.name !== 'eastmoney-dashboard') throw new Error('Wrong target Worker');
const matches = management('get', 'clients?fields=client_id,name,app_type&include_fields=true&per_page=100').filter((app) => app.name === appName);
if (matches.length > 1) throw new Error('Multiple matching Auth0 management applications');
console.log(JSON.stringify({ mode: apply ? 'apply' : 'plan', appName, worker: config.name, scopes, exists: matches.length === 1 }));
if (!apply) process.exit(0);

const app = matches[0]
  ? management('get', `clients/${matches[0].client_id}`)
  : management('post', 'clients', { name: appName, app_type: 'non_interactive', grant_types: ['client_credentials'], token_endpoint_auth_method: 'client_secret_post' });
if (app.app_type !== 'non_interactive' || !app.client_id || !app.client_secret) throw new Error('Auth0 did not return a valid M2M credential');
const grants = management('get', `client-grants?client_id=${encodeURIComponent(app.client_id)}`).filter((grant) => grant.audience === audience);
if (grants.length > 1) throw new Error('Multiple matching management grants');
if (!grants.length) management('post', 'client-grants', { client_id: app.client_id, audience, scope: scopes });
else if (JSON.stringify([...grants[0].scope].sort()) !== JSON.stringify([...scopes].sort())) throw new Error('Existing grant differs from the scoped profile permissions');

// Validate the generated credential without displaying the secret or resulting token.
const response = await fetch(`https://${AUTH0_DOMAIN}/oauth/token`, {
  method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ grant_type: 'client_credentials', client_id: app.client_id, client_secret: app.client_secret, audience }),
});
if (!response.ok) throw new Error(`Management credential verification failed (${response.status})`);
const token = await response.json();
if (!token.access_token || scopes.some((scope) => !String(token.scope).split(' ').includes(scope))) throw new Error('Management credential is missing required scopes');

const upload = spawnSync('pnpm', ['exec', 'wrangler', 'secret', 'put', 'AUTH0_MANAGEMENT_CLIENT_SECRET', '--name', config.name], {
  cwd: new URL('..', import.meta.url), input: app.client_secret, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
});
if (upload.status !== 0) throw new Error('Cloudflare Secret upload failed; the generated Auth0 app is retained for retry');
config.vars.AUTH0_MANAGEMENT_CLIENT_ID = app.client_id;
await writeFile(configUrl, configText.replace(/("AUTH0_MANAGEMENT_CLIENT_ID":\s*)"[^"]*"/, (_, prefix) => prefix + JSON.stringify(app.client_id)));
console.log(JSON.stringify({ configured: true, managementClientId: app.client_id, credentialVerified: true, secretUploaded: true, worker: config.name }));
