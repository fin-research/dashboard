import { AccessError, accessFailure, accessToken, requireHuman, verifyAccess } from './access.ts';
import { apiRequiresLogin, pageRequiresLogin, safeReturnTo } from '../auth-navigation.ts';
import type { SiteIdentity } from '../identity';
export { safeReturnTo } from '../auth-navigation.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function dashboardRequiresLogin(request: Request): boolean {
  let path: string;
  try { path = decodeURIComponent(new URL(request.url).pathname); }
  catch { throw new AccessError(403, '请求路径无效'); }
  if (path === '/auth/logout') return false;
  return !SAFE_METHODS.has(request.method)
    || pageRequiresLogin(path) || apiRequiresLogin(path)
    || path === '/auth/login';
}

export async function dashboardIdentity(request: Request, env: Env): Promise<SiteIdentity | null> {
  const required = dashboardRequiresLogin(request);
  const sessionRequest = new URL(request.url).pathname === '/auth/session';
  // Public reports and assets do not depend on the identity provider or vary by user.
  if (!required && !sessionRequest) return null;
  const mode = String(env.ACCESS_MODE);
  if (mode === 'legacy') return null;
  if (mode !== 'enforce') throw new AccessError(503, '身份服务尚未配置完成');
  if (!required && !accessToken(request)) return null;
  try {
    const payload = await verifyAccess(request, env);
    const user = requireHuman(payload);
    const custom = payload.custom ?? payload.oidc_fields;
    const fields = custom && typeof custom === 'object' ? custom as Record<string, unknown> : {};
    const subject = payload.eastmoney_user_id ?? fields.eastmoney_user_id;
    return { ...user, auth0Id: typeof subject === 'string' && /^auth0\|[^\s]{1,249}$/.test(subject) ? subject : null,
      issuedAt: Number(payload.iat), expiresAt: Number(payload.exp) };
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
      Location: `/auth/login?returnTo=${encodeURIComponent(safeReturnTo(path.pathname + path.search))}`,
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
