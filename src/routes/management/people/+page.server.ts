import { randomUUID } from 'node:crypto';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDatabase } from '$lib/server/financing/db.js';
import {
	banManagedUser, createManagedUser, NeonAuthApiError, removeManagedUser,
	setManagedUserPassword, setManagedUserRole, unbanManagedUser, updateManagedUser
} from '$lib/server/financing/auth.js';
import { getPeopleAccessData, getPersonAccessData } from '$lib/server/financing/queries.js';
import { auditRequestMeta, prepareAudit } from '$lib/server/financing/audit.js';
import { isValidEmail, normalizeEmail } from '$lib/financing/email.js';
import { MIN_PASSWORD_LENGTH } from '$lib/financing/password-policy';
import { hasPermission, isPermissionCode } from '$lib/financing/permissions.js';
import { roleLabel } from '$lib/financing/roles';
import { getRolePermissionMatrix } from '$lib/server/financing/role-permissions.js';

import { accountSql, auth0Client, refreshAuth0People, usesAuth0 } from '$lib/server/financing/auth-provider.js';

const validRoles = new Set(['admin', 'handler', 'reviewer']);

function identityFields(data: FormData) {
	return {
		name: String(data.get('name') ?? '').trim(),
		email: normalizeEmail(data.get('email')),
		role: String(data.get('role') ?? '').trim(),
		accountEnabled: String(data.get('accountEnabled') ?? '') === '1',
		password: String(data.get('password') ?? '')
	};
}

function validationMessage(fields: ReturnType<typeof identityFields>, existingAccount = false) {
	if (!fields.name || !isValidEmail(fields.email) || !validRoles.has(fields.role)) return '请填写姓名、有效邮箱并选择系统角色';
	if (fields.role === 'admin' && !fields.accountEnabled) return '管理员必须开通登录权限';
	if (!fields.accountEnabled) return null;
	if (!existingAccount && fields.password.length < MIN_PASSWORD_LENGTH && !(usesAuth0() && !fields.password)) return `新账号密码不得少于 ${MIN_PASSWORD_LENGTH} 个字符`;
	if (fields.password && fields.password.length < MIN_PASSWORD_LENGTH) return `重置密码不得少于 ${MIN_PASSWORD_LENGTH} 个字符`;
	return null;
}

async function identityState(db: ReturnType<typeof getDatabase>, id: string) {
	await refreshAuth0People();
	const account = accountSql();
	return await db.prepare(`
		SELECT p.id, p.name, p.email, p.role, p.active,
			${account.id} AS accountId,
			${account.role} AS accountRole, ${account.active} AS accountActive
		FROM people p ${usesAuth0() ? '' : 'LEFT JOIN neon_auth."user" u ON u.id = p.neon_auth_user_id'}
		WHERE p.id = ?
	`).get(id) as any;
}

async function activeAdminCount(db: ReturnType<typeof getDatabase>) {
	const account = accountSql();
	const row = await db.prepare(`
		SELECT COUNT(*) AS count
		FROM people p ${usesAuth0() ? '' : 'LEFT JOIN neon_auth."user" u ON u.id = p.neon_auth_user_id'}
		WHERE p.role = 'admin' AND p.active = TRUE AND ${account.id} IS NOT NULL AND ${account.active}
	`).get();
	return Number(row?.count ?? 0);
}

function constraintMessage(error: unknown) {
	if (error instanceof NeonAuthApiError) {
		if (error.status === 409 || error.code?.includes('USER_ALREADY_EXISTS')) return '该邮箱已存在登录账号，请直接编辑现有人员或更换邮箱';
		if (error.status === 429) return '认证操作过于频繁，请稍后重试';
		if (error.status === 401 || error.status === 403) return '当前会话无权执行该账号操作，请重新登录';
		if (error.status === 503) return '统一账号 暂时不可用，请稍后重试';
		return '统一账号 账号操作失败，请检查邮箱和密码后重试';
	}
	const message = error instanceof Error ? error.message : String(error);
	if (message.includes('idx_people_email_unique') || message.includes('people_email_key') || message.includes('people.email')) return '该邮箱已被其他人员使用，请直接编辑现有人员或更换邮箱';
	if (message.includes('people.name')) return '人员姓名已存在，请直接编辑现有人员';
	return '保存失败，请稍后重试';
}

async function duplicatePerson(db: ReturnType<typeof getDatabase>, name: string, email: string, exceptId = '') {
	return await db.prepare('SELECT id FROM people WHERE id <> ? AND (name = ? OR LOWER(email) = LOWER(?)) LIMIT 1').get(exceptId, name, email);
}

export const load: PageServerLoad = async () => {
  await refreshAuth0People();
  return { peopleAccess: await getPeopleAccessData() };
};

async function peopleSuccess(
	message: string,
	{ personId, ...extra }: { personId?: string; [key: string]: unknown } = {}
) {
	return {
		success: true,
		message,
		...extra,
		person: personId ? await getPersonAccessData(personId) : undefined
	};
}

export const actions: Actions = {
	createPerson: async (event) => {
		const fields = identityFields(await event.request.formData());
		if (!hasPermission(event.locals.permissions, 'people_manage')) {
			return fail(403, { message: '当前角色无权添加人员' });
		}
		const message = validationMessage(fields);
		if (message) return fail(400, { message });
		const db = getDatabase();
		if (await duplicatePerson(db, fields.name, fields.email)) return fail(409, { message: '姓名或邮箱已存在，请直接编辑现有人员' });
		const personId = randomUUID();
		let accountId: string | null = null;
		try {
			if (fields.accountEnabled) {
				const account = await createManagedUser(event, { email: fields.email, password: fields.password, name: fields.name, role: fields.role });
				accountId = account?.id ? String(account.id) : null;
				if (!accountId) throw new Error('统一账号 did not return a user id');
			}
			await db.batch([
				db.prepare(usesAuth0()
					? 'INSERT INTO people (id, name, email, role, active, auth0_user_id, auth0_account_active) VALUES (?, ?, ?, ?, TRUE, ?, TRUE)'
					: 'INSERT INTO people (id, name, email, role, active, neon_auth_user_id) VALUES (?, ?, ?, ?, TRUE, ?::uuid)').bind(personId, fields.name, fields.email, fields.role, accountId),
				prepareAudit({ ...auditRequestMeta(event), db, action: 'person.create', entityType: 'person', entityId: personId, summary: `添加人员：${fields.name}`, after: { name: fields.name, email: fields.email, role: fields.role, accountEnabled: fields.accountEnabled, active: true } })
			]);
		} catch (error) {
			if (accountId) await removeManagedUser(event, accountId).catch(() => null);
			return fail(409, { message: constraintMessage(error) });
		}
		return await peopleSuccess(
			`已添加 ${fields.name}${fields.accountEnabled ? ' 并开通 统一账号 登录' : ''}`,
			{ personId }
		);
	},

	updatePerson: async (event) => {
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '').trim();
		const db = getDatabase();
		const before = id ? await identityState(db, id) : undefined;
		if (!before) return fail(404, { message: '未找到该人员' });
		const fields = identityFields(data);
		const message = validationMessage(fields, Boolean(before.accountId));
		if (message) return fail(400, { message });
		if (await duplicatePerson(db, fields.name, fields.email, id)) return fail(409, { message: '姓名或邮箱已存在，请直接编辑现有人员' });
		if (before.accountId && !fields.accountEnabled && event.locals.financingUser?.personId === id) return fail(400, { message: '不能移除当前登录权限' });
		if (before.accountRole === 'admin' && (!fields.accountEnabled || fields.role !== 'admin' || (usesAuth0() && fields.email !== normalizeEmail(before.email))) && await activeAdminCount(db) <= 1) return fail(400, { message: '至少保留一个启用中的管理员账号' });
		let accountId: string | null = before.accountId;
		let created = false;
		try {
			if (!fields.accountEnabled && accountId) {
				await removeManagedUser(event, accountId);
				accountId = null;
			} else if (fields.accountEnabled && accountId) {
				const changes = {
					...(fields.name !== before.name ? { name: fields.name } : {}),
					...(fields.email !== normalizeEmail(before.email) ? { email: fields.email } : {})
				};
				if (Object.keys(changes).length) await updateManagedUser(event, accountId, changes);
				if (fields.role !== before.accountRole) await setManagedUserRole(event, accountId, fields.role);
				if (fields.password) await setManagedUserPassword(event, accountId, fields.password);
			} else if (fields.accountEnabled) {
				const account = await createManagedUser(event, { email: fields.email, password: fields.password, name: fields.name, role: fields.role });
				accountId = account?.id ? String(account.id) : null;
				if (!accountId) throw new Error('统一账号 did not return a user id');
				created = true;
				if (!before.active) await banManagedUser(event, accountId);
			}
			await db.batch([
				db.prepare(usesAuth0()
					? 'UPDATE people SET name = ?, email = ?, role = ?, auth0_user_id = ?, auth0_account_active = active, auth0_authorized_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
					: 'UPDATE people SET name = ?, email = ?, role = ?, neon_auth_user_id = ?::uuid, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(fields.name, fields.email, fields.role, accountId, id),
				prepareAudit({ ...auditRequestMeta(event), db, action: 'person.update', entityType: 'person', entityId: id, summary: `更新人员与账号：${fields.name}`, before, after: { ...before, name: fields.name, email: fields.email, role: fields.role, accountEnabled: fields.accountEnabled } })
			]);
		} catch (error) {
			if (created && accountId) await removeManagedUser(event, accountId).catch(() => null);
			return fail(409, { message: constraintMessage(error) });
		}
		return await peopleSuccess(
			`已更新 ${fields.name} 的人员、角色与 统一账号 账号关联`,
			{ personId: id, refreshIdentity: event.locals.financingUser?.personId === id }
		);
	},

	togglePerson: async (event) => {
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '').trim();
		const active = String(data.get('active') ?? '') === '1';
		const db = getDatabase();
		const before = await identityState(db, id);
		if (!before) return fail(404, { message: '未找到该人员' });
		if (!active && event.locals.financingUser?.personId === id) return fail(400, { message: '不能停用当前登录人员' });
		if (!active && before.accountRole === 'admin' && await activeAdminCount(db) <= 1) return fail(400, { message: '至少保留一个启用中的管理员账号' });
		try {
			if (before.accountId) await (active ? unbanManagedUser(event, before.accountId) : banManagedUser(event, before.accountId));
			await db.batch([
				db.prepare(usesAuth0() ? 'UPDATE people SET active = ?, auth0_account_active = ?, auth0_authorized_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?' : 'UPDATE people SET active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(...(usesAuth0() ? [active, active, id] : [active, id])),
				prepareAudit({ ...auditRequestMeta(event), db, action: active ? 'person.activate' : 'person.deactivate', entityType: 'person', entityId: id, summary: `${active ? '启用' : '停用'}人员与账号：${before.name}`, before, after: { ...before, active, accountActive: before.accountId ? active : null } })
			]);
		} catch (error) {
			return fail(409, { message: constraintMessage(error) });
		}
		return await peopleSuccess(
			active ? '人员与 统一账号 登录已启用' : '人员与 统一账号 登录已停用',
			{ personId: id }
		);
	},

	deletePerson: async (event) => {
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '').trim();
		const db = getDatabase();
		const before = await identityState(db, id);
		if (!before) return fail(404, { message: '未找到该人员' });
		if (event.locals.financingUser?.personId === id) return fail(400, { message: '不能删除当前登录人员' });
		if (before.accountRole === 'admin' && await activeAdminCount(db) <= 1) return fail(400, { message: '至少保留一个启用中的管理员账号' });
		try {
			if (before.accountId) await removeManagedUser(event, before.accountId);
			await db.batch([
				prepareAudit({ ...auditRequestMeta(event), db, action: 'person.delete', entityType: 'person', entityId: id, summary: `删除人员及关联账号：${before.name}`, before }),
				db.prepare('DELETE FROM people WHERE id = ?').bind(id)
			]);
		} catch (error) {
			return fail(409, { message: constraintMessage(error) });
		}
		return await peopleSuccess(`已删除 ${before.name} 及其 统一账号 登录权限`, { deletedPersonId: id });
	},

	saveRolePermissions: async (event) => {
		if (!hasPermission(event.locals.permissions, 'permission_manage')) {
			return fail(403, { message: '当前角色无权调整角色权限' });
		}
		const data = await event.request.formData();
		const role = String(data.get('role') ?? '').trim();
		const permissions = [...new Set(data.getAll('permissions').map(String))];
		if (!validRoles.has(role) || permissions.some((permission) => !isPermissionCode(permission))) {
			return fail(400, { message: '角色或权限类型无效，请刷新页面后重试' });
		}

		const db = getDatabase();
		const roleName = roleLabel(role);
		const before = await getRolePermissionMatrix(db);
		if (!permissions.includes('permission_manage')) {
			const managerAccount = accountSql('person', 'account');
			const managerRoles = Object.entries(before).filter(([key, codes]) => key !== role && (codes as string[]).includes('permission_manage')).map(([key]) => key);
			const alternativeManager = await db.prepare(`
				SELECT 1
				FROM people person
				${usesAuth0() ? '' : 'LEFT JOIN neon_auth."user" account ON account.id = person.neon_auth_user_id'}
				WHERE person.role = ANY(?::text[])
					AND person.active = TRUE
					AND ${managerAccount.id} IS NOT NULL AND ${managerAccount.active}
				LIMIT 1
			`).get(managerRoles);
			if (!alternativeManager) {
				return fail(400, { message: '至少保留一个有启用登录账号的角色维护权限配置' });
			}
		}

		if (usesAuth0()) await auth0Client(event).saveRolePermissions(role, permissions);
		await db.batch([
			db.prepare(`
				UPDATE role_permissions
				SET granted = (permission_code = ANY(?::text[])),
					updated_by_person_id = ?, updated_at = CURRENT_TIMESTAMP
				WHERE role = ?
			`).bind(permissions, event.locals.financingUser?.personId ?? null, role),
			prepareAudit({
				...auditRequestMeta(event), db,
				action: 'role_permission.update', entityType: 'role_permission', entityId: role,
				summary: `更新角色权限：${roleName}`,
				before: { role, permissions: before[role] ?? [] },
				after: { role, permissions }
			})
		]);
		const confirmed = await getRolePermissionMatrix(db);
		return {
			success: true,
			message: `${roleName}权限已保存`,
			rolePermissions: { role, permissions: confirmed[role] ?? [] }
		};
	}
};
