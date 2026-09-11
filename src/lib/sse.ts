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

