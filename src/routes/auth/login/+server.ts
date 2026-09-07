import { redirect, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { safeReturnTo } from '$lib/server/dashboard-access';

export const GET: RequestHandler = ({ locals, url }) => {
  if (!locals.user) throw error(503, '统一登录尚未启用');
  throw redirect(303, safeReturnTo(url.searchParams.get('returnTo')));
};
