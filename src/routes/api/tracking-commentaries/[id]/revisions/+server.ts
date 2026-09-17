import { trackingRevisions } from "$lib/server/tracking-commentary-repository";
import { requireTrackingEnv, trackingError, trackingHeaders } from "$lib/server/tracking-commentary-http";
import type { RequestHandler } from "./$types";
export const GET: RequestHandler = async ({ platform, params }) => {
  try { return Response.json({ revisions: await trackingRevisions(requireTrackingEnv(platform).DB, params.id) }, { headers: trackingHeaders }); }
  catch (error) { return trackingError(error); }
};
