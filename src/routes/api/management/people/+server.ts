import type { RequestHandler } from './$types';
import { identityRequest } from '$lib/server/gateway-client';
import { ProfileError, readProfileJson } from '$lib/server/profile';

export const POST: RequestHandler = async ({ locals, platform, request }) => {
  try {
    return await identityRequest(platform!.env, '/directory/people/profile', locals.user, await readProfileJson(request, 4096));
  } catch (error) {
    return Response.json({ detail: error instanceof ProfileError ? error.message : '人员资料服务暂时不可用，请稍后重试' }, {
      status: error instanceof ProfileError ? error.status : 503,
      headers: { 'Cache-Control': 'no-store, private' },
    });
  }
};
