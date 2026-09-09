/** Parse SSE incrementally across UTF-8, line and event boundaries. */
export async function readSse(
  body: ReadableStream<Uint8Array>,
  receive: (event: { event: string; data: string }) => void,
  maxBytes: number,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", event = "message", data: string[] = [], bytes = 0;
  function line(value: string) {
    if (value === "") {
      if (data.length) receive({ event, data: data.join("\n") });
      event = "message"; data = [];
    } else if (value.startsWith("data:")) data.push(value.slice(5).replace(/^ /, ""));
    else if (value.startsWith("event:")) event = value.slice(6).trim();
  }
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw new Error("AI stream exceeds response size limit");
      buffer += decoder.decode(chunk.value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        line(buffer.slice(0, newline).replace(/\r$/, ""));
        buffer = buffer.slice(newline + 1);
      }
    }
    buffer += decoder.decode();
    if (buffer) line(buffer.replace(/\r$/, ""));
    line("");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object";

/** Only ordinary output_text is forwarded. Reasoning and tool arguments stay server-side. */
export async function readResponsesStream(
  body: ReadableStream<Uint8Array>, onText: (delta: string) => void, maxBytes: number,
): Promise<unknown> {
  let completed: unknown;
  const phases = new Map<number, string>();
  await readSse(body, ({ data }) => {
    if (data === "[DONE]") return;
    const value: unknown = JSON.parse(data);
    if (!object(value)) return;
    const index = typeof value.output_index === "number" ? value.output_index : 0;
    if (value.type === "response.output_item.added" && object(value.item)) {
      phases.set(index, typeof value.item.phase === "string" ? value.item.phase : "");
    }
    if (value.type === "response.output_text.delta" && typeof value.delta === "string"
      && phases.get(index) !== "commentary") onText(value.delta);
    if (["response.completed", "response.failed", "response.incomplete"].includes(String(value.type))) completed = value.response;
    if (value.type === "error") throw new Error("AI stream reported an error");
  }, maxBytes);
  if (!completed) throw new Error("AI stream ended before response completion");
  return completed;
}
