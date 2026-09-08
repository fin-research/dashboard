import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostgresDatabase } from '../../src/lib/financing/postgres.js';

test('role permission queries are qualified into the financing schema', async () => {
	const database = createPostgresDatabase('postgres://unused:unused@localhost/unused');
	let executedSql = '';
	database.client = {
		connect: async () => {},
		query: async (sql) => {
			executedSql = sql;
			return { rows: [], rowCount: 0 };
		},
		end: async () => {}
	};

	try {
		await database.prepare(`
			SELECT permission_code AS permissionCode
			FROM role_permissions
			WHERE role = ?
		`).all('admin');
		assert.match(executedSql, /FROM financing\.role_permissions/);
	} finally {
		await database.close();
	}
});
