export function load({ locals, depends }) {
  depends('financing:identity', 'financing:permissions');
  return { user: locals.financingUser, permissions: locals.permissions, auth0: true };
}
