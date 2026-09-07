/// <reference path="../worker-configuration.d.ts" />

declare global {
  namespace App {
    interface Locals {
      user: { id: string; email: string; auth0Id: string | null } | null;
    }
    interface Platform {
      env: Env;
      context: ExecutionContext;
      caches: CacheStorage & { default: Cache };
    }
  }
}

export {};
