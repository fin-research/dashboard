import { financingPersonView } from '$lib/identity';
import type { LayoutServerLoad } from './$types';
import { getLayoutData } from '$lib/server/financing/queries.js';
import { usesAuth0 } from '$lib/server/financing/auth-provider.js';

export const load: LayoutServerLoad = async ({ locals, depends }) => {
	depends('financing:identity', 'financing:permissions', 'financing:reminders');
	const todayIso = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
	}).format(new Date());
	const reminderEnd = new Date(Date.parse(`${todayIso}T00:00:00Z`) + 7 * 86_400_000)
		.toISOString()
		.slice(0, 10);
	const layout = locals.user?.financing
		? await getLayoutData({
				today: todayIso,
				toDate: reminderEnd,
				personId: locals.user.financing.personId,
				ownOnly: false
			})
		: { reminders: { items: [], total: 0 } };
	return {
		auth0: usesAuth0(),
		user: financingPersonView(locals.user),
		permissions: locals.permissions,
		reminders: layout.reminders
	};
};
