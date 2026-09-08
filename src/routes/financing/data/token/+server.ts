import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { currentDataApiJwt } from '$lib/server/financing/auth.js';
import { getDataApiUrl } from '$lib/server/financing/data-api.js';
import { hasPermission } from '$lib/financing/permissions.js';
import { usesAuth0 } from '$lib/server/financing/auth-provider.js';
import { withBase } from '$lib/financing/app-paths';

export const GET: RequestHandler = async (event) => {
	if (!event.locals.user?.financing) throw error(401, '登录已失效');
	if (!hasPermission(event.locals.permissions, 'data_manage')) throw error(403, '当前角色无权使用数据后台');
	if (usesAuth0()) return json({ transport: 'worker', dataApiUrl: new URL(withBase('/data/api'), event.url).toString() },
		{ headers: { 'cache-control': 'no-store, private', vary: 'Cookie' } });
	const token = currentDataApiJwt(event);
	if (!token) throw error(503, '暂时无法取得 Neon Data API 令牌');
	return json(
		{ token, dataApiUrl: getDataApiUrl() },
		{ headers: { 'cache-control': 'no-store, private', vary: 'Cookie' } }
	);
};
