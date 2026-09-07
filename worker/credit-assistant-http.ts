import { getAgentByName } from "agents";
import { loadCreditCorpus } from "../src/lib/server/credit-evidence.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PRIVATE_HEADERS = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };

export async function creditAssistantHttp(request: Request, env: Cloudflare.Env): Promise<Response> {
  const url = new URL(request.url);
  if (!["GET", "HEAD"].includes(request.method) && request.headers.get("origin") !== url.origin) {
    return Response.json({ error: "请求来源不匹配" }, { status: 403, headers: PRIVATE_HEADERS });
  }
  try {
    if (url.pathname === "/api/credit-assistant/session" || url.pathname === "/api/credit-assistant/session/new") {
      const newSession = url.pathname.endsWith("/new");
      if (newSession && request.method !== "POST") return new Response(null, { status: 405 });
      if (!["GET", "POST", "DELETE"].includes(request.method)) return new Response(null, { status: 405 });
      const cookie = request.headers.get("cookie")?.match(/(?:^|;\s*)credit-session=([^;]+)/)?.[1];
      const session = !newSession && cookie && UUID.test(cookie) ? cookie : crypto.randomUUID();
      let forwarded = newSession ? new Request(url.origin + "/api/credit-assistant/session") : request;
      if (request.method === "POST" && !newSession) {
        if (Number(request.headers.get("content-length") ?? 0) > 16000) return new Response(null, { status: 413 });
        const reader = request.body?.getReader();
        const chunks: Uint8Array[] = []; let size = 0;
        if (reader) while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 16000) { await reader.cancel(); return new Response(null, { status: 413 }); }
          chunks.push(chunk.value);
        }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        const body = new TextDecoder().decode(bytes);
        try { JSON.parse(body); } catch { return Response.json({ error: "请求不是有效JSON" }, { status: 400 }); }
        forwarded = new Request(request.url, { method: "POST", headers: request.headers, body });
      }
      const agent = await getAgentByName(env.CREDIT_AGENT, session);
      const response = await agent.fetch(forwarded);
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(PRIVATE_HEADERS)) headers.set(key, value);
      headers.set("set-cookie", `credit-session=${session}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${url.protocol === "https:" ? "; Secure" : ""}`);
      return new Response(response.body, { status: response.status, headers });
    }
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405 });
    const corpus = await loadCreditCorpus(env.CREDIT);
    if (url.pathname === "/api/credit-assistant/materials") {
      return Response.json({ builtAt: corpus.builtAt, documents: corpus.documents.map(d => ({ id: d.id, title: d.title,
        authority: d.authority, blockCount: d.blockCount, ocrCount: d.ocrCount, url: `/api/credit-assistant/files/${d.id}` })) }, { headers: PRIVATE_HEADERS });
    }
    const id = url.pathname.match(/^\/api\/credit-assistant\/files\/([a-f0-9]{24})$/)?.[1];
    const doc = id ? corpus.documents.find(d => d.id === id) : undefined;
    if (!doc) return new Response("Not found", { status: 404, headers: PRIVATE_HEADERS });
    // Resolve only catalog-owned immutable keys; arbitrary R2 paths cannot be requested.
    if (!/^originals\/[a-f0-9]{24}\.(pdf|docx?|xlsx?)$/.test(doc.originalKey)) throw new Error("Invalid catalog key");
    const file = await env.CREDIT.get(doc.originalKey, { range: request.headers });
    if (!file) return new Response("Not found", { status: 404, headers: PRIVATE_HEADERS });
    const isPdf = doc.originalKey.endsWith(".pdf");
    const headers = new Headers(PRIVATE_HEADERS);
    headers.set("content-type", isPdf ? "application/pdf" : "application/octet-stream");
    headers.set("content-disposition", `${isPdf && url.searchParams.get("download") !== "1" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(doc.title)}`);
    headers.set("accept-ranges", "bytes");
    headers.set("etag", file.httpEtag);
    const range = file.range;
    if (range && "offset" in range && range.offset !== undefined && range.length !== undefined) {
      headers.set("content-range", `bytes ${range.offset}-${range.offset + range.length - 1}/${file.size}`);
      headers.set("content-length", String(range.length));
    } else headers.set("content-length", String(file.size));
    return new Response(request.method === "HEAD" ? null : file.body, { headers, status: range ? 206 : 200 });
  } catch (error) {
    console.error(JSON.stringify({ event: "credit_request_failed", error_type: error instanceof Error ? error.name : "unknown" }));
    return Response.json({ error: "授信服务暂不可用，请检查材料导入与服务配置" }, { status: 503, headers: PRIVATE_HEADERS });
  }
}
