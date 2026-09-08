import { redirect } from '@sveltejs/kit';
export function load({ url }) { redirect(307, '/management/people' + url.search); }
export const actions = { default: ({ url }) => redirect(307, '/management/people' + url.search) };
