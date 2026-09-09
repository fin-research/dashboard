import { fail } from '@sveltejs/kit';
import { identityJson, GatewayServiceError } from '$lib/server/gateway-client';
import { isPermissionCode } from '$lib/permissions';
import type { Auth0Role } from '$lib/server/auth0-directory';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, platform }) => identityJson<{
  roles: Auth0Role[]; configurations: Record<string, { permissions: string[]; version: string }>; mode: 'beta-open' | 'enforce';
}>(platform!.env, '/roles/configurations', locals.user);

export const actions: Actions = {
  saveRolePermissions: async ({ request, locals, platform }) => {
    const reader = request.body?.getReader();
    if (!reader) return fail(400, { message: '缺少权限配置' });
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 32768) { await reader.cancel(); return fail(413, { message: '权限配置过大' }); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let data: FormData;
    try { data = await new Request(request.url, { method: 'POST', headers: request.headers, body: bytes }).formData(); }
    catch { return fail(400, { message: '权限配置格式无效' }); }
    const roleId = String(data.get('roleId') ?? '');
    const version = String(data.get('version') ?? '');
    const permissions = data.getAll('permissions').map(String);
    if (!/^[a-f0-9]{64}$/.test(version) || permissions.some(code => !isPermissionCode(code)) || [...data.keys()].some(key => !['roleId', 'version', 'permissions'].includes(key))) return fail(400, { message: '权限配置格式无效' });
    try {
      const confirmed = await identityJson<{ success: boolean; roleId: string; configuration: { permissions: string[]; version: string }; message: string }>(
        platform!.env, '/roles/configurations', locals.user, { roleId, permissions, version });
      const { configuration, message } = confirmed;
      return { success: true, roleId, configuration, message };
    } catch (cause) {
      if (cause instanceof GatewayServiceError) return fail(cause.status, { message: cause.message });
      return fail(503, { message: '权限保存失败，请稍后重试' });
    }
  },
};
