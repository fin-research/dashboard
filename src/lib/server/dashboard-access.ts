import { AccessError, accessFailure, accessToken, requireHuman, verifyAccess } from './access.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const PRIVATE_PATHS = ['/trading-research', '/credit-assistant', '/api/credit-assistant', '/api/credit', '/api/economic-indicators'];

export function dashboardRequiresLogin(request: Request): boolean {
  let path: string;
  try { path = decodeURIComponent(new URL(request.url).pathname); }
  catch { throw new AccessError(403, '请求路径无效'); }
  if (path === '/auth/logout') return false;
  return !SAFE_METHODS.has(request.method)
    || PRIVATE_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
    || path === '/auth/login';
}

export function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n]/.test(value)) return '/';
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith('//') || /[\\\r\n]/.test(decoded)) return '/';
  } catch { return '/'; }
  const target = new URL(value, 'https://eastmoney.hasbai.xyz');
  if (target.origin !== 'https://eastmoney.hasbai.xyz' || target.pathname.startsWith('/auth/') || target.pathname.startsWith('/cdn-cgi/')) return '/';
  return target.pathname + target.search + target.hash;
}

export async function dashboardIdentity(request: Request, env: Env) {
  const required = dashboardRequiresLogin(request);
  const sessionRequest = new URL(request.url).pathname === '/auth/session';
  // Public reports and assets do not depend on the identity provider or vary by user.
  if (!required && !sessionRequest) return null;
  const mode = String(env.ACCESS_MODE);
  if (mode === 'legacy') return null;
  if (mode !== 'enforce') throw new AccessError(503, '身份服务尚未配置完成');
  if (!required && !accessToken(request)) return null;
  try {
    return requireHuman(await verifyAccess(request, env));
  } catch (error) {
    if (!required) return null;
    throw error;
  }
}

export function dashboardAccessFailure(request: Request, error: unknown): Response {
  const path = new URL(request.url);
  if (error instanceof AccessError && error.status === 401 && request.method === 'GET'
    && request.headers.get('Accept')?.includes('text/html') && path.pathname !== '/auth/login') {
    return new Response(null, { status: 303, headers: {
      Location: `/auth/login?returnTo=${encodeURIComponent(path.pathname + path.search)}`,
      'Cache-Control': 'no-store, private',
    } });
  }
  return accessFailure(error);
}

export function requireSameOrigin(request: Request): void {
  if (!SAFE_METHODS.has(request.method) && request.headers.get('Origin') !== new URL(request.url).origin) {
    throw new AccessError(403, '仅允许从本站提交操作');
  }
}
