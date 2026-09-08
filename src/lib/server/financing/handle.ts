import { error as httpError, redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit';
import { appRoot, withBase } from '$lib/financing/app-paths';
import { invalidateCachedSession } from '$lib/server/financing/auth-cache.js';
import { closeDatabase } from '$lib/server/financing/db.js';
import { actionNameFromUrl, isAuthorizedRequest, isSafeRequestMethod } from '$lib/server/financing/request-authorization.js';
import {
	authorizeFinancing,
	NeonAuthApiError
} from '$lib/server/financing/auth.js';
import { accessToken } from '$lib/server/access';
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
		const sessionToken = isStaticAsset ? null : accessToken(event.request);
		const safeRequest = isSafeRequestMethod(event.request.method);
		if (sessionToken && !safeRequest) await invalidateCachedSession(event, sessionToken);
		const authStartedAt = performance.now();
		try {
      if (event.locals.user && !isStaticAsset) {
        event.locals.user.financing = await authorizeFinancing(event, {
          useSessionCache: safeRequest && routeId !== '/data/token' && routeId !== '/data/api/[...path]'
        }) ?? undefined;
      }
		} catch (authError) {
			if (authError instanceof NeonAuthApiError && authError.code === 'PERSON_ACCESS_DENIED') throw httpError(403, authError.message);
			if (authError instanceof NeonAuthApiError && authError.status === 503) {
				console.warn(JSON.stringify({ event: 'identity_unavailable', code: authError.code }));
				throw httpError(503, '认证服务暂时不可用，请稍后重试');
			}
			throw authError;
		}
		const authDurationMs = performance.now() - authStartedAt;
    if (!isPublic && !event.locals.user) throw httpError(401, '登录已失效，请重新登录');
    if (!isPublic && !event.locals.user?.financing) throw httpError(403, '当前账号未关联融资人员或未获授权');
    event.locals.permissions = event.locals.user?.financing?.permissions ?? [];

		const actionName = actionNameFromUrl(event.url);
		if (!isPublic && !isAuthorizedRequest(event.locals.permissions, routeId, event.request.method, actionName)) {
			return new Response('当前账号无权执行该操作', { status: 403 });
		}

		if (routeId === '/login' && event.locals.user?.financing && event.request.method === 'GET') {
			throw redirect(303, appRoot);
		}

		const response = await resolve(event);
		if (isStaticAsset) return response;
		const headers = new Headers(response.headers);
		if (routeId !== '/avatar' || response.status !== 200) headers.set('Cache-Control', 'no-store, private');
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
