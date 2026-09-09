import type { RequestHandler } from './$types';
import { publicSession } from '$lib/identity';

export const GET: RequestHandler = async ({ locals, platform }) => {
  return Response.json({
    ...publicSession(locals.user),
    enabled: Boolean(platform?.env.GATEWAY_CONTEXT),
  }, { headers: { 'Cache-Control': 'no-store, private', Vary: 'Cookie, Authorization' } });
};
