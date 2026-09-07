/// <reference path="../worker-configuration.d.ts" />

declare global {
  namespace App {
    interface Locals {
      user: { id: string; email: string } | null;
    }
    interface Platform {
      env: Env;
      context: ExecutionContext;
      caches: CacheStorage & { default: Cache };
    }
  }
}

export {};
