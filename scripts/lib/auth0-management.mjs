import { spawnSync } from 'node:child_process';

export const AUTH0_DOMAIN = 'hasbai.eu.auth0.com';
export const LOGIN_ACTION_ID = '0b72438c-33ff-4321-b6c7-74b7d021e6a3';

// Capture output in memory: Auth0 responses can contain client secrets.
export function management(method, path, body) {
  const result = spawnSync('auth0', ['api', method, path, '--tenant', AUTH0_DOMAIN, '--no-input'], {
    input: body === undefined ? undefined : JSON.stringify(body), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
  let data;
  try { data = result.stdout?.trim() ? JSON.parse(result.stdout) : null; }
  catch { throw new Error(`Auth0 ${method} ${path.split('?')[0]} returned invalid JSON`); }
  if (result.status !== 0 || data?.statusCode >= 400 || (!data && method === 'get')) {
    const status = data?.statusCode ?? Number(result.stderr?.match(/\b([45]\d\d): API request failed/)?.[1] || 0);
    const error = new Error(`Auth0 ${method} ${path.split('?')[0]} failed${status ? ` (${status})` : ''}; check management authorization`);
    error.status = status;
    throw error;
  }
  return data;
}
