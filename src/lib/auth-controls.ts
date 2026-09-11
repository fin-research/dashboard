import { clientRequestPermission } from './route-permissions.ts';
import { requireClientPermission, sessionAllows, requestLogin } from './auth-client.ts';
import type { ClientSession } from './client-session';

/** Capture native submits and non-SPA links before the browser can unload the document. */
export function installAuthControls(state: ClientSession, document: Document, reportError: (message: string) => void) {
  const replay = new WeakSet<Element>();
  const pending = new WeakSet<Element>();
  function preflight(event: Event, element: Element, url: URL, method: string, resume: () => void) {
    if (url.origin !== document.location.origin || replay.has(element)) return;
    const permission = clientRequestPermission(url, method);
    if (!permission || permission === 'public') return;
    const current = state.current();
    if (current && sessionAllows(current, permission)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (pending.has(element)) return;
    pending.add(element);
    void requireClientPermission(permission, document.location.pathname, state).then(allowed => {
      if (!allowed || !element.isConnected) return;
      replay.add(element);
      try { resume(); } finally { replay.delete(element); }
    }).catch(error => reportError(error.message)).finally(() => pending.delete(element));
  }
  function submit(event: SubmitEvent) {
    if (!(event.target instanceof HTMLFormElement)) return;
    const form = event.target;
    const button = event.submitter instanceof HTMLButtonElement || event.submitter instanceof HTMLInputElement ? event.submitter : null;
    const action = button?.hasAttribute('formaction') ? button.formAction : form.action;
    const method = button?.hasAttribute('formmethod') ? button.formMethod : form.method;
    if (method.toLowerCase() === 'dialog') return;
    preflight(event, form, new URL(action, document.location.href), method, () => form.requestSubmit(button));
  }
  function click(event: MouseEvent) {
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    const anchor = event.target.closest<HTMLAnchorElement>('a[href]');
    if (!anchor) return;
    const url = new URL(anchor.href, document.location.href);
    if (url.origin === document.location.origin && url.pathname === '/auth/login') {
      event.preventDefault(); event.stopImmediatePropagation();
      void requestLogin(document.location.pathname);
      return;
    }
    // Normal same-tab SvelteKit links use beforeNavigate and resume via goto.
    if (!anchor.target && !anchor.hasAttribute('download') && !anchor.hasAttribute('data-sveltekit-reload')
      && !/\.html$/.test(url.pathname) && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) return;
    preflight(event, anchor, url, 'GET', () => anchor.click());
  }
  function protectPreload(event: Event) {
    if (!(event.target instanceof Element)) return;
    const anchor = event.target.closest<HTMLAnchorElement>('a[href]');
    if (!anchor || anchor.origin !== document.location.origin) return;
    const permission = clientRequestPermission(new URL(anchor.href), 'GET');
    const current = state.current();
    if (permission && permission !== 'public' && (!current || !sessionAllows(current, permission))) {
      if (!anchor.hasAttribute('data-auth-preload')) {
        anchor.dataset.authPreload = anchor.getAttribute('data-sveltekit-preload-data') ?? '';
        anchor.setAttribute('data-sveltekit-preload-data', 'off');
      }
    } else if (anchor.hasAttribute('data-auth-preload')) {
      const previous = anchor.dataset.authPreload;
      if (previous) anchor.setAttribute('data-sveltekit-preload-data', previous);
      else anchor.removeAttribute('data-sveltekit-preload-data');
      delete anchor.dataset.authPreload;
    }
  }
  // Prevent speculative hover/tap preloads from opening login before a click.
  for (const type of ['mousemove', 'mousedown', 'touchstart']) document.addEventListener(type, protectPreload, true);
  document.addEventListener('submit', submit, true);
  document.addEventListener('click', click, true);
  return () => {
    document.removeEventListener('submit', submit, true); document.removeEventListener('click', click, true);
    for (const type of ['mousemove', 'mousedown', 'touchstart']) document.removeEventListener(type, protectPreload, true);
  };
}
