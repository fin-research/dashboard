const PRIVATE_PAGES = ['/profile', '/trading-research', '/credit-assistant'];
const PRIVATE_APIS = ['/api/profile', '/api/credit-assistant', '/api/credit', '/api/economic-indicators'];

function matches(path: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function pageRequiresLogin(path: string): boolean {
  try { return matches(decodeURIComponent(path), PRIVATE_PAGES); }
  catch { return true; }
}

export function apiRequiresLogin(path: string): boolean {
  return matches(path, PRIVATE_APIS);
}

export function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n]/.test(value)) return '/';
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith('//') || /[\\\r\n]/.test(decoded)) return '/';
    const normalized = new URL(decoded, 'https://eastmoney.hasbai.xyz');
    if (/^\/(auth|cdn-cgi)(\/|$)/.test(normalized.pathname)) return '/';
  } catch { return '/'; }
  const target = new URL(value, 'https://eastmoney.hasbai.xyz');
  if (target.origin !== 'https://eastmoney.hasbai.xyz') return '/';
  return target.pathname + target.search + target.hash;
}

export function loginUrl(returnTo: string): string {
  return `/auth/login?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`;
}
