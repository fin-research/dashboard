import { error, fail } from '@sveltejs/kit';
import { getDirectory } from '$lib/server/directory';
import { getDatabase } from '$lib/server/financing/db.js';
import { roleConfiguration, saveRoleConfiguration, PermissionConfigurationError } from '$lib/server/permission-repository';
import { hasPermission, isPermissionCode } from '$lib/permissions';
import { AccessError } from '$lib/server/access';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const roles = await getDirectory().roles();
  const configurations: Record<string, { permissions: string[]; version: string }> = {};
  const db = getDatabase();
  for (const role of roles) configurations[role.id] = await roleConfiguration(db, role.id);
  return { roles, configurations, mode: locals.user?.authorization?.mode };
};

export const actions: Actions = {
  saveRolePermissions: async ({ request, locals }) => {
    if (!hasPermission(locals.permissions, 'auth.permission:update') || !locals.user?.auth0Id) error(403, '当前角色无权配置权限');
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
    const role = (await getDirectory().roles()).find(role => role.id === roleId);
    if (!role) return fail(400, { message: 'Auth0 角色已不存在，请刷新页面' });
    try {
      const configuration = await getDatabase().transaction((db: ReturnType<typeof getDatabase>) => saveRoleConfiguration(db, roleId, permissions, version, locals.user!.auth0Id!));
      return { success: true, roleId, configuration, message: `${role.name} 的权限已保存` };
    } catch (cause) {
      if (cause instanceof PermissionConfigurationError) return fail(cause.status, { message: cause.message });
      return fail(503, { message: '权限保存失败，请稍后重试' });
    }
  },
};
