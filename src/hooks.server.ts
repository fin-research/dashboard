import { redirect, type Handle } from '@sveltejs/kit';
import { AccessError } from '$lib/server/access';
import { loginUrl } from '$lib/auth-navigation';
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
    if (event.isDataRequest && error instanceof AccessError && error.status === 401) {
      redirect(303, loginUrl(event.url.pathname + event.url.search));
    }
    return dashboardAccessFailure(event.request, error);
  }
  const response = await resolve(event);
  if (response.status === 401) {
    if (event.isDataRequest) redirect(303, loginUrl(event.url.pathname + event.url.search));
    return dashboardAccessFailure(event.request, new AccessError(401, '请先登录'));
  }
  if (event.locals.user) {
    response.headers.set('Cache-Control', 'no-store, private');
    response.headers.append('Vary', 'Cookie, Cf-Access-Jwt-Assertion');
  }
  return response;
};
