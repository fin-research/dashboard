import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey, type JWTPayload } from 'jose';

export interface AccessConfig {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

export class AccessError extends Error {
  readonly status: 401 | 403 | 503;
  constructor(status: 401 | 403 | 503, message: string) {
    super(message);
    this.status = status;
  }
}

// Only public signing keys are cached; user sessions are never stored globally.
const keySets = new Map<string, JWTVerifyGetKey>();

export function accessToken(request: Request): string | null {
  const assertion = request.headers.get('Cf-Access-Jwt-Assertion');
  if (assertion) return assertion;
  const values = (request.headers.get('Cookie') ?? '').split(';')
    .map((part) => part.trim()).filter((part) => part.startsWith('CF_Authorization='));
  if (values.length !== 1) return null;
  return values[0]!.slice('CF_Authorization='.length) || null;
}

export function accessIssuer(config: AccessConfig): string {
  const domain = config.ACCESS_TEAM_DOMAIN?.trim().replace(/^https:\/\//, '').replace(/\/$/, '');
  if (!domain || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain) || !config.ACCESS_AUD?.trim()) {
    throw new AccessError(503, '身份服务尚未配置完成');
  }
  return `https://${domain}`;
}

export async function verifyAccess(
  request: Request,
  config: AccessConfig,
  keys?: JWTVerifyGetKey,
): Promise<JWTPayload> {
  const issuer = accessIssuer(config);
  const token = accessToken(request);
  if (!token || token.length > 16384) throw new AccessError(401, '请先登录');
  let keySet = keys ?? keySets.get(issuer);
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), { timeoutDuration: 5000 });
    // Configuration comes from the deployment, never from an incoming JWT.
    if (keySets.size >= 4) keySets.clear();
    keySets.set(issuer, keySet);
  }
  try {
    const { payload } = await jwtVerify(token, keySet, {
      issuer,
      audience: config.ACCESS_AUD!.split(',').map((aud) => aud.trim()).filter(Boolean),
      algorithms: ['RS256'],
      requiredClaims: ['iss', 'aud', 'exp', 'iat', 'type'],
      clockTolerance: 5,
    });
    if (payload.type !== 'app') throw new AccessError(401, '登录凭证无效');
    return payload;
  } catch (error) {
    if (error instanceof AccessError) throw error;
    const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
    if (code === 'ERR_JWKS_TIMEOUT' || error instanceof TypeError) {
      throw new AccessError(503, '身份服务暂时不可用');
    }
    throw new AccessError(401, '登录已失效，请重新登录');
  }
}

export function requireHuman(payload: JWTPayload): { id: string; email: string } {
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (!payload.sub || !/^[^@\s]+@18\.cn$/.test(email)) {
    throw new AccessError(403, '请使用 18.cn 邮箱登录');
  }
  return { id: payload.sub, email };
}

export function accessFailure(error: unknown): Response {
  const failure = error instanceof AccessError ? error : new AccessError(503, '身份服务暂时不可用');
  return Response.json({ detail: failure.message, code: failure.status === 401 ? 'LOGIN_REQUIRED' : 'ACCESS_DENIED', loginUrl: '/auth/login' }, {
    status: failure.status,
    headers: { 'Cache-Control': 'no-store, private', Vary: 'Cookie, Cf-Access-Jwt-Assertion' },
  });
}
