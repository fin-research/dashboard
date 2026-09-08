import test from 'node:test';
import assert from 'node:assert/strict';
import { withLoginRedirect, LoginRequiredError, requireClientLogin, redirectToLogin } from '../src/lib/auth-client.ts';
import { loginUrl, pageRequiresLogin } from '../src/lib/auth-navigation.ts';
import { dashboardAccessFailure, dashboardRequiresLogin } from '../src/lib/server/dashboard-access.ts';
import { AccessError } from '../src/lib/server/access.ts';

const current = 'https://eastmoney.hasbai.xyz/fund-report?upload=1#history';
test('all same-origin 401 responses redirect before parsing or exposing generic failures', async () => {
  for (const input of ['/api/fund-report', new URL('https://eastmoney.hasbai.xyz/api/credit'), new Request('https://eastmoney.hasbai.xyz/data/news')]) {
    const redirects = [];
    const fetcher = withLoginRedirect(async () => new Response('not-json', { status: 401 }), () => current, (path) => redirects.push(path));
    await assert.rejects(fetcher(input), LoginRequiredError);
    assert.deepEqual(redirects, ['/fund-report?upload=1#history']);
  }
});

test('success, validation, permission and upstream failures keep their original response and request', async () => {
  for (const status of [200, 201, 400, 403, 409, 500, 503]) {
    const response = Response.json({ status }, { status });
    const request = new Request('https://eastmoney.hasbai.xyz/api/fund-report', { method: 'POST', body: 'file' });
    const fetcher = withLoginRedirect(async (input) => { assert.equal(input, request); return response; }, () => current, () => assert.fail('must not redirect'));
    assert.equal(await fetcher(request), response);
  }
});

test('unrelated external 401s do not log users out of dashboard', async () => {
  const response = new Response(null, { status: 401 });
  const fetcher = withLoginRedirect(async () => response, () => current, () => assert.fail('external identity is unrelated'));
  assert.equal(await fetcher('https://external.test/api'), response);
});

test('private page guard covers child routes and agrees with the server', () => {
  for (const path of ['/fund-report', '/market-briefing/unknown', '/profile-other', '/trading-research-other', '/profile', '/profile/__data.json', '/trading-research', '/trading-research/credit', '/credit-workbench', '/credit-workbench/calendar', '/credit-workbench/weekly', '/credit-workbench/assistant', '/credit%2dworkbench/__data.json', '/credit-assistant', '/trading%2dresearch/credit']) {
    assert.equal(pageRequiresLogin(path), true, path);
    assert.equal(dashboardRequiresLogin(new Request(`https://eastmoney.hasbai.xyz${path}`)), true, path);
  }
  for (const path of ['/', '/market-briefing', '/market-briefing/text', '/market-briefing/__data.json', '/market-briefing/text/', '/auth/session', '/auth/verify-email']) assert.equal(pageRequiresLogin(path), false, path);
  assert.equal(dashboardRequiresLogin(new Request('https://eastmoney.hasbai.xyz/api/profile')), true);
});

test('page 401 redirects to login while API 401 keeps its status and login-required detail', async () => {
  const page = dashboardAccessFailure(new Request('https://eastmoney.hasbai.xyz/profile?tab=security', { headers: { Accept: 'text/html' } }), new AccessError(401, '请先登录'));
  assert.equal(page.status, 303);
  assert.equal(page.headers.get('location'), loginUrl('/profile?tab=security'));
  const api = dashboardAccessFailure(new Request('https://eastmoney.hasbai.xyz/api/fund-report', { method: 'POST' }), new AccessError(401, '请先登录'));
  assert.equal(api.status, 401);
  assert.equal((await api.json()).detail, '请先登录');
  const denied = dashboardAccessFailure(new Request('https://eastmoney.hasbai.xyz/profile', { headers: { Accept: 'text/html' } }), new AccessError(403, '无权限'));
  assert.equal(denied.status, 403);
});

test('login destinations preserve local queries and reject encoded loops or external URLs', () => {
  for (const path of ['//evil.test', '/%2F%2Fevil.test', '/%61uth/login', '/a/../auth/login', '/%63dn-cgi/access/logout', '/a%5cb', '/%ZZ']) assert.equal(loginUrl(path), '/auth/login?returnTo=%2F');
  assert.equal(loginUrl('/profile?tab=email'), '/auth/login?returnTo=%2Fprofile%3Ftab%3Demail');
});

test('preflight login checks fail closed and concurrent redirects cause only one navigation', async (t) => {
  const redirects = [];
  t.mock.method(globalThis, 'fetch', async () => Response.json({ user: { email: 'me@18.cn' } }));
  assert.equal(await requireClientLogin('/profile'), true);
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 503 }));
  await assert.rejects(requireClientLogin('/profile'), /登录状态暂时无法读取/);
  const original = globalThis.window;
  globalThis.window = { location: { pathname: '/', search: '', hash: '', assign: (url) => redirects.push(url) } };
  try {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ user: null, enabled: true }));
    assert.equal(await requireClientLogin('/fund-report?upload=1'), false);
    redirectToLogin('/profile');
    assert.deepEqual(redirects, [loginUrl('/fund-report?upload=1')]);
  } finally {
    if (original === undefined) delete globalThis.window;
    else globalThis.window = original;
  }
});
