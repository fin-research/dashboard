import type { Handle } from '@sveltejs/kit';
import { dashboardAccessFailure, dashboardIdentity, requireSameOrigin } from '$lib/server/dashboard-access';

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.user = null;
  try {
    if (event.platform?.env) {
      event.locals.user = await dashboardIdentity(event.request, event.platform.env);
      if (String(event.platform.env.ACCESS_MODE) === 'enforce') requireSameOrigin(event.request);
    } else if (!import.meta.env.DEV) {
      return new Response('身份服务暂时不可用', { status: 503 });
    }
  } catch (error) {
    return dashboardAccessFailure(event.request, error);
  }
  const response = await resolve(event);
  if (event.locals.user) {
    response.headers.set('Cache-Control', 'no-store, private');
    response.headers.append('Vary', 'Cookie, Cf-Access-Jwt-Assertion');
  }
  return response;
};
