import { redirect } from '@sveltejs/kit';
import { appRoot, isAppPath } from '$lib/financing/app-paths';
import { loginUrl } from '$lib/auth-navigation';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = ({ url }) => {
  const requested = url.searchParams.get('redirectTo');
  redirect(303, loginUrl(requested && isAppPath(requested) ? requested : appRoot));
};
// Legacy form submissions start central login without reading credentials.
export const actions: Actions = { default: () => redirect(303, loginUrl(appRoot)) };
