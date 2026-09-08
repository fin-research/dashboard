// @ts-nocheck
import { appCookiePath } from '../../financing/app-paths.js';
import { normalizeEmail } from '../../financing/email.js';
import { getDatabase } from './db.js';
import { cacheSessionUser, readCachedSessionUser } from './auth-cache.js';
import { NeonAuthApiError } from './neon-auth-client.js';
import { accessToken } from '../access.ts';
import { auth0Client, providerConfig, usesAuth0 } from './auth-provider.js';

export const SESSION_COOKIE = 'financing_session';
export const AUTH_ROLES = Object.freeze({ admin: 'admin', handler: 'handler', reviewer: 'reviewer' });
function clearSessionCookie(event) { event.cookies.delete(SESSION_COOKIE, { path: appCookiePath }); }
export function currentDataApiJwt(event) { return null; }
export async function deleteSession(event, token) { clearSessionCookie(event); }

export function updateCurrentAuthProfile(event, profile) {
  return auth0Client(event).request(`users/${encodeURIComponent(event.locals.user.auth0Id)}`, 'PATCH', profile);
}
export function changeCurrentPassword(event, currentPassword, newPassword) { return requestAuth0PasswordReset(event); }

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
}

export function updateManagedUser(event, userId, data) {
  if (usesAuth0()) {
    if (data.email && !/^[^@\s]+@18\.cn$/i.test(data.email)) throw new NeonAuthApiError(400, '仅允许 18.cn 邮箱');
    return auth0Client(event).request(`users/${encodeURIComponent(userId)}`, 'PATCH', data.email ? { ...data, email_verified: false, verify_email: true } : data);
  }
}

export function setManagedUserRole(event, userId, role) {
  if (usesAuth0()) return auth0Client(event).setRole(userId, role);
}

export function setManagedUserPassword(event, userId, newPassword) {
  if (usesAuth0()) return auth0Client(event).request(`users/${encodeURIComponent(userId)}`, 'PATCH', { password: newPassword, connection: 'eastmoney-email' });
}

export function banManagedUser(event, userId) {
  if (usesAuth0()) return auth0Client(event).request(`users/${encodeURIComponent(userId)}`, 'PATCH', { app_metadata: { financing_enabled: false } });
}

export function unbanManagedUser(event, userId) {
  if (usesAuth0()) return auth0Client(event).request(`users/${encodeURIComponent(userId)}`, 'PATCH', { app_metadata: { financing_enabled: true } });
}

export function removeManagedUser(event, userId) {
  if (usesAuth0()) return auth0Client(event).removeFinancingRoles(userId);
}

export { NeonAuthApiError } from './neon-auth-client.js';

export async function authorizeFinancing(event, { useSessionCache = false } = {}) {
  const identity = event.locals.user;
  if (!identity) return null;
  const auth0Id = identity.auth0Id;
  if (!auth0Id || !Number.isFinite(identity.issuedAt) || !Number.isFinite(identity.expiresAt)) {
    throw new NeonAuthApiError(503, 'Access 身份声明尚未配置完成');
  }
  if (event.cookies.get(SESSION_COOKIE)) clearSessionCookie(event);
  const token = accessToken(event.request);
  if (useSessionCache) {
    const cached = await readCachedSessionUser(event, token);
    if (cached?.id === auth0Id && normalizeEmail(cached.email) === normalizeEmail(identity.email)) {
      event.locals.authCacheStatus = 'hit'; return businessAuthorization(cached);
    }
  }
  event.locals.authCacheStatus = useSessionCache ? 'miss' : 'bypass';
  const db = getDatabase(event);
  const person = await db.prepare(`SELECT id AS personId, name AS personName, email, role,
    avatar_data_url IS NOT NULL AS hasAvatar, to_char(updated_at, 'YYYYMMDDHH24MISSUS') AS avatarVersion
    FROM people WHERE auth0_user_id = ? AND active = TRUE LIMIT 1`).get(auth0Id);
  let authorization = null;
  try { authorization = person ? await auth0Client(event).authorization(auth0Id) : null; }
  catch (error) { if (!(error instanceof NeonAuthApiError) || error.status !== 404) throw error; }
  if (!person || !authorization || normalizeEmail(authorization.email) !== normalizeEmail(identity.email)) throw new NeonAuthApiError(403, '该账号未关联融资工作台人员、未分配角色、身份已变更或已停用', 'PERSON_ACCESS_DENIED');
  await db.prepare(`UPDATE people SET role = ?, auth0_permissions = ?::text[], auth0_account_active = TRUE,
    auth0_last_login_at = to_timestamp(?), auth0_authorized_until = to_timestamp(?)
    WHERE id = ? AND active = TRUE`).run(authorization.role, authorization.permissions, identity.issuedAt,
      Math.min(Number(identity.expiresAt), Math.floor(Date.now() / 1000) + 60), person.personId);
  const user = { ...person, id: auth0Id, email: authorization.email, role: authorization.role,
    permissions: authorization.permissions, hasAvatar: Boolean(person.hasAvatar) };
  if (useSessionCache) await cacheSessionUser(event, token, user);
  return businessAuthorization(user);
}


function businessAuthorization(user) {
  return { personId: user.personId, personName: user.personName, role: user.role,
    permissions: user.permissions ?? [], hasAvatar: Boolean(user.hasAvatar), avatarVersion: user.avatarVersion ?? '0' };
}
export async function requestAuth0PasswordReset(event) {
  const config = providerConfig();
  const response = await event.fetch(`https://${config.AUTH0_DOMAIN}/dbconnections/change_password`, {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: config.AUTH0_CLIENT_ID, email: event.locals.user.email, connection: 'eastmoney-email' }),
  });
  if (!response.ok) throw new NeonAuthApiError(503, '密码重置请求暂时不可用');
}
