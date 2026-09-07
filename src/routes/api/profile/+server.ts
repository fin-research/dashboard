import type { RequestHandler } from './$types';
import { AccessError, accessFailure } from '$lib/server/access';
import { createProfileService, ProfileError, readProfileJson } from '$lib/server/profile';

const headers = { 'Cache-Control': 'no-store, private', Vary: 'Cookie, Cf-Access-Jwt-Assertion' };
function failure(error: unknown) {
  if (error instanceof AccessError) return accessFailure(error);
  return Response.json({ detail: error instanceof ProfileError ? error.message : '个人信息操作失败，请稍后重试' }, {
    status: error instanceof ProfileError ? error.status : 503, headers,
  });
}

export const GET: RequestHandler = async ({ locals, platform }) => {
  try {
    if (!locals.user) throw new AccessError(401, '请先登录');
    if (!platform?.env) throw new ProfileError(503, '个人信息服务暂时不可用');
    return Response.json(await createProfileService(platform.env, locals.user).read(), { headers });
  } catch (error) { return failure(error); }
};

export const POST: RequestHandler = async ({ locals, platform, request, cookies }) => {
  try {
    if (!locals.user) throw new AccessError(401, '请先登录');
    if (!platform?.env) throw new ProfileError(503, '个人信息服务暂时不可用');
    if (!request.headers.get('Content-Type')?.includes('application/json')) throw new ProfileError(415, '请提交 JSON 格式的个人信息');
    const result = await createProfileService(platform.env, locals.user).update(await readProfileJson(request, 4096));
    if (result.logout) cookies.delete('CF_Authorization', { path: '/' });
    return Response.json(result, { headers });
  } catch (error) { return failure(error); }
};
