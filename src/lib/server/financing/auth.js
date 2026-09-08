// @ts-nocheck
import { env } from '$env/dynamic/private';
import { appCookiePath } from '../../financing/app-paths.js';
import { normalizeEmail } from '../../financing/email.js';
import { getDatabase } from './db.js';
import { cacheSessionUser, readCachedSessionUser } from './auth-cache.js';
import { createNeonAuthClient, NeonAuthApiError } from './neon-auth-client.js';
import { accessToken, AccessError, requireHuman, verifyAccess } from '../access.ts';
import { auth0Client, providerConfig, usesAuth0 } from './auth-provider.js';

export const SESSION_COOKIE = 'financing_session';
export const AUTH_ROLES = Object.freeze({
	admin: 'admin',
	handler: 'handler',
	reviewer: 'reviewer'
});

function client(event, token = null) {
	return createNeonAuthClient({
		baseUrl: env.NEON_AUTH_URL,
		origin: event.url.origin,
		token,
		fetchImpl: event.fetch
	});
}

function currentToken(event) {
	return event.cookies.get(SESSION_COOKIE) ?? null;
}

async function localIdentity(authUser) {
	if (!authUser?.id) return null;
	const person = await getDatabase().prepare(`
		SELECT id AS personId, name AS personName, email, role,
			avatar_data_url IS NOT NULL AS hasAvatar,
			to_char(updated_at, 'YYYYMMDDHH24MISSUS') AS avatarVersion
		FROM people
		WHERE neon_auth_user_id = ?::uuid AND active = TRUE
		LIMIT 1
	`).get(authUser.id);
	if (!person) return null;
	return {
		id: String(authUser.id),
		email: authUser.email ?? person.email ?? null,
		role: person.role,
		personId: person.personId,
		personName: person.personName,
		hasAvatar: Boolean(person.hasAvatar),
		avatarVersion: person.avatarVersion ?? '0'
	};
}

function setSessionCookie(event, token, maxAge = 7 * 24 * 60 * 60) {
	event.cookies.set(SESSION_COOKIE, token, {
		path: appCookiePath,
		httpOnly: true,
		sameSite: 'lax',
		secure: event.url.protocol === 'https:',
		maxAge
	});
}

function clearSessionCookie(event) {
	event.cookies.delete(SESSION_COOKIE, { path: appCookiePath });
}

export async function authenticate(event, email, password) {
  if (usesAuth0()) throw new NeonAuthApiError(403, '请使用统一登录入口', 'USE_UNIFIED_LOGIN');
	const result = await client(event).signIn(normalizeEmail(email), password);
	const user = await localIdentity(result.data?.user);
	if (!user || !result.token) {
		if (result.token) await client(event, result.token).signOut().catch(() => null);
		throw new NeonAuthApiError(403, '该账号未关联融资工作台人员或已停用', 'PERSON_ACCESS_DENIED');
	}
	setSessionCookie(event, result.token, result.maxAge);
	return user;
}

export async function getSessionUser(
	event,
	token = currentToken(event),
	{ requireDataApiJwt = false, useSessionCache = false } = {}
) {
  if (usesAuth0()) return getAccessSessionUser(event, { useSessionCache: useSessionCache && !requireDataApiJwt });
	if (!token) return null;
	const canUseCache = Boolean(useSessionCache && !requireDataApiJwt);
	if (canUseCache) {
		const cachedUser = await readCachedSessionUser(event, token);
		if (cachedUser) {
			event.locals.authCacheStatus = 'hit';
			return cachedUser;
		}
		event.locals.authCacheStatus = 'miss';
	} else {
		event.locals.authCacheStatus = 'bypass';
	}
	try {
		const result = await client(event, token).getSession({ disableCookieCache: requireDataApiJwt });
		event.locals.dataApiJwt = result.jwt ?? null;
		if (!result.data?.user) return null;
		if (result.token && result.token !== token) setSessionCookie(event, result.token, result.maxAge);
		const user = await localIdentity(result.data.user);
		if (user && canUseCache) await cacheSessionUser(event, result.token ?? token, user);
		return user;
	} catch (error) {
		if (error instanceof NeonAuthApiError && (error.status === 401 || error.status === 403)) return null;
		throw error;
	}
}

export function currentDataApiJwt(event) {
	return event.locals.dataApiJwt ?? null;
}

export async function deleteSession(event, token = currentToken(event)) {
  if (usesAuth0()) { clearSessionCookie(event); return; }
	try {
		if (token) await client(event, token).signOut();
	} catch (error) {
		if (!(error instanceof NeonAuthApiError) || (error.status !== 401 && error.status !== 403)) throw error;
	} finally {
		clearSessionCookie(event);
	}
}

async function authenticatedRequest(event, route, body) {
	const token = currentToken(event);
	if (!token) throw new NeonAuthApiError(401, '登录已失效', 'SESSION_EXPIRED');
	const result = await client(event, token).request(route, { method: 'POST', body });
	if (result.token && result.token !== token) setSessionCookie(event, result.token, result.maxAge);
	return result.data;
}

export function updateCurrentAuthProfile(event, profile) {
  if (usesAuth0()) return auth0Client(event).request(`users/${encodeURIComponent(event.locals.financingUser.id)}`, 'PATCH', profile);
	return authenticatedRequest(event, '/update-user', profile);
}

export function changeCurrentPassword(event, currentPassword, newPassword) {
  if (usesAuth0()) return requestAuth0PasswordReset(event);
	return authenticatedRequest(event, '/change-password', {
		currentPassword,
		newPassword,
		revokeOtherSessions: true
	});
}

export async function createManagedUser(event, fields) {
  if (usesAuth0()) {
    const manager = auth0Client(event);
    const email = normalizeEmail(fields.email);
    if (!/^[^@\s]+@18\.cn$/.test(email)) throw new NeonAuthApiError(400, '仅允许 18.cn 邮箱');
    const existing = await manager.request(`users-by-email?email=${encodeURIComponent(email)}`);
    if (!Array.isArray(existing) || existing.length > 1) throw new NeonAuthApiError(409, '邮箱对应多个账号，需在 Auth0 中处理');
    if (!existing.length && !fields.password) throw new NeonAuthApiError(400, '该邮箱尚未注册，请先注册或填写初始密码');
    const user = existing[0] ?? await manager.request('users', 'POST', {
      email, password: fields.password, name: fields.name, connection: 'eastmoney-email',
    });
    if (!user?.user_id || !user.identities?.some((identity) => identity.connection === 'eastmoney-email')) throw new NeonAuthApiError(409, '邮箱账号不属于本站邮箱连接');
    await manager.setRole(user.user_id, fields.role);
    return { id: user.user_id };
  }
	const data = await authenticatedRequest(event, '/admin/create-user', fields);
	return data?.user ?? null;
}

export function updateManagedUser(event, userId, data) {
  if (usesAuth0()) {
    if (data.email && !/^[^@\s]+@18\.cn$/i.test(data.email)) throw new NeonAuthApiError(400, '仅允许 18.cn 邮箱');
    return auth0Client(event).request(`users/${encodeURIComponent(userId)}`, 'PATCH', data.email ? { ...data, email_verified: false, verify_email: true } : data);
  }
	return authenticatedRequest(event, '/admin/update-user', { userId, data });
}

export function setManagedUserRole(event, userId, role) {
  if (usesAuth0()) return auth0Client(event).setRole(userId, role);
	return authenticatedRequest(event, '/admin/set-role', { userId, role });
}

export function setManagedUserPassword(event, userId, newPassword) {
  if (usesAuth0()) return auth0Client(event).request(`users/${encodeURIComponent(userId)}`, 'PATCH', { password: newPassword, connection: 'eastmoney-email' });
	return authenticatedRequest(event, '/admin/set-user-password', { userId, newPassword });
}

export function banManagedUser(event, userId) {
  if (usesAuth0()) return auth0Client(event).request(`users/${encodeURIComponent(userId)}`, 'PATCH', { app_metadata: { financing_enabled: false } });
	return authenticatedRequest(event, '/admin/ban-user', {
		userId,
		banReason: '融资工作台人员已停用'
	});
}

export function unbanManagedUser(event, userId) {
  if (usesAuth0()) return auth0Client(event).request(`users/${encodeURIComponent(userId)}`, 'PATCH', { app_metadata: { financing_enabled: true } });
	return authenticatedRequest(event, '/admin/unban-user', { userId });
}

export function removeManagedUser(event, userId) {
  if (usesAuth0()) return auth0Client(event).removeFinancingRoles(userId);
	return authenticatedRequest(event, '/admin/remove-user', { userId });
}

export function canWrite(user) {
	return user?.role === AUTH_ROLES.admin;
}

export { NeonAuthApiError } from './neon-auth-client.js';

async function getAccessSessionUser(event, { useSessionCache }) {
  if (currentToken(event)) clearSessionCookie(event);
  const token = accessToken(event.request);
  if (!token) return null;
  let payload;
  try { payload = await verifyAccess(event.request, providerConfig()); requireHuman(payload); }
  catch (error) {
    if (error instanceof AccessError && error.status === 401) return null;
    throw new NeonAuthApiError(error instanceof AccessError ? error.status : 503,
      error instanceof AccessError ? error.message : '统一身份服务暂时不可用',
      error instanceof AccessError && error.status === 403 ? 'PERSON_ACCESS_DENIED' : 'AUTH_UNAVAILABLE');
  }
  const custom = payload.custom ?? payload.oidc_fields ?? {};
  const auth0Id = payload.eastmoney_user_id ?? custom.eastmoney_user_id;
  if (typeof auth0Id !== 'string' || !auth0Id.startsWith('auth0|') || auth0Id.length > 255) {
    throw new NeonAuthApiError(503, 'Access 身份声明尚未配置完成');
  }
  if (useSessionCache) {
    const cached = await readCachedSessionUser(event, token);
    if (cached?.id === auth0Id) { event.locals.authCacheStatus = 'hit'; return cached; }
  }
  event.locals.authCacheStatus = useSessionCache ? 'miss' : 'bypass';
  const db = getDatabase();
  const person = await db.prepare(`SELECT id AS personId, name AS personName, email, role,
    avatar_data_url IS NOT NULL AS hasAvatar, to_char(updated_at, 'YYYYMMDDHH24MISSUS') AS avatarVersion
    FROM people WHERE auth0_user_id = ? AND active = TRUE LIMIT 1`).get(auth0Id);
  let authorization = null;
  try { authorization = person ? await auth0Client(event).authorization(auth0Id) : null; }
  catch (error) { if (!(error instanceof NeonAuthApiError) || error.status !== 404) throw error; }
  if (!person || !authorization || normalizeEmail(authorization.email) !== normalizeEmail(payload.email)) throw new NeonAuthApiError(403, '该账号未关联融资工作台人员、未分配角色、身份已变更或已停用', 'PERSON_ACCESS_DENIED');
  await db.prepare(`UPDATE people SET role = ?, auth0_permissions = ?::text[], auth0_account_active = TRUE,
    auth0_last_login_at = to_timestamp(?), auth0_authorized_until = to_timestamp(?)
    WHERE id = ? AND active = TRUE`).run(authorization.role, authorization.permissions, payload.iat,
      Math.min(Number(payload.exp), Math.floor(Date.now() / 1000) + 60), person.personId);
  const user = { ...person, id: auth0Id, email: authorization.email, role: authorization.role,
    permissions: authorization.permissions, hasAvatar: Boolean(person.hasAvatar) };
  if (useSessionCache) await cacheSessionUser(event, token, user);
  return user;
}

export async function requestAuth0PasswordReset(event) {
  const config = providerConfig();
  const response = await event.fetch(`https://${config.AUTH0_DOMAIN}/dbconnections/change_password`, {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: config.AUTH0_CLIENT_ID, email: event.locals.financingUser.email, connection: 'eastmoney-email' }),
  });
  if (!response.ok) throw new NeonAuthApiError(503, '密码重置请求暂时不可用');
}
