import type { CreditSession } from "../credit-assistant/types.ts";
import { encodeAiSse } from "./ai-sse.ts";

/** Per-DO live subscribers. Only milestones and final answers are persisted. */
export class CreditEventHub {
  private clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private encoder = new TextEncoder();

  private remove(controller: ReadableStreamDefaultController<Uint8Array>) {
    this.clients.delete(controller);
    if (!this.clients.size) { clearInterval(this.heartbeat); this.heartbeat = undefined; }
  }

  private send(event: "progress" | "result", value: unknown) {
    const bytes = encodeAiSse(event, value);
    for (const controller of this.clients) {
      try {
        if ((controller.desiredSize ?? 0) < -16) throw new Error("Slow SSE consumer");
        controller.enqueue(bytes);
      } catch {
        this.remove(controller);
        try { controller.close(); } catch { /* Already disconnected. */ }
      }
    }
  }

  progress(summary: string) {
    if (summary.trim()) this.send("progress", summary.trim());
  }

  result(state: CreditSession) {
    this.send("result", state);
  }

  finish() {
    for (const controller of this.clients) {
      try { controller.close(); } catch { /* Already disconnected. */ }
    }
    this.clients.clear(); clearInterval(this.heartbeat); this.heartbeat = undefined;
  }

  response(state: CreditSession, latestProgress = "", checkAlive?: () => void): Response {
    let client: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start: controller => {
        client = controller;
        controller.enqueue(this.encoder.encode("retry: 2000\n\n"));
        if (!state.running) {
          controller.enqueue(encodeAiSse("result", state));
          controller.close();
          return;
        }
        if (latestProgress.trim()) controller.enqueue(encodeAiSse("progress", latestProgress.trim()));
        this.clients.add(controller);
        this.heartbeat ??= setInterval(() => {
          try { checkAlive?.(); } catch { this.finish(); return; }
          for (const subscriber of this.clients) {
            try {
              if ((subscriber.desiredSize ?? 0) < -16) throw new Error("Slow SSE consumer");
              subscriber.enqueue(this.encoder.encode(": keep-alive\n\n"));
            }
            catch { this.remove(subscriber); }
          }
        }, 20_000);
      },
      cancel: () => this.remove(client),
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "private, no-store, no-transform", "x-content-type-options": "nosniff", "x-accel-buffering": "no" } });
  }
}
