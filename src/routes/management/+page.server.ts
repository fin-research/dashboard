import { redirect } from '@sveltejs/kit';
export function load() { redirect(303, '/fund-report?upload=1'); }
