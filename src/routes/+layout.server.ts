import type { LayoutServerLoad } from './$types';
import { publicSession } from '$lib/identity';

// The root snapshot survives route changes. Real page/API requests are still
// authorized by hooks; explicit account changes can invalidate this dependency.
export const load: LayoutServerLoad = ({ locals, depends }) => {
  depends('site:session');
  const session = locals.user ? publicSession(locals.user) : null;
  return { session, permissions: locals.permissions, account: session?.account ?? null };
};
