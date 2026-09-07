import { readFile } from 'node:fs/promises';
import { management } from './lib/auth0-management.mjs';

const { vars } = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const team = vars.ACCESS_TEAM_DOMAIN;
if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(team)) throw new Error('Invalid Access team domain');
const clientId = vars.AUTH0_CLIENT_ID;
const fields = 'client_id,name,callbacks,allowed_logout_urls';
const path = `clients/${encodeURIComponent(clientId)}`;
const app = management('get', `${path}?fields=${fields}&include_fields=true`);
if (app.client_id !== clientId || app.name !== 'eastmoney') throw new Error('Unexpected Auth0 application');

function replaceTeam(values, pathname) {
  if (!Array.isArray(values)) throw new Error('Missing Auth0 URL allowlist');
  let found = false;
  const result = values.map((value) => {
    const url = new URL(value);
    if (url.protocol === 'https:' && /^[a-z0-9-]+\.cloudflareaccess\.com$/.test(url.hostname) && url.pathname === pathname) {
      found = true;
      url.hostname = team;
      return url.href;
    }
    return value;
  });
  if (!found) throw new Error(`No existing Access ${pathname} entry; review before changing the application`);
  return [...new Set(result)];
}
const changes = {
  callbacks: replaceTeam(app.callbacks, '/cdn-cgi/access/callback'),
  allowed_logout_urls: replaceTeam(app.allowed_logout_urls, '/cdn-cgi/access/logout'),
};
console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply' : 'plan', clientId, teamDomain: team, ...changes }));
if (!process.argv.includes('--apply')) process.exit(0);
management('patch', path, changes);
const updated = management('get', `${path}?fields=${fields}&include_fields=true`);
for (const [key, urls] of Object.entries(changes)) {
  if (JSON.stringify(updated[key]) !== JSON.stringify(urls)) throw new Error(`Auth0 ${key} verification failed`);
}
console.log(JSON.stringify({ updated: true, callbackVerified: true, logoutVerified: true }));
