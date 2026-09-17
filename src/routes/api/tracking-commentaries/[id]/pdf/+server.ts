import { z } from "zod";
import { validateSameOrigin } from "$lib/server/bond-ledger";
import { requireTrackingEnv, trackingError, trackingHeaders } from "$lib/server/tracking-commentary-http";
import { archiveCommentaryPdf, downloadCommentaryPdf } from "$lib/server/tracking-commentary-pdf";
import type { RequestHandler } from "./$types";
export const GET: RequestHandler = async ({ platform, params }) => {
  try { return await downloadCommentaryPdf(requireTrackingEnv(platform),params.id); }
  catch(error) { return trackingError(error); }
};
export const POST: RequestHandler = async ({ platform, params, request }) => {
  try {
    validateSameOrigin(request);
    const { updatedAt } = z.object({updatedAt:z.string().min(1).max(80)}).strict().parse(await request.json());
    return Response.json(await archiveCommentaryPdf(requireTrackingEnv(platform),params.id,updatedAt),{headers:trackingHeaders});
  } catch(error) { return trackingError(error); }
};
