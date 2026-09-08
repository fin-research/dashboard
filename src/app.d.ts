/// <reference path="../worker-configuration.d.ts" />

declare global {
  namespace App {
    interface Locals {
      user: { id: string; email: string; auth0Id: string | null } | null;
      financingUser: {
        id: string;
        email: string | null;
        role: 'admin' | 'handler' | 'reviewer';
        personId: string;
        personName: string;
        permissions?: string[];
        hasAvatar: boolean;
        avatarVersion: string;
      } | null;
      database: import('$lib/server/financing/db.js').PostgresDatabase | null;
      dataApiJwt: string | null;
      authCacheStatus: 'hit' | 'miss' | 'bypass';
      permissions: string[];
    }
    interface Platform {
      env: Env;
      context: ExecutionContext;
      caches: CacheStorage & { default: Cache };
    }
  }
}

export {};
