import type { LayoutServerLoad } from './$types';

// Reading pathname makes every client-side route change visit the server entry
// guard, including pages whose own load is otherwise entirely client-side.
export const load: LayoutServerLoad = ({ locals, url }) => ({
  routePath: url.pathname,
  permissions: locals.permissions,
  account: locals.user?.authorization ? { name: locals.user.authorization.name, department: locals.user.authorization.department ?? '' } : null,
});
