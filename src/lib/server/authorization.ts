import { AccessError } from './access.ts';
import { createDirectory } from './auth0-directory.ts';
import { dashboardIdentity, requireSameOrigin } from './dashboard-access.ts';
import { PERMISSION_CODES, hasPermission, type AuthorizationMode } from '../permissions.ts';
import { requestPolicy } from './permission-policy.ts';
import { rolePermissions } from './permission-repository.ts';
import { withPostgres } from './postgres.ts';

export function authorizationMode(value: unknown): AuthorizationMode {
  if (value !== 'beta-open' && value !== 'enforce') throw new AccessError(503, '权限模式尚未配置完成');
  return value;
}

/** The only user authorization entrypoint, including named Worker entrypoints. */
export async function authorizeRequest(request: Request, env: Env, routeId: string | null, fetcher: typeof fetch = fetch) {
  const policy = requestPolicy(request, routeId);
  requireSameOrigin(request);
  const user = policy.public
    ? (routeId === '/auth/session' ? await dashboardIdentity(request, env) : null)
    : await dashboardIdentity(request, env, true);
  // A session bootstrap resolves the same role/permission snapshot as a business
  // request once. Other public resources stay independent of identity services.
  if ((policy.public && (routeId !== '/auth/session' || !user)) || policy.login) return { user, permissions: [] as string[], directory: undefined };
  if (!user) throw new AccessError(401, '请先登录');
  const mode = authorizationMode(env.AUTHORIZATION_MODE);
  const directory = createDirectory(env, fetcher);
  const profile = await directory.current(user);
  const permissions = mode === 'beta-open' ? [...PERMISSION_CODES]
    : await withPostgres(env.AUTHORIZATION_DB?.connectionString, 'eastmoney-authorization', (db) => rolePermissions(db, profile.roles.map((role) => role.id)));
  user.authorization = { name: profile.name, department: profile.department, roles: profile.roles, permissions, mode, picture: profile.picture };
  if (policy.permission && !hasPermission(permissions, policy.permission)) throw new AccessError(403, '当前角色无权执行该操作');
  return { user, permissions, directory };
}
