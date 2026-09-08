import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { withBase } from '$lib/financing/app-paths';
import { deleteSession, SESSION_COOKIE } from '$lib/server/financing/auth.js';
import { auditRequestMeta, recordAudit } from '$lib/server/financing/audit.js';
import { usesAuth0 } from '$lib/server/financing/auth-provider.js';

export const actions: Actions = {
	default: async (event) => {
		const user = event.locals.financingUser;
		const token = event.cookies.get(SESSION_COOKIE);
		if (user) {
			await recordAudit({
				...auditRequestMeta(event),
				action: 'logout',
				entityType: 'auth',
				entityId: user.id,
				summary: `${user.email ?? user.personName} 退出系统`
			});
		}
		await deleteSession(event, token);
		if (usesAuth0()) throw redirect(303, '/auth/logout');
		throw redirect(303, withBase('/login'));
	}
};
