// @ts-nocheck
import { env } from '$env/dynamic/private';
import { dataApiUrlFromAuthUrl } from '../../financing/neon-urls.js';

export function getDataApiUrl() {
	const configured = env.NEON_DATA_API_URL?.trim();
	if (configured) {
		const url = new URL(configured);
		if (url.protocol !== 'https:') throw new Error('NEON_DATA_API_URL must use HTTPS');
		return url.toString().replace(/\/$/, '');
	}
	const derived = dataApiUrlFromAuthUrl(env.NEON_AUTH_URL);
	if (!derived) throw new Error('Neon Data API URL is unavailable');
	return derived;
}
