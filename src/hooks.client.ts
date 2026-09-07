import type { HandleClientError } from '@sveltejs/kit';
import { redirectToLogin, withLoginRedirect } from '$lib/auth-client';

export function init() {
  window.fetch = withLoginRedirect(window.fetch.bind(window), () => window.location.href, redirectToLogin);
}

export const handleError: HandleClientError = ({ status, event, message }) => {
  if (status === 401) redirectToLogin(event.url.pathname + event.url.search + event.url.hash);
  return { message: status === 401 ? '请先登录' : message };
};
