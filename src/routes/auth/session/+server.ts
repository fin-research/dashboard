import type { RequestHandler } from './$types';
import { publicIdentity } from '$lib/identity';

export const GET: RequestHandler = ({ locals, platform }) => Response.json({
  user: publicIdentity(locals.user),
  enabled: String(platform?.env.ACCESS_MODE) === 'enforce',
}, { headers: { 'Cache-Control': 'no-store, private', Vary: 'Cookie, Cf-Access-Jwt-Assertion' } });
