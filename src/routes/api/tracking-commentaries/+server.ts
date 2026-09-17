import { z } from "zod";
import { commentaryTypeSchema } from "$lib/policies";
import { createTrackingSchema } from "$lib/tracking-commentary";
import { createTrackingCommentary, listTrackingCommentaries } from "$lib/server/tracking-commentary-repository";
import { validateSameOrigin } from "$lib/server/bond-ledger";
import { requireTrackingEnv, trackingError, trackingHeaders } from "$lib/server/tracking-commentary-http";
import type { RequestHandler } from "./$types";
export const GET: RequestHandler = async ({ platform, url }) => {
  try {
    const query = z.object({ q: z.string().max(240).optional(), type: commentaryTypeSchema.optional(),
      offset: z.coerce.number().int().min(0).max(100000).default(0), policyId: z.string().max(240).optional() }).parse(Object.fromEntries(url.searchParams));
    return Response.json(await listTrackingCommentaries(requireTrackingEnv(platform).DB, query), { headers: trackingHeaders });
  } catch (error) { return trackingError(error); }
};
export const POST: RequestHandler = async ({ platform, request }) => {
  try {
    validateSameOrigin(request);
    const input = createTrackingSchema.parse(await request.json());
    return Response.json(await createTrackingCommentary(requireTrackingEnv(platform).DB, input), { status: 201, headers: trackingHeaders });
  } catch (error) { return trackingError(error); }
};
