import { identityJson } from '$lib/server/gateway-client';
import type { Auth0Role, DirectoryPerson } from '$lib/server/auth0-directory';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform, depends }) => {
  depends('auth:permissions');
  const [configuration, people] = await Promise.all([identityJson<{
  roles: Auth0Role[]; configurations: Record<string, { permissions: string[] }>; mode: 'enforce'; updatedAt: number;
}>(platform!.env, '/roles/configurations', locals.user), identityJson<DirectoryPerson[]>(platform!.env, '/directory/people', locals.user)]);
  return { ...configuration, people };
};
