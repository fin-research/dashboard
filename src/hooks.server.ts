import { redirect, type Handle } from '@sveltejs/kit';
import { AccessError } from '$lib/server/access';
import { loginUrl } from '$lib/auth-navigation';
import { dashboardAccessFailure } from '$lib/server/dashboard-access';
import { gatewayContext } from '$lib/server/gateway-context';
import { closeDatabase } from '$lib/server/financing/db.js';

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.user = null;
  event.locals.database = null;
  event.locals.permissions = [];
  try {
    if (!event.platform?.env) return new Response('身份服务暂时不可用', { status: 503 });
    try {
      const authorization = gatewayContext(event.platform.env);
      event.locals.user = authorization.user;
      event.locals.permissions = authorization.permissions;
    } catch (failure) {
      if (event.isDataRequest && failure instanceof AccessError && failure.status === 401) redirect(303, loginUrl(event.url.pathname + event.url.search));
      return dashboardAccessFailure(event.request, failure);
    }
    const response = await resolve(event);
    if (response.status === 401) {
      if (event.isDataRequest) redirect(303, loginUrl(event.url.pathname + event.url.search));
      return dashboardAccessFailure(event.request, new AccessError(401, '请先登录'));
    }
    if (event.locals.user || event.locals.permissions.length) {
      response.headers.set('Cache-Control', 'no-store, private');
      response.headers.append('Vary', 'Cookie, Authorization');
    }
    return response;
  } finally { await closeDatabase(event); }
};
