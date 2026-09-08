export interface SiteAuthorization {
  name: string;
  roles: import('./server/auth0-directory').Auth0Role[];
  permissions: string[];
  mode: import('./permissions').AuthorizationMode;
  picture: string;
}

/** One verified site identity and one application authorization result. */
export interface SiteIdentity {
  readonly id: string;
  readonly email: string;
  readonly auth0Id: string | null;
  readonly issuedAt: number;
  readonly expiresAt: number;
  authorization?: SiteAuthorization;
}

/** Project business responsibility uses the Auth0 ID directly; this is a presentation DTO. */
export function financingPersonView(identity: SiteIdentity | null) {
  if (!identity?.authorization || !identity.auth0Id) return null;
  return { id: identity.auth0Id, personId: identity.auth0Id, email: identity.email,
    personName: identity.authorization.name, roles: identity.authorization.roles,
    role: identity.authorization.roles.map((role) => role.name).join('、'),
    picture: identity.authorization.picture };
}

/** Authentication metadata and business authorization remain server-side. */
export function publicIdentity(identity: SiteIdentity | null) {
  return identity ? { id: identity.id, email: identity.email, auth0Id: identity.auth0Id } : null;
}
