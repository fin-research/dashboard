/// <reference path="../worker-configuration.d.ts" />

declare global {
  namespace App {
    interface Locals {
      user: import('$lib/identity').SiteIdentity | null;
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
