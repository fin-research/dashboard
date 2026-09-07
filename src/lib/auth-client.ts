import { loginUrl } from './auth-navigation.ts';

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

export async function requireClientLogin(returnTo: string): Promise<boolean> {
  const response = await fetch('/auth/session', { cache: 'no-store' });
  if (!response.ok) throw new Error('登录状态暂时无法读取，请稍后重试');
  const session = await response.json() as { user?: { email?: string } | null };
  if (!session.user?.email) {
    redirectToLogin(returnTo);
    return false;
  }
  return true;
}
