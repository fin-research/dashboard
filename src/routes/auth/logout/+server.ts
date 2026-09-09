import type { RequestHandler } from './$types';
export const GET: RequestHandler = () => new Response('请通过统一网关退出', { status: 503 });
export const POST = GET;
