// @ts-nocheck
import { auth0Client, usesAuth0 } from './auth-provider.js';
import { PERMISSION_CODES } from '../../financing/permissions.js';
import { getDatabase } from './db.js';

function undefinedRolePermissionsTable(error) {
	return error?.code === '42P01' || String(error?.message ?? error).includes('relation "role_permissions" does not exist');
}

function defaultRolePermissionMatrix() {
	return {
		admin: [...PERMISSION_CODES],
		handler: [...PERMISSION_CODES],
		reviewer: [...PERMISSION_CODES]
	};
}

export async function getRolePermissionCodes(role, database = getDatabase()) {
	if (!role) return [];
	try {
		const rows = await database.prepare(`
			SELECT permission_code AS permissionCode
			FROM role_permissions
			WHERE role = ? AND granted = TRUE
			ORDER BY permission_code
		`).all(role);
		return rows.map(({ permissionCode }) => permissionCode);
	} catch (error) {
		if (undefinedRolePermissionsTable(error)) return [...PERMISSION_CODES];
		throw error;
	}
}

export async function getRolePermissionMatrix(database = getDatabase()) {
	if (usesAuth0()) {
		const client = auth0Client();
		return Object.fromEntries(await Promise.all(['admin', 'handler', 'reviewer'].map(async (role) => [role, await client.rolePermissions(role)])));
	}
	try {
		const rows = await database.prepare(`
			SELECT role, permission_code AS permissionCode
			FROM role_permissions
			WHERE granted = TRUE
			ORDER BY role, permission_code
		`).all();
		return rows.reduce((matrix, { role, permissionCode }) => {
			(matrix[role] ??= []).push(permissionCode);
			return matrix;
		}, { admin: [], handler: [], reviewer: [] });
	} catch (error) {
		if (undefinedRolePermissionsTable(error)) return defaultRolePermissionMatrix();
		throw error;
	}
}
