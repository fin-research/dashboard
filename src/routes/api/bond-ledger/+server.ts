import {
  archiveBondLedgerRequest,
  BondLedgerUploadError,
  deleteBondLedgerFile,
  getBondLedgerFile,
  ledgerDownloadHeaders,
  listBondLedgerFiles,
} from "$lib/server/bond-ledger";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ platform, url }) => {
  try {
    const date = url.searchParams.get("date");
    if (date) {
      const object = await getBondLedgerFile(platform?.env.BOND_LEDGER, date);
      return new Response(object.body as BodyInit, {
        headers: ledgerDownloadHeaders(object),
      });
    }
    return Response.json(await listBondLedgerFiles(platform?.env.BOND_LEDGER), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error, url, "read");
  }
};

export const POST: RequestHandler = async ({ request, platform, url }) => {
  try {
    const result = await archiveBondLedgerRequest(
      request,
      platform?.env.BOND_LEDGER,
    );
    return Response.json(result, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error, url, "upload");
  }
};

export const DELETE: RequestHandler = async ({ request, platform, url }) => {
  try {
    const date = url.searchParams.get("date") ?? "";
    await deleteBondLedgerFile(request, platform?.env.BOND_LEDGER, date);
    return Response.json(
      { deleted: true, date },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error, url, "delete");
  }
};

function errorResponse(error: unknown, url: URL, action: string): Response {
  const status = error instanceof BondLedgerUploadError ? error.status : 500;
  console.error(
    JSON.stringify({
      event: `bond_ledger_${action}_failed`,
      status,
      path: url.pathname,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  return Response.json(
    {
      error:
        error instanceof BondLedgerUploadError
          ? error.message
          : "台账管理失败，请稍后重试",
    },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
