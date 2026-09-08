// @ts-nocheck
import { env } from '$env/dynamic/private';
import { getRequestEvent } from '$app/server';
import { createAuth0ManagementClient } from './auth0-client.js';
import { getDatabase } from './db.js';
import { NeonAuthApiError } from './neon-auth-client.js';

export function usesAuth0() {
  if (providerConfig().AUTH_PROVIDER !== 'auth0-access') throw new NeonAuthApiError(503, '统一身份服务未配置', 'AUTH0_UNAVAILABLE');
  return true;
}

export function auth0Client(event = getRequestEvent()) {
  const config = event.platform?.env ?? env;
  event.locals.auth0Management ??= createAuth0ManagementClient({
    domain: config.AUTH0_DOMAIN, clientId: config.AUTH0_MANAGEMENT_CLIENT_ID,
    clientSecret: config.AUTH0_MANAGEMENT_CLIENT_SECRET,
    roleIds: JSON.parse(config.AUTH0_ROLE_IDS || '{}'), fetchImpl: event.fetch,
  });
  return event.locals.auth0Management;
}

export function providerConfig() { return getRequestEvent().platform?.env ?? env; }

export async function refreshAuth0People(event = getRequestEvent()) {
  if (!usesAuth0() || event.locals.auth0DirectoryRefreshed) return;
  const identities = await auth0Client(event).directory();
  await getDatabase(event).prepare(`
    WITH identities AS (
      SELECT * FROM jsonb_to_recordset(?::jsonb) AS identity(id text, role text, active boolean)
    )
    UPDATE people person SET role = COALESCE(identity.role, person.role),
      auth0_account_active = identity.active, auth0_authorized_until = NULL,
      auth0_permissions = '{}'::text[]
    FROM identities identity WHERE person.auth0_user_id = identity.id
      AND (person.role IS DISTINCT FROM COALESCE(identity.role, person.role)
        OR person.auth0_account_active IS DISTINCT FROM identity.active)
  `).run(JSON.stringify(identities));
  event.locals.auth0DirectoryRefreshed = true;
}

export function accountSql(alias = 'p', legacyAlias = 'u') {
  return usesAuth0()
    ? { id: `${alias}.auth0_user_id`, active: `${alias}.auth0_account_active`, role: `${alias}.role` }
    : { id: `${legacyAlias}.id::text`, active: `NOT COALESCE(${legacyAlias}.banned, FALSE)`, role: `${legacyAlias}.role` };
}
