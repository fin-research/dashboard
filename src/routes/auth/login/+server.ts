import type { RequestHandler } from './$types';
export const GET: RequestHandler = () => new Response('请通过统一网关登录', { status: 503 });
