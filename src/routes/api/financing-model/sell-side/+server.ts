import { z } from "zod";

import { BondLedgerUploadError, validateSameOrigin } from "$lib/server/bond-ledger";
import {
  FinancingModelDatabaseError,
  loadFinancingModelReport,
  saveSellSideSnapshot,
} from "$lib/server/financing-model-repository";
import {
  FinancingModelResearchError,
  generateFinancingModelResearch,
} from "$lib/server/financing-model-research";
import { withPostgres } from "$lib/server/postgres";
import type { RequestHandler } from "./$types";

const requestSchema = z.object({ runId: z.string().uuid() }).strict();

export const POST: RequestHandler = async ({ request, platform, url }) => {
  try {
    validateSameOrigin(request);
    const { runId } = requestSchema.parse(await request.json());
    const env = platform?.env;
    if (
      !env?.CLOUDFLARE_ACCOUNT_ID ||
      !env.AI_GATEWAY_ID ||
      !env.CF_AIG_TOKEN
    ) {
      throw new FinancingModelResearchError(503, "AI Gateway 配置未完成");
    }
    const report = await withPostgres(
      env.HYPERDRIVE?.connectionString,
      "eastmoney-financing-model-research-read",
      (client) => loadFinancingModelReport(client, runId),
    );
    const research = await generateFinancingModelResearch(
      report.snapshot,
      {
        accountId: env.CLOUDFLARE_ACCOUNT_ID,
        gatewayId: env.AI_GATEWAY_ID || "default",
        token: env.CF_AIG_TOKEN,
      },
    );
    const saved = await withPostgres(
      env.HYPERDRIVE?.connectionString,
      "eastmoney-financing-model-research-save",
      (client) => saveSellSideSnapshot(client, report.snapshot, research),
    );
    return Response.json(saved, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const status =
      error instanceof BondLedgerUploadError ||
      error instanceof FinancingModelDatabaseError ||
      error instanceof FinancingModelResearchError
        ? error.status
        : error instanceof z.ZodError
          ? 400
          : 500;
    console.error(
      JSON.stringify({
        event: "financing_model_sell_side_failed",
        status,
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return Response.json(
      {
        error:
          error instanceof BondLedgerUploadError ||
          error instanceof FinancingModelDatabaseError ||
          error instanceof FinancingModelResearchError
            ? error.message
            : status === 400
              ? "卖方观点请求无效"
              : "卖方观点生成失败，请稍后重试",
      },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
};
