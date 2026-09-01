import { z } from "zod";

import { commentaryContentSchema } from "$lib/policies";
import { BondLedgerUploadError, validateSameOrigin } from "$lib/server/bond-ledger";
import {
  generatePolicyCommentary,
  PolicyCommentaryError,
} from "$lib/server/policy-commentary";
import {
  PolicyRepositoryError,
  saveEditedCommentary,
} from "$lib/server/policy-repository";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ request, params, platform, url }) => {
  try {
    validateSameOrigin(request);
    const env = platform?.env;
    if (!env?.DB || !env.CLOUDFLARE_ACCOUNT_ID || !env.AI_GATEWAY_ID || !env.CF_AIG_TOKEN) {
      throw new PolicyCommentaryError(503, "D1 或 AI Gateway 配置未完成");
    }
    const commentary = await generatePolicyCommentary(env, params.id);
    return Response.json(commentary, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error, "政策点评生成失败，请稍后重试", url.pathname, params.id);
  }
};

export const PUT: RequestHandler = async ({ request, params, platform, url }) => {
  try {
    validateSameOrigin(request);
    if (!platform?.env.DB) throw new PolicyRepositoryError(503, "D1 未配置");
    const content = commentaryContentSchema.parse(await request.json());
    const commentary = await saveEditedCommentary(platform.env.DB, params.id, content);
    return Response.json(commentary, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "政策点评保存失败，请稍后重试", url.pathname, params.id);
  }
};

function errorResponse(
  error: unknown,
  fallback: string,
  path: string,
  policyId: string,
): Response {
  const status =
    error instanceof BondLedgerUploadError ||
    error instanceof PolicyRepositoryError ||
    error instanceof PolicyCommentaryError
      ? error.status
      : error instanceof z.ZodError
        ? 400
        : 500;
  const message =
    error instanceof BondLedgerUploadError ||
    error instanceof PolicyRepositoryError ||
    error instanceof PolicyCommentaryError
      ? error.message
      : status === 400
        ? "政策点评内容无效"
        : fallback;
  console.error(JSON.stringify({
    event: "policy_commentary_failed",
    status,
    path,
    policy_id: policyId,
    error: error instanceof Error ? error.message : String(error),
  }));
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}
