import { z } from "zod";

import { creditInstitutionUpdateSchema } from "$lib/credit/update.ts";
import { BondLedgerUploadError, validateSameOrigin } from "$lib/server/bond-ledger.ts";
import {
  CreditDatabaseError,
  loadCreditReport,
  saveCreditInstitution,
} from "$lib/server/credit-repository.ts";
import { withPostgres } from "$lib/server/postgres.ts";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ platform, url }) => {
  const date = url.searchParams.get("date");
  if (date && !isIsoDate(date)) {
    return Response.json(
      { error: "报表日必须是有效的 YYYY-MM-DD 日期" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const report = await withPostgres(
      platform?.env.HYPERDRIVE?.connectionString,
      "eastmoney-credit-report",
      (client) => loadCreditReport(client, date),
    );
    return Response.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof CreditDatabaseError) {
      return Response.json(
        { error: error.message },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    console.error("credit report query failed", error);
    return Response.json(
      { error: "授信数据暂时不可用" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
};

export const PATCH: RequestHandler = async ({ platform, request }) => {
  try {
    validateSameOrigin(request);
    const input = creditInstitutionUpdateSchema.parse(await request.json());
    const result = await withPostgres(
      platform?.env.HYPERDRIVE?.connectionString,
      "eastmoney-credit-update",
      (client) => saveCreditInstitution(client, input),
    );
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status =
      error instanceof BondLedgerUploadError || error instanceof CreditDatabaseError
        ? error.status
        : error instanceof z.ZodError
          ? 400
          : 503;
    if (status >= 500) console.error("credit update failed", error);
    const message =
      error instanceof BondLedgerUploadError || error instanceof CreditDatabaseError
        ? error.message
        : status === 400
          ? "授信数据格式无效"
          : "授信数据保存失败，请稍后重试";
    return Response.json(
      { error: message },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
};

function isIsoDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}
