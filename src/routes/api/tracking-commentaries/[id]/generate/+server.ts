import { generateTrackingSchema } from "$lib/tracking-commentary";
import { generateTrackingCommentary } from "$lib/server/tracking-commentary-generation";
import { getTrackingCommentary } from "$lib/server/tracking-commentary-repository";
import { validateSameOrigin } from "$lib/server/bond-ledger";
import { requireTrackingEnv, trackingError, trackingHeaders } from "$lib/server/tracking-commentary-http";
import type { RequestHandler } from "./$types";
export const POST: RequestHandler = async ({ platform, params, request }) => {
  try {
    validateSameOrigin(request);
    const env = requireTrackingEnv(platform), input = generateTrackingSchema.parse(await request.json());
    await getTrackingCommentary(env.DB, params.id);
    const encoder = new TextEncoder(); let closed = false;
    const cancelled = new AbortController();
    const signal = AbortSignal.any([request.signal, cancelled.signal]);
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        function send(value: unknown) { if (!closed) controller.enqueue(encoder.encode(JSON.stringify(value) + "\n")); }
        const heartbeat = setInterval(() => send({ type: "heartbeat" }), 15000);
        try {
          send({ type: "progress", message: "开始检索" });
          const commentary = await generateTrackingCommentary(env, params.id, input, message => send({ type: "progress", message }), signal);
          send({ type: "complete", commentary });
        } catch (error) { send({ type: "error", ...(await trackingError(error).json() as { error: string }) }); }
        finally { clearInterval(heartbeat); if (!closed) { closed = true; controller.close(); } }
      },
      cancel() { closed = true; cancelled.abort(); },
    });
    return new Response(body, { headers: { ...trackingHeaders, "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no", "Content-Type": "application/x-ndjson; charset=utf-8", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return trackingError(error); }
};
