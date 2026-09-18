import { generateTrackingSchema } from "$lib/tracking-commentary";
import { generateTrackingCommentary } from "$lib/server/tracking-commentary-generation";
import { getTrackingCommentary } from "$lib/server/tracking-commentary-repository";
import { validateSameOrigin } from "$lib/server/bond-ledger";
import { requireTrackingEnv, trackingError } from "$lib/server/tracking-commentary-http";
import { PolicyRepositoryError } from "$lib/server/policy-repository";
import { createAiSseResponse } from "$lib/server/ai-sse";
import type { RequestHandler } from "./$types";
export const POST: RequestHandler = async ({ platform, params, request }) => {
  try {
    validateSameOrigin(request);
    const env = requireTrackingEnv(platform), input = generateTrackingSchema.parse(await request.json());
    await getTrackingCommentary(env.DB, params.id);
    return createAiSseResponse(
      request,
      ({ signal, progress }) => generateTrackingCommentary(env, params.id, input, () => {}, signal, progress),
      {
        errorMessage: (error) => error instanceof PolicyRepositoryError && error.status < 500
          ? error.message
          : "点评生成失败，请稍后重试",
        onError: (error) => console.error(JSON.stringify({
          event: "tracking_commentary_generation_failed",
          commentary_id: params.id,
          error: error instanceof Error ? error.message : String(error),
        })),
      },
    );
  } catch (error) { return trackingError(error); }
};
