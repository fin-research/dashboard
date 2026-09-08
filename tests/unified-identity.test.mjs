import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { financingPersonView, publicIdentity } from '../src/lib/identity.ts';

test('one site identity supplies financing projections without changing its subject or exposing authorization metadata', () => {
  const identity = { id: 'access-id', auth0Id: 'auth0|signed-id', email: 'user@18.cn', issuedAt: 1, expiresAt: 100,
    financing: { personId: 'business-id', personName: '经办', role: 'handler', permissions: ['own_task_update'], hasAvatar: false, avatarVersion: '1' } };
  assert.deepEqual(publicIdentity(identity), { id: 'access-id', auth0Id: 'auth0|signed-id', email: 'user@18.cn' });
  const person = financingPersonView(identity);
  assert.equal(person.id, identity.auth0Id);
  assert.equal(person.personId, 'business-id');
  assert.equal(identity.id, 'access-id');
  assert.equal(financingPersonView({ ...identity, financing: undefined }), null);
  assert.equal(financingPersonView({ ...identity, auth0Id: null }), null);
});

test('financing consumes central authentication and all live management clients use one Secret', async () => {
  const [auth, hooks, provider, configText, declarations] = await Promise.all([
    readFile(new URL('../src/lib/server/financing/auth.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/server/financing/handle.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/server/financing/auth-provider.js', import.meta.url), 'utf8'),
    readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'),
    readFile(new URL('../src/app.d.ts', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(auth, /verifyAccess|requireHuman|getSessionUser|createNeonAuthClient/);
  assert.match(auth, /identity = event\.locals\.user/);
  assert.match(hooks, /event\.locals\.user\.financing = await authorizeFinancing/);
  assert.doesNotMatch(declarations, /financingUser/);
  const config = JSON.parse(configText);
  assert.deepEqual(config.secrets.required.filter(name => name.includes('AUTH0')), ['AUTH0_MANAGEMENT_CLIENT_SECRET']);
  assert.equal(Object.keys(config.vars).filter(name => name.endsWith('MANAGEMENT_CLIENT_ID')).length, 1);
  assert.match(provider, /clientSecret: config\.AUTH0_MANAGEMENT_CLIENT_SECRET/);
});
