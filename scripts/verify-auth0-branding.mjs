import assert from 'node:assert/strict';
import { AUTH0_DOMAIN, management } from './lib/auth0-management.mjs';

// Read-only HTTP smoke: no credentials, signup submissions, cookies or transaction
// URLs are written to disk/output. This does not replace browser visual testing.
const domain = process.argv.find((arg) => arg.startsWith('--login-domain='))?.split('=')[1] ?? AUTH0_DOMAIN;
if (!/^(?:hasbai\.eu\.auth0\.com|[a-z0-9-]+\.hasbai\.xyz)$/.test(domain)) throw new Error('Unexpected login domain');
for (const screen of ['login', 'signup']) {
  let url = new URL(`https://${domain}/authorize`);
  url.search = new URLSearchParams({ client_id: '16vMxoYpr5AdPRiW1PkwIiHuRWszii6m',
    redirect_uri: 'https://hasbai.cloudflareaccess.com/cdn-cgi/access/callback', response_type: 'code', scope: 'openid profile email',
    ...(screen === 'signup' ? { screen_hint: 'signup' } : {}), state: crypto.randomUUID() }).toString();
  const cookies = new Map();
  let html = '';
  for (let hop = 0; hop < 8; hop++) {
    assert.equal(url.origin, `https://${domain}`);
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000),
      headers: { 'Accept-Language': 'en-US,en;q=0.9', Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') } });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0]; const split = pair.indexOf('=');
      cookies.set(pair.slice(0, split), pair.slice(split + 1));
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location'); assert.ok(location);
      url = new URL(location, url); await response.body?.cancel(); continue;
    }
    assert.equal(response.status, 200);
    html = await response.text(); break;
  }
  assert.ok(/lang="zh-CN"/i.test(html), "Expected Chinese document language");
  assert.ok(html.includes(screen === 'login' ? '工作台' : '注册账号'));
  const heading = html.match(/<header\b[^>]*>([\s\S]*?)<\/header>/i)?.[1];
  assert.ok(heading, 'Missing login / signup header');
  const headingText = heading.replace(/<[^>]*>/g, '').replace(/\s+/g, '').trim();
  assert.equal(headingText, screen === 'login' ? '工作台' : '注册账号', 'Default description must remain hidden');
  assert.ok(/#2f6fd6/i.test(html), "Expected brand blue");
  assert.ok(/#f6f8fb/i.test(html), "Expected project background");
  console.log(JSON.stringify({ screen, origin: url.origin, path: url.pathname, status: 200,
    locale: 'zh-CN', brandColor: true, background: true }));
}
if (domain !== AUTH0_DOMAIN) {
  const form = management('get', 'forms').find((item) => item.name === 'eastmoney signup profile');
  assert.ok(form, 'Missing signup profile Form');
  const current = management('get', `forms/${form.id}`);
  const fields = current.nodes.flatMap((node) => node.config?.components ?? []).filter((item) => item.category === 'FIELD');
  assert.deepEqual(fields.map((field) => [field.id, field.required, field.config.max_length]), [['name', true, 50], ['department', true, 100]]);
  assert.equal(current.languages.primary, 'zh-CN');
  assert.equal(current.ending.resume_flow, true);
  const binding = management('get', 'actions/triggers/post-login/bindings').bindings.find((item) => item.action.name === 'eastmoney signup profile');
  assert.ok(binding, 'Missing profile Action binding');
  console.log(JSON.stringify({ profileFormConfigured: true, formId: form.id, fields: ['name', 'department'], required: true }));
}
