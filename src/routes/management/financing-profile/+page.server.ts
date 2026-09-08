import { fail } from '@sveltejs/kit';
import type { Actions } from './$types';
import { getDatabase } from '$lib/server/financing/db.js';
import {
	changeCurrentPassword,
	NeonAuthApiError,
	updateCurrentAuthProfile
} from '$lib/server/financing/auth.js';
import { auditRequestMeta, prepareAudit, recordAudit } from '$lib/server/financing/audit.js';
import { MIN_PASSWORD_LENGTH } from '$lib/financing/password-policy';
import { usesAuth0 } from '$lib/server/financing/auth-provider.js';
import { requestAuth0PasswordReset } from '$lib/server/financing/auth.js';

const avatarTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const maxAvatarBytes = 512 * 1024;

async function currentProfile(personId: string) {
	return await getDatabase().prepare(`
		SELECT id AS personId, ${usesAuth0() ? 'auth0_user_id' : 'neon_auth_user_id::text'} AS neonAuthUserId,
			name, email, role, avatar_data_url IS NOT NULL AS hasAvatar,
			to_char(updated_at, 'YYYYMMDDHH24MISSUS') AS avatarVersion
		FROM people
		WHERE id = ?
	`).get(personId) as
		| {
				personId: string;
				neonAuthUserId: string | null;
				name: string;
				email: string | null;
				role: string;
				hasAvatar: boolean;
				avatarVersion: string;
		  }
		| undefined;
}

function publicProfile(profile: NonNullable<Awaited<ReturnType<typeof currentProfile>>>) {
	return {
		hasAvatar: Boolean(profile.hasAvatar),
		avatarVersion: profile.avatarVersion,
		name: profile.name,
		email: profile.email,
		role: profile.role
	};
}

function constraintMessage(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	if (message.includes('people.name')) return '该显示姓名已被使用，请更换后重试';
	return '保存失败，请稍后重试';
}

function authMessage(authError: NeonAuthApiError, operation: 'profile' | 'password') {
	if (authError.status === 429) return '操作过于频繁，请稍后重试';
	if (authError.status === 503) return '认证服务暂时不可用，请稍后重试';
	if (authError.status === 401 || authError.status === 403) return '登录已失效，请重新登录';
	return operation === 'password'
		? '当前密码不正确，或新密码不符合认证要求'
		: 'Neon Auth 个人资料更新失败，请稍后重试';
}

export const actions: Actions = {
	updateProfile: async (event) => {
		if (!event.locals.financingUser) return fail(401, { section: 'profile', message: '登录已失效，请重新登录' });
		const before = await currentProfile(event.locals.financingUser.personId);
		if (!before?.neonAuthUserId) return fail(404, { section: 'profile', message: '未找到当前 Neon Auth 账号' });

		const data = await event.request.formData();
		const name = String(data.get('name') ?? '').trim();
		const removeAvatar = data.get('removeAvatar') === '1';
		const avatar = data.get('avatar');
		if (!name || name.length > 50) {
			return fail(400, { section: 'profile', message: '显示姓名不能为空且不得超过 50 个字符' });
		}

		let avatarMode: 'keep' | 'remove' | 'replace' = removeAvatar ? 'remove' : 'keep';
		let avatarDataUrl: string | null = null;
		if (avatar instanceof File && avatar.size > 0) {
			if (!avatarTypes.has(avatar.type)) {
				return fail(400, { section: 'profile', message: '头像仅支持 JPG、PNG 或 WebP 图片' });
			}
			if (avatar.size > maxAvatarBytes) {
				return fail(400, { section: 'profile', message: '头像文件不得超过 512KB' });
			}
			avatarDataUrl = `data:${avatar.type};base64,${Buffer.from(await avatar.arrayBuffer()).toString('base64')}`;
			avatarMode = 'replace';
		}

		try {
			await updateCurrentAuthProfile(event, { name });
		} catch (authError) {
			if (authError instanceof NeonAuthApiError) {
				return fail(authError.status === 503 ? 503 : 400, {
					section: 'profile',
					message: authMessage(authError, 'profile')
				});
			}
			throw authError;
		}

		const db = getDatabase();
		try {
			let storedProfile: { hasAvatar: boolean; avatarVersion: string } | undefined;
			await db.transaction(async (transaction: ReturnType<typeof getDatabase>) => {
				storedProfile = await transaction.prepare(`
					UPDATE people
					SET name = ?,
						avatar_data_url = CASE WHEN ? = 'keep' THEN avatar_data_url ELSE ? END,
						updated_at = CURRENT_TIMESTAMP
					WHERE id = ?
					RETURNING avatar_data_url IS NOT NULL AS hasAvatar,
						to_char(updated_at, 'YYYYMMDDHH24MISSUS') AS avatarVersion
				`).get(name, avatarMode, avatarDataUrl, before.personId) as typeof storedProfile;
				await prepareAudit({
					...auditRequestMeta(event),
					db: transaction,
					action: 'profile.update',
					entityType: 'auth',
					entityId: before.neonAuthUserId,
					summary: `${before.email ?? before.name} 更新个人资料`,
					before: { name: before.name, hasAvatar: before.hasAvatar },
					after: { name, hasAvatar: Boolean(storedProfile?.hasAvatar) }
				}).run();
			});
			return {
				section: 'profile',
				success: true,
				message: '个人资料已更新',
				profile: publicProfile({
					...before,
					name,
					hasAvatar: Boolean(storedProfile?.hasAvatar),
					avatarVersion: storedProfile?.avatarVersion ?? before.avatarVersion
				}),
				refreshIdentity: true
			};
		} catch (databaseError) {
			await updateCurrentAuthProfile(event, { name: before.name }).catch(() => null);
			return fail(409, { section: 'profile', message: constraintMessage(databaseError) });
		}
	},

	updatePassword: async (event) => {
		if (!event.locals.financingUser) return fail(401, { section: 'password', message: '登录已失效，请重新登录' });
		if (usesAuth0()) {
			try {
				await requestAuth0PasswordReset(event);
				return { section: 'password', success: true, message: '密码重置邮件已请求发送，请检查注册邮箱' };
			} catch {
				return fail(503, { section: 'password', message: '密码重置请求失败，请稍后重试' });
			}
		}
		const profile = await currentProfile(event.locals.financingUser.personId);
		if (!profile?.neonAuthUserId) return fail(404, { section: 'password', message: '未找到当前 Neon Auth 账号' });

		const data = await event.request.formData();
		const currentPassword = String(data.get('currentPassword') ?? '');
		const newPassword = String(data.get('newPassword') ?? '');
		const confirmPassword = String(data.get('confirmPassword') ?? '');
		if (newPassword.length < MIN_PASSWORD_LENGTH) {
			return fail(400, { section: 'password', message: `新密码不得少于 ${MIN_PASSWORD_LENGTH} 个字符` });
		}
		if (newPassword !== confirmPassword) {
			return fail(400, { section: 'password', message: '两次输入的新密码不一致' });
		}
		if (newPassword === currentPassword) {
			return fail(400, { section: 'password', message: '新密码不能与当前密码相同' });
		}

		try {
			await changeCurrentPassword(event, currentPassword, newPassword);
		} catch (authError) {
			if (authError instanceof NeonAuthApiError) {
				return fail(authError.status === 503 ? 503 : 400, {
					section: 'password',
					message: authMessage(authError, 'password')
				});
			}
			throw authError;
		}

		try {
			await recordAudit({
				...auditRequestMeta(event),
				action: 'password.update',
				entityType: 'auth',
				entityId: profile.neonAuthUserId,
				summary: `${profile.email ?? profile.name} 修改登录密码`
			});
		} catch (auditError) {
			console.error(JSON.stringify({ event: 'audit_write_failed', action: 'password.update', message: String(auditError) }));
		}
		return { section: 'password', success: true, message: '密码已更新，其他设备上的登录已退出' };
	}
};
