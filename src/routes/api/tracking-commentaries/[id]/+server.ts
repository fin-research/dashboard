import { updateTrackingSchema } from "$lib/tracking-commentary";
import { getTrackingCommentary, updateTrackingCommentary } from "$lib/server/tracking-commentary-repository";
import { validateSameOrigin } from "$lib/server/bond-ledger";
import { requireTrackingEnv, trackingError, trackingHeaders } from "$lib/server/tracking-commentary-http";
import type { RequestHandler } from "./$types";
export const GET: RequestHandler = async ({ platform, params }) => {
  try { return Response.json(await getTrackingCommentary(requireTrackingEnv(platform).DB, params.id), { headers: trackingHeaders }); }
  catch (error) { return trackingError(error); }
};
export const PUT: RequestHandler = async ({ platform, params, request }) => {
  try {
    validateSameOrigin(request);
    const { updatedAt, ...input } = updateTrackingSchema.parse(await request.json());
    return Response.json(await updateTrackingCommentary(requireTrackingEnv(platform).DB, params.id, input, updatedAt), { headers: trackingHeaders });
  } catch (error) { return trackingError(error); }
};
