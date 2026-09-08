import { error as httpError, redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit';
import { appCookiePath, appRoot, withBase } from '$lib/financing/app-paths';
import { invalidateCachedSession } from '$lib/server/financing/auth-cache.js';
import { closeDatabase } from '$lib/server/financing/db.js';
import { getRolePermissionCodes } from '$lib/server/financing/role-permissions.js';
import { actionNameFromUrl, isAuthorizedRequest, isSafeRequestMethod } from '$lib/server/financing/request-authorization.js';
import {
	getSessionUser,
	NeonAuthApiError,
	SESSION_COOKIE
} from '$lib/server/financing/auth.js';
import { accessToken } from '$lib/server/access';
import { usesAuth0 } from '$lib/server/financing/auth-provider.js';
import { financingRouteId } from '$lib/financing/route-contract';

export const handle: Handle = async ({ event, resolve }) => {
	try {
		event.locals.dataApiJwt = null;
		event.locals.authCacheStatus = 'bypass';
		event.locals.permissions = [];
		const routeId = financingRouteId(event.route.id);
    const legacyTargets: Record<string, string> = { '/financing/people': '/management/people', '/financing/settings': '/management/financing-profile' };
    const legacyTarget = legacyTargets[event.route.id ?? ''];
    if (legacyTarget) throw redirect(307, legacyTarget + event.url.search);
		const isStaticAsset = event.url.pathname.startsWith(withBase('/_app/'));
		const isPublic = routeId === '/login' || isStaticAsset;
		const sessionToken = isStaticAsset ? null : usesAuth0() ? accessToken(event.request) : event.cookies.get(SESSION_COOKIE);
		const safeRequest = isSafeRequestMethod(event.request.method);
		if (sessionToken && !safeRequest) await invalidateCachedSession(event, sessionToken);
		const authStartedAt = performance.now();
		try {
			event.locals.financingUser = isStaticAsset
				? null
				: await getSessionUser(event, sessionToken, {
					requireDataApiJwt: routeId === '/data/token',
					useSessionCache: safeRequest && routeId !== '/data/token' && routeId !== '/data/api/[...path]'
				});
		} catch (authError) {
			if (authError instanceof NeonAuthApiError && authError.code === 'PERSON_ACCESS_DENIED') throw httpError(403, authError.message);
			if (authError instanceof NeonAuthApiError && authError.status === 503) {
				console.warn(JSON.stringify({ event: 'identity_unavailable', code: authError.code }));
				throw httpError(503, '认证服务暂时不可用，请稍后重试');
			}
			throw authError;
		}
		const authDurationMs = performance.now() - authStartedAt;
		if (!usesAuth0() && sessionToken && !event.locals.financingUser) {
			event.cookies.delete(SESSION_COOKIE, { path: appCookiePath });
		}
		if (!isPublic && !event.locals.financingUser) {
			const redirectTo = `${event.url.pathname}${event.url.search}`;
			if (usesAuth0()) {
				if (routeId?.startsWith('/data/') || !safeRequest) throw httpError(401, '登录已失效，请重新登录');
				throw redirect(303, `/auth/login?returnTo=${encodeURIComponent(redirectTo)}`);
			}
			throw redirect(303, `${withBase('/login')}?redirectTo=${encodeURIComponent(redirectTo)}`);
		}
		if (event.locals.financingUser) {
			event.locals.permissions = usesAuth0() ? event.locals.financingUser.permissions ?? [] : await getRolePermissionCodes(event.locals.financingUser.role);
		}

		const actionName = actionNameFromUrl(event.url);
		if (!isPublic && !isAuthorizedRequest(event.locals.permissions, routeId, event.request.method, actionName)) {
			return new Response('当前账号无权执行该操作', { status: 403 });
		}

		if (routeId === '/login' && event.locals.financingUser && event.request.method === 'GET') {
			throw redirect(303, appRoot);
		}

		const response = await resolve(event);
		if (isStaticAsset) return response;
		const headers = new Headers(response.headers);
		headers.set('Cache-Control', 'no-store, private');
		headers.append('Vary', 'Cookie, Cf-Access-Jwt-Assertion');
		headers.append(
			'Server-Timing',
			`auth;dur=${authDurationMs.toFixed(1)};desc="${event.locals.authCacheStatus}"`
		);
		if (event.locals.database) {
			headers.append(
				'Server-Timing',
				`db;dur=${event.locals.database.queryDurationMs.toFixed(1)};desc="${event.locals.database.queryCount} queries"`
			);
		}
		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers
		});
	} finally {
		await closeDatabase(event);
	}
};
