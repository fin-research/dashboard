import { financingPersonView } from '$lib/identity';
export function load({ locals, depends }) {
  depends('financing:identity', 'financing:permissions');
  return { user: financingPersonView(locals.user), permissions: locals.permissions, auth0: true };
}
