import assert from 'node:assert/strict';
import { AUTH0_DOMAIN } from './lib/auth0-management.mjs';

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
  assert.ok(html.includes(screen === 'login' ? '登录资金管理平台' : '注册账号'));
  assert.ok(/#2f6fd6/i.test(html), "Expected brand blue");
  assert.ok(/#f6f8fb/i.test(html), "Expected project background");
  if (domain !== AUTH0_DOMAIN && screen === 'signup') {
    assert.ok(/name="ulp-name"/.test(html), "Missing name field"); assert.ok(/name="ulp-department"/.test(html), "Missing department field");
  }
  console.log(JSON.stringify({ screen, origin: url.origin, path: url.pathname, status: 200,
    locale: 'zh-CN', brandColor: true, background: true, customFields: screen === 'signup' && html.includes('name="ulp-name"') }));
}
