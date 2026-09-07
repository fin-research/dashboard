import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { accessIssuer } from '$lib/server/access';

const logout: RequestHandler = ({ cookies, platform }) => {
  const env = platform?.env;
  if (!env?.AUTH0_DOMAIN || !env.AUTH0_CLIENT_ID) throw error(503, '统一账号尚未配置完成');
  cookies.delete('CF_Authorization', { path: '/' });
  cookies.delete('financing_session', { path: '/financing' });
  const target = new URL(`https://${env.AUTH0_DOMAIN}/v2/logout`);
  target.searchParams.set('client_id', env.AUTH0_CLIENT_ID);
  target.searchParams.set('returnTo', `${accessIssuer(env)}/cdn-cgi/access/logout`);
  throw redirect(303, target.toString());
};
export const GET = logout;
export const POST = logout;
