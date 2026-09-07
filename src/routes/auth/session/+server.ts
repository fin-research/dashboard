import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals, platform }) => Response.json({
  user: locals.user,
  enabled: String(platform?.env.ACCESS_MODE) === 'enforce',
}, { headers: { 'Cache-Control': 'no-store, private', Vary: 'Cookie, Cf-Access-Jwt-Assertion' } });
