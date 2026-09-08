import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { AUTH0_DOMAIN, management } from './lib/auth0-management.mjs';

const apply = process.argv.includes('--apply');
const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
if (config.name !== 'eastmoney-dashboard') throw new Error('Unexpected target Worker');
const id = config.vars.FINANCING_AUTH0_MANAGEMENT_CLIENT_ID;
const client = management('get', `clients/${encodeURIComponent(id)}`);
if (client.client_id !== id || client.app_type !== 'non_interactive' || !client.client_secret) throw new Error('Existing financing management application is unavailable');
const scopes = ['read:users', 'create:users', 'update:users', 'read:roles', 'update:roles'];
const grants = management('get', `client-grants?client_id=${encodeURIComponent(id)}`);
if (!grants.some(grant => grant.audience === `https://${AUTH0_DOMAIN}/api/v2/` && scopes.every(scope => grant.scope.includes(scope)))) {
  throw new Error('Existing financing management application lacks required scopes');
}
console.log(JSON.stringify({ mode: apply ? 'apply' : 'plan', worker: config.name, clientId: id, existingGrantVerified: true }));
if (apply) {
  // Transfer the existing secret via stdin. Do not rotate, print or persist it.
  const uploaded = spawnSync('pnpm', ['exec', 'wrangler', 'secret', 'put', 'FINANCING_AUTH0_MANAGEMENT_CLIENT_SECRET', '--name', config.name], {
    cwd: new URL('..', import.meta.url), input: client.client_secret, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
  });
  if (uploaded.status !== 0) throw new Error('Financing management Secret upload failed');
  console.log(JSON.stringify({ secretUploaded: true, clientRotated: false }));
}
