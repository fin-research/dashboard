export interface FinancingAuthorization {
  personId: string;
  personName: string;
  role: 'admin' | 'handler' | 'reviewer';
  permissions: string[];
  hasAvatar: boolean;
  avatarVersion: string;
}

/** One verified site identity, with business authorization loaded only when needed. */
export interface SiteIdentity {
  readonly id: string;
  readonly email: string;
  readonly auth0Id: string | null;
  readonly issuedAt: number;
  readonly expiresAt: number;
  financing?: FinancingAuthorization;
}

/** Keep the existing financing page/audit DTO without creating another identity. */
export function financingPersonView(identity: SiteIdentity | null) {
  if (!identity?.financing || !identity.auth0Id) return null;
  return { ...identity.financing, id: identity.auth0Id, email: identity.email };
}

/** Authentication metadata and business authorization remain server-side. */
export function publicIdentity(identity: SiteIdentity | null) {
  return identity ? { id: identity.id, email: identity.email, auth0Id: identity.auth0Id } : null;
}
