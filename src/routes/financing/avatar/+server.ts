import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDatabase } from '$lib/server/financing/db.js';

const AVATAR_DATA = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

export const GET: RequestHandler = async ({ locals, request }) => {
	if (!locals.user?.financing) throw error(401, '登录已失效');
	if (!locals.user.financing.hasAvatar) throw error(404, '未设置头像');

	const etag = `"avatar-${locals.user.financing.personId}-${locals.user.financing.avatarVersion}"`;
	if (request.headers.get('if-none-match') === etag) {
		return new Response(null, {
			status: 304,
			headers: { ETag: etag, 'Cache-Control': 'private, max-age=31536000, immutable' }
		});
	}

	const row = await getDatabase().prepare(`
		SELECT avatar_data_url AS avatarDataUrl
		FROM people WHERE id = ? AND active = TRUE
	`).get(locals.user.financing.personId) as { avatarDataUrl?: string } | undefined;
	const match = String(row?.avatarDataUrl ?? '').match(AVATAR_DATA);
	if (!match?.[1] || !match[2]) throw error(404, '未设置头像');
	const body = Buffer.from(match[2], 'base64');
	return new Response(new Uint8Array(body), {
		headers: {
			'Content-Type': match[1],
			'Content-Length': String(body.byteLength),
			'Cache-Control': 'private, max-age=31536000, immutable',
			ETag: etag,
			'X-Content-Type-Options': 'nosniff'
		}
	});
};
