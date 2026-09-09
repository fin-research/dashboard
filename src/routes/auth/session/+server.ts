import type { RequestHandler } from './$types';
import { publicSession } from '$lib/identity';

export const GET: RequestHandler = async ({ locals, platform }) => {
  return Response.json({
    ...publicSession(locals.user),
    enabled: String(platform?.env.ACCESS_MODE) === 'enforce',
  }, { headers: { 'Cache-Control': 'no-store, private', Vary: 'Cookie, Cf-Access-Jwt-Assertion' } });
};
