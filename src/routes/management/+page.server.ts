import { redirect } from '@sveltejs/kit';
export function load({ url }) {
  // Preserve the former upload bookmark while making the base path a management hub.
  if (url.searchParams.get('upload') === '1') redirect(303, '/fund-report?upload=1');
  return {};
}
