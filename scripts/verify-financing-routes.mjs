// Exercise the production SvelteKit build with signed fixture identities,
// local PostgreSQL (PGlite), and mocked Auth0/R2. Never contact production data.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { Client } from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { PERMISSION_CODES } from '../src/lib/financing/permissions.js';
import { financingTimestamp } from '../src/lib/financing/time.js';
import { Server } from '../.svelte-kit/output/server/index.js';
import { manifest } from '../.svelte-kit/output/server/manifest.js';

const { vars } = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const roleIds = JSON.parse(vars.AUTH0_ROLE_IDS);
const db = new PGlite({ parsers: { 1082: value => value, 1114: financingTimestamp, 1184: financingTimestamp } });
await db.exec(`CREATE ROLE authenticated; CREATE ROLE anonymous;
  CREATE TABLE public.edb (indicator_code text NOT NULL, observation_date date NOT NULL, value numeric, PRIMARY KEY(indicator_code,observation_date));
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.user_id() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.sub', true) $$;
  CREATE SCHEMA neon_auth;
  CREATE TABLE neon_auth."user" (id uuid PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
    "emailVerified" boolean NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, role text, banned boolean);
  CREATE TABLE neon_auth.session (id uuid PRIMARY KEY,"userId" uuid NOT NULL REFERENCES neon_auth."user"(id),"createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
for (const name of (await readdir(new URL('../financing-migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort()) {
  await db.exec(await readFile(new URL(`../financing-migrations/${name}`, import.meta.url), 'utf8'));
}
const account = { user_id: 'auth0|route-admin', email: 'route-admin@18.cn', name: '合并回归人员', email_verified: true, identities: [{ connection: 'eastmoney-email' }] };
await db.query(`INSERT INTO financing.people (id,name,email,role,active,auth0_user_id,auth0_account_active) VALUES ($1,$2,$3,'admin',TRUE,$4,TRUE)`, ['person-route-admin', account.name, account.email, account.user_id]);
let opened = 0, closed = 0, queries = 0, active = 0, peak = 0;
const databaseSubjects = [];
const originals = { connect: Client.prototype.connect, query: Client.prototype.query, end: Client.prototype.end, fetch: globalThis.fetch };
Client.prototype.connect = async function () { opened++; active++; peak = Math.max(peak, active); };
Client.prototype.end = async function () { closed++; active--; };
Client.prototype.query = async function (sql, params = []) {
  queries++;
  if (sql.includes("set_config('request.financing.user_id'")) databaseSubjects.push(params[0]);
  const result = await db.query(sql, params);
  return { ...result, rowCount: result.affectedRows ?? result.rows.length };
};
const { privateKey, publicKey } = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(publicKey), kid: 'financing-route-key', alg: 'RS256', use: 'sig' };
const origin = 'https://eastmoney.hasbai.xyz';
async function tokenFor(subject, email) {
  return new SignJWT({ type: 'app', email, custom: { eastmoney_user_id: subject } })
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).setSubject('access-' + subject)
    .setIssuer(`https://${vars.ACCESS_TEAM_DOMAIN}`).setAudience(vars.ACCESS_AUD)
    .setIssuedAt().setExpirationTime('5m').sign(privateKey);
}
const adminToken = await tokenFor(account.user_id, account.email);
const unlinkedToken = await tokenFor('auth0|unlinked', 'unlinked@18.cn');
let currentPermissions = [...PERMISSION_CODES];
let auth0Requests = 0;
const permissionObjects = () => currentPermissions.map(permission_name => ({ permission_name, resource_server_identifier: 'https://eastmoney.hasbai.xyz/financing' }));
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.href === `https://${vars.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
  assert.equal(url.origin, `https://${vars.AUTH0_DOMAIN}`, 'Unexpected external network request');
  auth0Requests++;
  if (url.pathname === '/oauth/token') {
    const credentials = input instanceof Request ? await input.clone().json() : JSON.parse(init.body);
    assert.equal(credentials.client_id, vars.AUTH0_MANAGEMENT_CLIENT_ID);
    assert.equal(credentials.client_secret, 'fixture-profile-secret');
    return Response.json({ access_token: 'fixture-management-token', expires_in: 60 });
  }
  if (/\/permissions$/.test(url.pathname)) return Response.json(permissionObjects());
  if (/\/roles$/.test(url.pathname)) return Response.json([{ id: roleIds.admin }]);
  if (/\/roles\/[^/]+\/users$/.test(url.pathname)) return Response.json(url.pathname.includes(roleIds.admin) ? [account] : []);
  if (url.pathname === '/api/v2/users') return Response.json([account]);
  assert.equal(url.pathname, '/api/v2/users/auth0%7Croute-admin');
  assert.equal(init.method ?? 'GET', 'GET', 'Route read unexpectedly changed an Auth0 account');
  return Response.json(account);
};
const env = { ...vars, HYPERDRIVE: { connectionString: 'postgres://fixture:fixture@localhost/fixture' },
  AUTH0_MANAGEMENT_CLIENT_SECRET: 'fixture-profile-secret',
  LIABILITY_REPORT_SNAPSHOTS: { async get() { return null; } },
  EASTMONEY: { async list() { return { objects: [], truncated: false }; } },
};
const server = new Server(manifest);
await server.init({ env });
async function respond(path, { token = adminToken, method = 'GET', headers = {}, body } = {}) {
  const before = opened;
  const response = await server.respond(new Request(origin + path, { method, headers: {
    Accept: 'text/html', Origin: origin, ...(token ? { Cookie: `CF_Authorization=${token}` } : {}), ...headers,
  }, body }), { getClientAddress: () => '127.0.0.1', platform: { env, context: { waitUntil() {} } } });
  assert.equal(active, 0, `${path}: database client was not closed`);
  assert.ok(opened - before <= 1, `${path}: more than one database connection`);
  return response;
}
let checks = 0;
try {
  for (const path of ['/financing', '/financing/projects', '/financing/sop', '/financing/liability-report', '/management/people']) {
    const response = await respond(path, { token: null });
    assert.equal(response.status, 303, path);
    assert.match(response.headers.get('location'), /^\/auth\/login\?/); checks++;
  }
  for (const path of ['/', '/profile', '/management']) {
    const before = queries;
    assert.equal((await respond(path, { token: unlinkedToken })).status, 200, path);
    assert.equal(queries, before, `${path}: unexpected financing query`); checks++;
  }
  const session = await respond('/auth/session', { headers: { Accept: 'application/json' } });
  assert.deepEqual((await session.json()).user, { id: 'access-' + account.user_id, email: account.email, auth0Id: account.user_id }); checks++;
  assert.equal((await respond('/financing', { token: unlinkedToken })).status, 403); checks++;
  await db.query('UPDATE financing.people SET avatar_data_url = $1 WHERE id = $2', ['data:image/png;base64,aGVsbG8=', 'person-route-admin']);
  const avatar = await respond('/financing/avatar?v=fixture');
  assert.equal(avatar.status, 200);
  assert.match(avatar.headers.get('cache-control'), /private, max-age=31536000, immutable/);
  assert.match(avatar.headers.get('vary'), /Cookie/); checks++;
  for (const [path, target] of [['/financing/people', '/management/people'], ['/financing/settings', '/management/financing-profile']]) {
    for (const method of ['GET', 'POST']) {
      const response = await respond(path + '?/updateProfile', { method });
      assert.equal(response.status, 307);
      assert.equal(response.headers.get('location'), target + '?/updateProfile'); checks++;
    }
  }
  for (const path of ['/financing', '/financing/projects', '/financing/sop', '/financing/data', '/financing/liability-report', '/financing/sop/reminders', '/management/people', '/management/financing-profile']) {
    const response = await respond(path);
    const body = await response.text();
    assert.equal(response.status, 200, `${path}: ${body.slice(0, 300)}`);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.equal((body.match(/class="global-message-region\b/g) ?? []).length, 1, path);
    assert.equal((body.match(/id="tr-workbench-main"/g) ?? []).length, 1, path);
    assert.doesNotMatch(body, /fixture-financing-secret|fixture-management-token|postgres:\/\//);
    checks++;
  }
  currentPermissions = [];
  for (const path of ['/financing/projects?/createProject', '/management/people?/saveRolePermissions', '/financing/data/import']) {
    const response = await respond(path, { method: 'POST', headers: { Accept: 'application/json' } });
    assert.equal(response.status, 403, path); checks++;
  }
  currentPermissions = [...PERMISSION_CODES];
  const dataRead = await respond('/financing/data/api/financial_monthly_data', { headers: { Accept: 'application/json' } });
  assert.equal(dataRead.status, 200, await dataRead.clone().text());
  assert.deepEqual(databaseSubjects, [account.user_id]);
  assert.notEqual((await db.query('SELECT current_user AS role')).rows[0].role, 'authenticated');
  assert.equal((await db.query("SELECT nullif(current_setting('request.financing.user_id',true), '') AS subject")).rows[0].subject, null); checks++;
  const sop = (await db.query('SELECT id FROM financing.sop_templates WHERE is_active ORDER BY id LIMIT 1')).rows[0];
  assert.ok(sop);
  const creation = await respond('/financing/projects?/createProject', {
    method: 'POST', headers: { Accept: 'application/json', 'X-SvelteKit-Action': 'true' },
    body: new URLSearchParams({ name: '路由回归项目', sopTemplateId: sop.id, amountYi: '1.5', plannedBookbuildingDate: '2026-10-09' }),
  });
  assert.equal(creation.status, 200, await creation.clone().text());
  assert.equal((await creation.json()).type, 'success');
  const project = (await db.query("SELECT id, planned_issue_date FROM financing.projects WHERE name = '路由回归项目'")).rows[0];
  assert.equal(project?.planned_issue_date, '2026-10-09');
  assert.equal((await respond(`/financing/projects/${project.id}`)).status, 200); checks += 2;
  const task = (await db.query('SELECT id FROM financing.project_tasks WHERE project_id=$1 ORDER BY id LIMIT 1', [project.id])).rows[0];
  assert.ok(task);
  await db.query("INSERT INTO financing.people(id,name,role,active) VALUES ('other-person','其他经办','handler',TRUE)");
  await db.query('UPDATE financing.project_tasks SET assignee_id=$1 WHERE id=$2', ['other-person', task.id]);
  currentPermissions = ['own_task_update'];
  const otherTask = await respond(`/financing/projects/${project.id}?/updateOwnTaskStatus`, {
    method: 'POST', headers: { Accept: 'application/json', 'X-SvelteKit-Action': 'true' },
    body: new URLSearchParams({ taskId: task.id, status: 'in_progress' }),
  });
  assert.equal(otherTask.status, 200);
  const ownTaskResult = await otherTask.json();
  assert.equal(ownTaskResult.type, 'failure');
  assert.equal(ownTaskResult.status, 403);
  assert.notEqual((await db.query('SELECT status FROM financing.project_tasks WHERE id=$1', [task.id])).rows[0].status, 'in_progress'); checks++;
  currentPermissions = [...PERMISSION_CODES];
  const denied = await respond('/management/people?/createPerson', { method: 'POST', headers: { Origin: 'https://other.test' } });
  assert.equal(denied.status, 403); checks++;
  assert.equal(opened, closed);
  assert.ok(peak <= 1);
  console.log(JSON.stringify({ checks, opened, closed, peak, queries, auth0Requests, database: 'local PGlite', externalServices: 'mocked' }));
} finally {
  Client.prototype.connect = originals.connect; Client.prototype.query = originals.query; Client.prototype.end = originals.end;
  globalThis.fetch = originals.fetch;
  await db.close();
}
