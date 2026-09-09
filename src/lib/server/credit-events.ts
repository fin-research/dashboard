import type { CreditSession } from "../credit-assistant/types.ts";

/** Per-DO live subscribers. Only milestones and final answers are persisted. */
export class CreditEventHub {
  private clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private encoder = new TextEncoder();

  private remove(controller: ReadableStreamDefaultController<Uint8Array>) {
    this.clients.delete(controller);
    if (!this.clients.size) { clearInterval(this.heartbeat); this.heartbeat = undefined; }
  }

  send(event: "session" | "draft", value: unknown) {
    const bytes = this.encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
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

  finish() {
    for (const controller of this.clients) {
      try { controller.close(); } catch { /* Already disconnected. */ }
    }
    this.clients.clear(); clearInterval(this.heartbeat); this.heartbeat = undefined;
  }

  response(state: CreditSession): Response {
    let client: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start: controller => {
        client = controller;
        controller.enqueue(this.encoder.encode(`retry: 2000\nevent: session\ndata: ${JSON.stringify(state)}\n\n`));
        if (!state.running) { controller.close(); return; }
        this.clients.add(controller);
        this.heartbeat ??= setInterval(() => {
          for (const subscriber of this.clients) {
            try { subscriber.enqueue(this.encoder.encode(": keep-alive\n\n")); }
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
