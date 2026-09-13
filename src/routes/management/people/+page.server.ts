import { identityJson } from '$lib/server/gateway-client';
import type { Auth0Role } from '$lib/server/auth0-directory';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, platform, depends }) => {
  depends('auth:permissions');
  return identityJson<{
  roles: Auth0Role[]; configurations: Record<string, { permissions: string[] }>; mode: 'enforce'; updatedAt: number;
}>(platform!.env, '/roles/configurations', locals.user);
};
