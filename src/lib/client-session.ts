import { writable } from 'svelte/store';
import { publicSession, type ClientSessionData } from './identity.ts';

export const CLIENT_SESSION_CONTEXT = 'site-session';
export type ClientSession = ReturnType<typeof createClientSession>;

/** Owned by one root layout, so SSR requests never share a user's snapshot. */
export function createClientSession(
  initial: ClientSessionData | null = null,
  fetcher: typeof fetch = (...args) => fetch(...args),
  now: () => number = Date.now,
) {
  let value = initial;
  let revision = 0;
  let pending: Promise<ClientSessionData> | null = null;
  const store = writable(value);
  function seed(next: ClientSessionData) {
    revision++;
    value = next;
    store.set(next);
  }
  function current() {
    if (value?.user && (!value.expiresAt || value.expiresAt * 1000 <= now())) return null;
    return value;
  }
  function load(force = false): Promise<ClientSessionData> {
    const cached = current();
    if (!force && cached) return Promise.resolve(cached);
    if (pending) return pending;
    const startedAt = revision;
    pending = (async () => {
      const response = await fetcher('/auth/session', { cache: 'no-store' });
      if (!response.ok) throw new Error('登录状态暂时无法读取，请稍后重试');
      let session = await response.json() as ClientSessionData;
      if (!Array.isArray(session.permissions) || !Array.isArray(session.roles)
        || (session.user && (!session.user.email || !Number.isFinite(session.expiresAt)))) {
        throw new Error('登录状态暂时无法读取，请稍后重试');
      }
      // JWT verification has clock tolerance; never resume navigation with an
      // already-expired snapshot and enter an endless refresh/goto cycle.
      if (session.user && session.expiresAt! * 1000 <= now()) session = publicSession(null);
      // A late public-page request must not replace a newer SSR/action snapshot.
      if (revision === startedAt) seed(session);
      return value!;
    })().finally(() => { pending = null; });
    return pending;
  }
  return { subscribe: store.subscribe, seed, current, load };
}
