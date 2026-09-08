import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDatabase } from '$lib/server/financing/db.js';

const AVATAR_DATA = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

export const GET: RequestHandler = async ({ locals, request }) => {
	if (!locals.financingUser) throw error(401, '登录已失效');
	if (!locals.financingUser.hasAvatar) throw error(404, '未设置头像');

	const etag = `"avatar-${locals.financingUser.personId}-${locals.financingUser.avatarVersion}"`;
	if (request.headers.get('if-none-match') === etag) {
		return new Response(null, {
			status: 304,
			headers: { ETag: etag, 'Cache-Control': 'private, max-age=31536000, immutable' }
		});
	}

	const row = await getDatabase().prepare(`
		SELECT avatar_data_url AS avatarDataUrl
		FROM people WHERE id = ? AND active = TRUE
	`).get(locals.financingUser.personId) as { avatarDataUrl?: string } | undefined;
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
