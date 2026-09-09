import { getAgentByName } from "agents";
import { loadCreditCorpus, isCreditOriginalKey } from "../src/lib/server/credit-evidence.ts";
import { findCreditCustomers } from "../src/lib/server/credit-repository.ts";
import { withPostgres } from "../src/lib/server/postgres.ts";
import { canDownloadCreditDocument, creditCorpusForCustomer, isPublicCreditDocument, CREDIT_NDA_REQUIRED } from "../src/lib/server/credit-confidentiality.ts";
import { creditCustomerSelectionSchema, creditQuestionSchema, type CreditSession } from "../src/lib/credit-assistant/types.ts";
import type { SiteIdentity } from "../src/lib/identity.ts";
import { creditAgentName } from "../src/lib/server/credit-session.ts";

// Transport/memory protection only; there is no question character limit.
const MAX_REQUEST_BYTES = 1024 * 1024;
const PRIVATE_HEADERS = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };

export async function creditAssistantHttp(request: Request, env: Cloudflare.Env, user: SiteIdentity | null): Promise<Response> {
  if (!user?.auth0Id) return Response.json({ error: "请先登录" }, { status: 401, headers: PRIVATE_HEADERS });
  const userId = user.auth0Id;
  const url = new URL(request.url);
  if (!["GET", "HEAD"].includes(request.method) && request.headers.get("origin") !== url.origin) {
    return Response.json({ error: "请求来源不匹配" }, { status: 403, headers: PRIVATE_HEADERS });
  }
  try {
    if (url.pathname === "/api/credit-assistant/institutions") {
      if (request.method !== "GET") return new Response(null, { status: 405, headers: PRIVATE_HEADERS });
      const query = (url.searchParams.get("q") ?? "").trim();
      if (query.length > 200) return Response.json({ error: "客户名称不能超过200字" }, { status: 400, headers: PRIVATE_HEADERS });
      const institutions = query ? await withPostgres(env.HYPERDRIVE.connectionString, "credit-customer-search", client => findCreditCustomers(client, query)) : [];
      return Response.json({ institutions }, { headers: PRIVATE_HEADERS });
    }
    if (["/api/credit-assistant/session", "/api/credit-assistant/session/new", "/api/credit-assistant/session/institution", "/api/credit-assistant/session/events"].includes(url.pathname)) {
      const newSession = url.pathname.endsWith("/new");
      const stream = url.pathname.endsWith("/events");
      if (stream && request.method !== "GET") return new Response(null, { status: 405 });
      if ((newSession || url.pathname.endsWith("/institution")) && request.method !== "POST") return new Response(null, { status: 405 });
      if (!["GET", "POST", "DELETE"].includes(request.method)) return new Response(null, { status: 405 });
      let institutionName = (url.searchParams.get("institutionName") ?? "").trim();
      let forwarded = request;
      if (request.method === "POST") {
        if (Number(request.headers.get("content-length") ?? 0) > MAX_REQUEST_BYTES) return new Response(null, { status: 413 });
        const reader = request.body?.getReader();
        const chunks: Uint8Array[] = []; let size = 0;
        if (reader) while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > MAX_REQUEST_BYTES) { await reader.cancel(); return new Response(null, { status: 413 }); }
          chunks.push(chunk.value);
        }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        const body = new TextDecoder().decode(bytes);
        let input: unknown;
        try { input = JSON.parse(body); } catch { return Response.json({ error: "请求不是有效JSON" }, { status: 400 }); }
        const parsed = (newSession || url.pathname.endsWith("/institution") ? creditCustomerSelectionSchema : creditQuestionSchema).safeParse(input);
        if (!parsed.success) return Response.json({ error: "请输入问题并从列表中选择客户机构。" }, { status: 400, headers: PRIVATE_HEADERS });
        institutionName = parsed.data.institutionName;
        forwarded = new Request(request.url, { method: "POST", headers: request.headers, body });
      }
      if (!institutionName) return request.method === "GET" && !stream
        ? Response.json({ turns: [], running: false, progress: "", error: null, startedAt: 0, customer: null }, { headers: PRIVATE_HEADERS })
        : Response.json({ error: "请先输入客户名称并从列表中选择机构。" }, { status: 400, headers: PRIVATE_HEADERS });
      if (!creditCustomerSelectionSchema.safeParse({ institutionName }).success) return new Response(null, { status: 400 });
      const agent = await getAgentByName(env.CREDIT_AGENT, creditAgentName(userId, institutionName));
      const response = await agent.fetch(forwarded);
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(PRIVATE_HEADERS)) headers.set(key, value);
      if (stream) headers.set("cache-control", "private, no-store, no-transform");
      return new Response(response.body, { status: response.status, headers });
    }
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405 });
    const corpus = await loadCreditCorpus(env.CREDIT);
    async function currentSession(): Promise<CreditSession | null> {
      const institutionName = (url.searchParams.get("institutionName") ?? "").trim();
      if (!creditCustomerSelectionSchema.safeParse({ institutionName }).success) return null;
      const agent = await getAgentByName(env.CREDIT_AGENT, creditAgentName(userId, institutionName));
      const result = await agent.fetch(new Request(url.origin + "/api/credit-assistant/session"));
      if (!result.ok) throw new Error("Credit session unavailable");
      return result.json<CreditSession>();
    }
    if (url.pathname === "/api/credit-assistant/materials") {
      const session = await currentSession();
      const allowed = creditCorpusForCustomer(corpus, session?.customer ?? null);
      return Response.json({ builtAt: corpus.builtAt, documents: allowed.documents.map(d => ({ id: d.id, title: d.title,
        confidentiality: isPublicCreditDocument(d) ? "public" : "confidential",
        authority: d.authority, blockCount: d.blockCount, ocrCount: d.ocrCount, url: `/api/credit-assistant/files/${d.id}` })) }, { headers: PRIVATE_HEADERS });
    }
    const id = url.pathname.match(/^\/api\/credit-assistant\/files\/([a-f0-9]{24})$/)?.[1];
    const doc = id ? corpus.documents.find(d => d.id === id) : undefined;
    if (!doc) return new Response("Not found", { status: 404, headers: PRIVATE_HEADERS });
    if (!isPublicCreditDocument(doc) && !canDownloadCreditDocument(doc, await currentSession(), url.searchParams.get("turnId"))) {
      return Response.json({ error: CREDIT_NDA_REQUIRED }, { status: 403, headers: PRIVATE_HEADERS });
    }
    // Resolve only catalog-owned immutable keys; arbitrary R2 paths cannot be requested.
    if (!isCreditOriginalKey(doc.originalKey)) throw new Error("Invalid catalog key");
    const file = await env.CREDIT.get(doc.originalKey, { range: request.headers });
    if (!file) return new Response("Not found", { status: 404, headers: PRIVATE_HEADERS });
    const isPdf = doc.originalKey.endsWith(".pdf");
    const headers = new Headers(PRIVATE_HEADERS);
    headers.set("content-type", isPdf ? "application/pdf" : "application/octet-stream");
    headers.set("content-disposition", `${isPdf && url.searchParams.get("download") !== "1" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(doc.title)}`);
    headers.set("accept-ranges", "bytes");
    headers.set("etag", file.httpEtag);
    const range = request.headers.has("range") ? file.range : undefined;
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
