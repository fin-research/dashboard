import { z } from "zod";
import { PolicyRepositoryError } from "./policy-repository.ts";
import { BondLedgerUploadError } from "./bond-ledger.ts";
export const trackingHeaders = { "Cache-Control": "no-store" };
export function trackingError(error: unknown): Response {
  const known = error instanceof PolicyRepositoryError || error instanceof BondLedgerUploadError;
  const status = known ? error.status : error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 500;
  return Response.json({ error: known ? error.message : status === 400 ? "请检查主题、日期与点评内容" : "跟踪点评操作失败，请稍后重试" }, { status, headers: trackingHeaders });
}
export function requireTrackingEnv(platform: App.Platform | undefined): Env {
  if (!platform?.env?.DB) throw new PolicyRepositoryError(503, "D1 尚未配置");
  return platform.env;
}
