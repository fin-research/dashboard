import { Buffer } from 'node:buffer';
import { createMcpHandler } from 'agents/mcp/server';
import { McpServer } from '@modelcontextprotocol/server';
import { parse, unflatten } from 'devalue';
import { z } from 'zod';
import { readSse } from '../sse.ts';
import { CONTEXT_HEADER } from './gateway-context.ts';
import type { SiteIdentity } from '../identity.ts';
import { mcpOperations, operationPath, type McpOperation } from './mcp-catalog.ts';
import { listPublicCreditFiles } from './credit-public-files.ts';
import { searchPublicCreditDocuments } from './credit-search.ts';

const MAX_REQUEST = 1024 * 1024;
const MAX_RESPONSE = 8 * 1024 * 1024;
const privateHeaders = { 'Cache-Control': 'no-store, private', Vary: 'Cookie, Authorization' };
class McpBusinessError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export async function boundedText(source: Request | Response, limit: number): Promise<string> {
  const reader = source.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder(); let text = '', size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) throw new McpBusinessError(413, '内容超过 MCP 大小限制，请缩小查询范围');
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
function contextHeaders(user: SiteIdentity) {
  return new Headers({ [CONTEXT_HEADER]: Buffer.from(JSON.stringify({ version: 1, user, choice: { status: 401 } })).toString('base64url') });
}
async function policies(env: Pick<Env, 'IDENTITY'>, user: SiteIdentity) {
  const headers = contextHeaders(user); headers.set('Content-Type', 'application/json');
  const response = await env.IDENTITY.fetch(new Request('https://identity.internal/mcp/policies', { method: 'POST', headers,
    body: JSON.stringify(mcpOperations.map(operation => ({ path: operationPath(operation, {}), method: operation.method }))) }));
  if (!response.ok) throw new McpBusinessError(response.status, 'MCP 权限检查失败');
  return z.object({ allowed: z.array(z.boolean()).length(mcpOperations.length) }).parse(JSON.parse(await boundedText(response, MAX_REQUEST))).allowed;
}
export async function decodeBusinessResponse(response: Response, operation: Pick<McpOperation, 'format'>, signal?: AbortSignal): Promise<unknown> {
  if (response.headers.get('Content-Type')?.includes('text/event-stream')) {
    let result: unknown, terminal = false;
    if (!response.body) throw new McpBusinessError(502, 'AI 响应为空');
    await readSse(response.body, event => {
      if (event.event === 'error') throw new McpBusinessError(502, event.data);
      if (event.event === 'result') { result = JSON.parse(event.data); terminal = true; }
    }, MAX_RESPONSE, { signal, shouldStop: () => terminal });
    if (!terminal) throw new McpBusinessError(502, 'AI 响应中断，请查询历史结果后再决定是否重试');
    return result;
  }
  const text = await boundedText(response, MAX_RESPONSE);
  if (!response.ok) {
    let message = `业务请求失败（HTTP ${response.status}）`;
    try { const value = JSON.parse(text); message = value.detail || value.message || (typeof value.error === 'string' ? value.error : message); } catch { /* no raw HTML/errors */ }
    throw new McpBusinessError(response.status, message);
  }
  if (operation.format === 'html') return { html: text };
  const value = JSON.parse(text);
  if (operation.format === 'form') {
    const data = typeof value.data === 'string' ? parse(value.data) : value.data;
    if (value.type === 'failure' || value.type === 'error') return { failed: true, status: value.status, data: data ?? value.error };
    return value.type === 'redirect' ? { saved: true, location: value.location } : data ?? value;
  }
  if (operation.format === 'page') {
    if (value.type !== 'data' || !Array.isArray(value.nodes)) throw new McpBusinessError(502, '页面数据响应无效');
    const node = value.nodes.at(-1);
    if (!node || node.type !== 'data') throw new McpBusinessError(node?.status ?? 502, '业务数据读取失败');
    return unflatten(node.data);
  }
  return value;
}
export async function executeOperation(operation: McpOperation, input: Record<string, unknown>, env: Pick<Env, 'IDENTITY'>, user: SiteIdentity, signal?: AbortSignal) {
  const path = operationPath(operation, input, true);
  const headers = contextHeaders(user);
  let body: string | URLSearchParams | undefined;
  if (operation.format === 'form') {
    headers.set('Content-Type', 'application/x-www-form-urlencoded'); headers.set('X-SvelteKit-Action', 'true');
    body = new URLSearchParams();
    for (const [key, value] of Object.entries(input.form as Record<string, unknown>)) {
      for (const item of Array.isArray(value) ? value : [value]) body.append(key, String(item));
    }
  } else if (!['GET', 'DELETE'].includes(operation.method)) {
    headers.set('Content-Type', 'application/json'); body = JSON.stringify(input.body ?? {});
  }
  // IDENTITY rechecks the real route permission before dispatching through the
  // private GatewayDashboard entrypoint. No public fetch or local auth bypass.
  const response = await env.IDENTITY.fetch(new Request('https://identity.internal/mcp/dispatch?target=' + encodeURIComponent(path), {
    method: operation.method, headers, body, signal,
  }));
  return decodeBusinessResponse(response, operation, signal);
}
export async function handleDashboardMcp(request: Request, env: Pick<Env, 'IDENTITY' | 'EASTMONEY' | 'CREDIT_SEARCH'>, user: SiteIdentity | null): Promise<Response> {
  if (!user) return Response.json({ error: '请先登录' }, { status: 401, headers: privateHeaders });
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...privateHeaders, Allow: 'POST' } });
  try {
    // Limit bytes before SDK JSON parsing, including chunked requests.
    const body = await boundedText(request, MAX_REQUEST);
    const headers = new Headers(request.headers); headers.delete('Content-Length');
    const bounded = new Request(request, { headers, body });
    const handler = createMcpHandler(async () => {
      const server = new McpServer({ name: 'eastmoney-dashboard', version: '1.0.0' });
      server.registerTool('health', { description: 'Dashboard MCP 可用性与当前账号的工具数量。', inputSchema: z.object({}).strict(), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async () => ({ content: [{ type: 'text', text: 'ok' }], structuredContent: { status: 'ok', toolCount: allowed.filter(Boolean).length + 3 } }));
      server.registerTool('credit_public_materials', { title: '列出公开授信材料', description: '列出授信公开 PDF 材料与可打开的原件链接。', inputSchema: z.object({}).strict(), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async () => {
        const documents = (await listPublicCreditFiles(env.EASTMONEY)).map(({ title, authority, url }) => ({ title, authority, url }));
        return { content: [{ type: 'text', text: JSON.stringify(documents) }], structuredContent: { documents } };
      });
      server.registerTool('credit_public_search', { title: '检索公开授信材料', description: '搜索当前公开授信 PDF，返回原始片段和原件链接。跨年度 ROE 问题逐年检索现有审计报告表格。检索片段没有可核验页码。',
        inputSchema: z.object({ query: z.string().trim().min(2).max(200) }).strict(),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ query }) => {
        const documents = await listPublicCreditFiles(env.EASTMONEY);
        const byKey = new Map(documents.map(document => [document.key, document]));
        const search = await searchPublicCreditDocuments(env.CREDIT_SEARCH, documents, query, 12);
        const sources = search.chunks.flatMap((chunk: { item: { key: string }; text: string }) => {
          const document = byKey.get(chunk.item.key);
          return document && chunk.text.trim() ? [{ title: document.title, text: chunk.text,
            url: document.url, locator: 'AI Search 检索片段', authority: document.authority }] : [];
        });
        const coverage = { requestedYears: search.requestedYears, foundYears: search.foundYears,
          missingYears: search.requestedYears.filter(year => !search.foundYears.includes(year)) };
        return { content: [{ type: 'text', text: JSON.stringify({ sources, coverage }) }], structuredContent: { sources, coverage } };
      });
      const allowed = await policies(env, user);
      mcpOperations.forEach((operation, index) => {
        if (!allowed[index]) return;
        const readOnly = operation.method === 'GET' || operation.name === 'liability_report_data';
        server.registerTool(operation.name, { title: operation.title,
          description: `${operation.title}。${operation.description ?? ''}${operation.ai ? '会调用 AI 并可能保存结果。' : ''} ${operation.method} ${operation.path}${operation.action ? '?/' + operation.action : ''}`,
          inputSchema: operation.input, annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, idempotentHint: readOnly, openWorldHint: Boolean(operation.ai) },
        }, async (input) => {
          try {
            const data = await executeOperation(operation, input as Record<string, unknown>, env, user, request.signal);
            const failed = Boolean(data && typeof data === 'object' && 'failed' in data && data.failed);
            return { ...(failed ? { isError: true } : {}), content: [{ type: 'text' as const, text: JSON.stringify(data) }], structuredContent: { data } };
          } catch (error) {
            const status = error instanceof McpBusinessError ? error.status : 503;
            const detail = error instanceof McpBusinessError ? error.message : '业务执行失败，请先核对当前记录或历史结果，避免重复提交';
            return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ status, detail }) }] };
          }
        });
      });
      return server;
    }, { route: '/api/mcp', corsOptions: false, allowedHostnames: ['eastmoney.hasbai.xyz'], allowedOriginHostnames: ['eastmoney.hasbai.xyz'] });
    const response = await handler.fetch(bounded);
    const result = new Response(response.body, response);
    for (const [name, value] of Object.entries(privateHeaders)) result.headers.set(name, value);
    return result;
  } catch (error) {
    return Response.json({ error: error instanceof McpBusinessError ? error.message : 'MCP 服务暂时不可用' }, { status: error instanceof McpBusinessError ? error.status : 503, headers: privateHeaders });
  }
}
