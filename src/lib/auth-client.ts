import { loginUrl } from './auth-navigation.ts';
import { pagePermission } from './route-permissions.ts';
import type { ClientSession } from './client-session';
import type { ClientSessionData } from './identity';
import type { BeforeNavigate } from '@sveltejs/kit';

export class LoginRequiredError extends Error {
  constructor() { super('请先登录'); }
}

// Browser navigation state only; never used to authorize a server request.
let redirecting = false;
export function isLoginRedirecting(): boolean { return redirecting; }

export function redirectToLogin(returnTo?: string): void {
  if (typeof window === 'undefined' || redirecting || window.location.pathname === '/auth/login') return;
  redirecting = true;
  window.location.assign(loginUrl(returnTo ?? window.location.pathname + window.location.search + window.location.hash));
}

export function withLoginRedirect(
  fetcher: typeof fetch,
  currentUrl: () => string,
  redirect: (returnTo: string) => void,
): typeof fetch {
  return async (input, init) => {
    const response = await fetcher(input, init);
    const current = new URL(currentUrl());
    const requested = new URL(input instanceof Request ? input.url : String(input), current);
    if (requested.origin === current.origin && response.status === 401) {
      redirect(current.pathname + current.search + current.hash);
      throw new LoginRequiredError();
    }
    return response;
  };
}

export async function requireClientLogin(returnTo: string, state: ClientSession): Promise<boolean> {
  const session = await state.load();
  if (!session.user) {
    redirectToLogin(returnTo);
    return false;
  }
  return true;
}

export function createClientNavigationGuard(state: ClientSession, options: {
  origin: () => string;
  navigate: (url: URL) => Promise<unknown>;
  error: (message: string) => void;
  login?: (returnTo: string) => void;
}) {
  let navigation = 0;
  return ({ to, cancel }: BeforeNavigate): void => {
    const attempt = ++navigation;
    // External navigation and server endpoints have their own request boundary.
    if (!to || to.url.origin !== options.origin() || !to.route.id) return;
    const permission = pagePermission(to.url.pathname, to.route.id);
    if (permission === 'public') return;
    const allowed = (session: ClientSessionData) => {
      if (!session.user) {
        (options.login ?? redirectToLogin)(to.url.pathname + to.url.search + to.url.hash);
        return false;
      }
      if (!permission || (permission !== 'login' && !session.permissions.includes(permission))) {
        options.error('当前角色无权访问该页面');
        return false;
      }
      return true;
    };
    const cached = state.current();
    if (cached) {
      if (!allowed(cached)) cancel();
      return;
    }
    cancel();
    void state.load().then(async session => {
      if (attempt === navigation && allowed(session)) await options.navigate(to.url);
    }).catch(error => {
      if (attempt === navigation && !isLoginRedirecting()) options.error(error.message);
    });
  };
}
