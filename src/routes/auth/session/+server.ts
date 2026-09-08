import type { RequestHandler } from './$types';
import { publicIdentity } from '$lib/identity';
import { createDirectory } from '$lib/server/auth0-directory';

export const GET: RequestHandler = async ({ locals, platform, fetch }) => {
  const profile = locals.user?.auth0Id && platform?.env
    ? await createDirectory(platform.env, fetch).current(locals.user) : null;
  return Response.json({
    account: profile ? { name: profile.name, department: profile.department } : null,
    user: publicIdentity(locals.user),
    enabled: String(platform?.env.ACCESS_MODE) === 'enforce',
  }, { headers: { 'Cache-Control': 'no-store, private', Vary: 'Cookie, Cf-Access-Jwt-Assertion' } });
};
