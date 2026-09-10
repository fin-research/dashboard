import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { answerCreditQuestion } from "../src/lib/server/credit-assistant.ts";
import { CREDIT_NDA_REQUIRED } from "../src/lib/server/credit-confidentiality.ts";
import { creditAgentName } from "../src/lib/server/credit-session.ts";
import { recordingCreditTracing } from "./helpers/credit-trace-recorder.mjs";

// Execute the actual Worker handlers; replace only the Cloudflare runtime,
// database transport and model transport, not routing or disclosure logic.
const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const agents = moduleUrl(`export { isDurableObjectCodeUpdateReset, isPlatformTransientError } from ${JSON.stringify(new URL("../node_modules/agents/dist/retries.js", import.meta.url).href)};
export class Agent {
  constructor(ctx, env) { this.ctx = { ...ctx, storage: { transactionSync: operation => operation() } }; this.env = env; this.jobs = []; }
  get state() { return this._state ??= structuredClone(this.initialState); }
  setState(state) { this._state = state; }
  async schedule(_delay, callback, payload) { this.jobs.push({callback,payload}); }
  sql() { return []; }
  getQueues() { return []; }
} export async function getAgentByName(binding, name) { return binding.get(name); }`);
const postgres = moduleUrl("export async function withPostgres(_connection, _application, operation) { return operation(globalThis.creditTestClient); }");
const assistant = moduleUrl(`export { recoverQueuedCreditAnswers, CREDIT_SCOPE_REFUSAL } from ${JSON.stringify(new URL("../src/lib/server/credit-assistant.ts", import.meta.url).href)};
export async function answerCreditQuestion(options) { return globalThis.creditTestAnswer(options); }`);
const workers = moduleUrl(`export const tracing = {enterSpan(...args) {return globalThis.creditTestTracing.enterSpan(...args);}};`);
async function workerModule(file) {
  const url = new URL(`../worker/${file}`, import.meta.url);
  const source = (await readFile(url, "utf8")).replace(/from "([^"]+)"/g, (_match, specifier) => `from ${JSON.stringify(
    specifier === "agents" ? agents : specifier === "cloudflare:workers" ? workers : specifier.endsWith("/postgres.ts") ? postgres : specifier.endsWith("/credit-assistant.ts") ? assistant : new URL(specifier, url).href)}`);
  return import(moduleUrl(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText));
}
const { CreditAgent } = await workerModule("credit-agent.ts");
const { creditAssistantHttp } = await workerModule("credit-assistant-http.ts");
const publicDoc = { id: "a".repeat(24), title: "年度报告.pdf", relativePath: "定期报告/年度报告.pdf", originalKey: "originals/定期报告/年度报告.pdf",
  authority: "audited", bytes: 4, sha256: "a".repeat(64), modifiedAt: "2026-09-07", blockCount: 1, ocrCount: 0 };
const privateDoc = { ...publicDoc, id: "b".repeat(24), title: "保密审计报告.pdf", relativePath: "风控/保密审计报告.pdf", originalKey: "originals/风控/保密审计报告.pdf" };
const corpus = { version: "credit-document-v2", builtAt: "2026-09-07", documents: [publicDoc, privateDoc],
  blocks: [publicDoc, privateDoc].map(d => ({ id: d.id + "-1", documentId: d.id, text: "现金50亿元", locator: "PDF第1页", extraction: "text", searchKey: `search/${d.relativePath}.md` })) };
const origin = "https://test.example";

const testUser = { id: "access-test", auth0Id: "auth0|test", email: "test@18.cn", issuedAt: 0, expiresAt: 9999999999 };
function setup() {
  const { tracing, spans } = recordingCreditTracing();
  globalThis.creditTestTracing = tracing;
  const customers = new Map([["银行甲", { name: "银行甲", confidentialityStatus: true, reportDate: "2026-09-07" }],
    ["银行乙", { name: "银行乙", confidentialityStatus: false, reportDate: "2026-09-07" }]]);
  let unavailable = false;
  let customerReads = 0;
  globalThis.creditTestClient = { query: async (sql, values) => {
    if (sql.startsWith("SELECT")) customerReads++;
    if (unavailable) throw new Error("database unavailable");
    return { rows: sql.startsWith("SELECT") ? [...customers.values()].filter(c => values[1] ? c.name === values[0] : c.name.includes(values[0])) : [] };
  } };
  globalThis.creditTestAnswer = options => answerCreditQuestion({ ...options, semanticSearch: undefined,
    generate: async (_credentials, _messages, schema, name) => name === "credit_scope" ? schema.parse({ inScope: true, queries: [], attachments: [] }) : schema.parse({ step: { action: "answer", answer: {
      status: "complete", paragraphs: [], gaps: [], attachments: [options.question.includes("保密") ? privateDoc.id : publicDoc.id],
    } } }) });
  const sessions = new Map();
  let originalReads = 0;
  const env = { HYPERDRIVE: { connectionString: "test" }, CREDIT: { get: async key => {
    if (key === "catalog/corpus.json") return { size: 100, json: async () => corpus };
    originalReads++;
    return { body: "file", size: 4, httpEtag: "test-etag", range: { offset: 0, length: 4 } };
  } }, CREDIT_AGENT: { get: name => {
    if (!sessions.has(name)) { const agent = new CreditAgent({ id: { toString: () => name } }, env); agent.fetch = request => agent.onRequest(request); sessions.set(name, agent); }
    return sessions.get(name);
  } } };
  let cookie = "";
  let selectedInstitution = "";
  async function request(path, body, method = body ? "POST" : "GET", options = {}) {
    const url = new URL(origin + "/api/credit-assistant/" + path);
    if (!url.searchParams.has("institutionName") && selectedInstitution) url.searchParams.set("institutionName", selectedInstitution);
    const response = await creditAssistantHttp(new Request(url, {
      method, headers: { origin, cookie, "content-type": "application/json", ...options.headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }), env, Object.hasOwn(options, "user") ? options.user : testUser);
    if (path === "session/institution" && response.ok) selectedInstitution = body.institutionName;
    if (response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie").split(";")[0];
    return response;
  }
  return { customers, sessions, request, spans, setUnavailable: () => { unavailable = true; }, originalReads: () => originalReads, customerReads: () => customerReads };
}

test("fresh customer selection needs no write or NDA lookup; first question verifies it server-side", async () => {
  const app = setup();
  assert.equal((await app.request("session?institutionName=银行乙")).status, 200);
  assert.equal(app.customerReads(), 0);
  const response = await app.request("session", { institutionName: "银行乙", question: "请提供保密审计报告.pdf" });
  assert.equal(response.status, 202);
  assert.equal(app.customerReads(), 1);
  const state = await response.json();
  assert.equal(state.customer.confidentialityStatus, false);
  assert.ok(state.conversationId);
  const agent = [...app.sessions.values()].find(s => s.jobs.length);
  await agent.answerQuestion(agent.jobs[0].payload);
  assert.equal(agent.state.turns[0].answer.notice, CREDIT_NDA_REQUIRED);
  assert.deepEqual(agent.state.turns[0].answer.files, []);
  const root = app.spans.find(span => span.name === "invoke_agent CreditAgent");
  assert.equal(root.attributes["credit.outcome"], "refused_confidentiality");
  assert.equal(root.attributes["credit.model_calls"], 0);
  assert.equal(root.attributes["gen_ai.conversation.id"], state.conversationId);
  assert.equal(root.attributes["credit.run_id"], agent.jobs[0].payload.id);
  assert.equal(app.spans.some(span => span.name.startsWith("chat ")), false);
  assert.equal(root.ended, true);
});

test("a deployment reset is deferred to the SDK instead of becoming a generic failed answer", async () => {
  const app = setup();
  await app.request("session", { institutionName: "银行乙", question: "查公司资产" });
  const agent = [...app.sessions.values()].find(session => session.jobs.length);
  const reset = new Error("SQL query failed: Durable Object reset because its code was updated.", { cause: new Error("Durable Object reset because its code was updated.") });
  reset.name = "SqlError";
  globalThis.creditTestAnswer = async () => { throw reset; };
  await assert.rejects(agent.answerQuestion(agent.jobs[0].payload), { name: "SqlError" });
  assert.equal(agent.state.running, true);
  assert.equal(agent.state.error, null);
  assert.equal(agent.state.pendingQuestion, "查公司资产");
  assert.equal(app.spans[0].attributes["credit.outcome"], "recovering");
  assert.equal(app.spans[0].attributes["error.type"], "session_storage");
  assert.equal(app.spans[0].ended, true);
});

test("turn tracing keeps conversation identity across follow-ups, changes it on new conversation, and marks scope refusal", async () => {
  const app = setup();
  globalThis.creditTestAnswer = options => answerCreditQuestion({ ...options, generate: async (_c, _m, schema) =>
    schema.parse({ inScope: false, queries: [], attachments: [] }) });
  for (let i = 0; i < 3; i++) {
    if (i === 2) await app.request("session/new", { institutionName: "银行乙" });
    await app.request("session", { institutionName: "银行乙", question: "敏感无关问题" });
    const agent = [...app.sessions.values()].find(session => session.jobs.length);
    await agent.answerQuestion(agent.jobs.at(-1).payload);
    const before = app.spans.length;
    await agent.answerQuestion(agent.jobs.at(-1).payload);
    assert.equal(app.spans.length, before, "completed duplicate jobs do not create phantom runs");
  }
  const roots = app.spans.filter(span => span.name === "invoke_agent CreditAgent");
  assert.equal(roots.length, 3);
  assert.equal(roots[0].attributes["gen_ai.conversation.id"], roots[1].attributes["gen_ai.conversation.id"]);
  assert.notEqual(roots[1].attributes["gen_ai.conversation.id"], roots[2].attributes["gen_ai.conversation.id"]);
  assert.equal(new Set(roots.map(span => span.attributes["credit.run_id"])).size, 3);
  assert.equal(new Set(roots.map(span => span.attributes["gen_ai.agent.id"])).size, 1);
  assert.ok(roots.every(span => span.attributes["credit.outcome"] === "refused_scope"));
  assert.doesNotMatch(JSON.stringify(app.spans.map(span => span.attributes)), /银行乙|auth0\||test@18.cn|敏感/);
});

test("cold-start institution options include the whole list, not just twenty search hits", async () => {
  const app = setup();
  for (let i = 0; i < 35; i++) app.customers.set(`测试银行${i}`, { name: `测试银行${i}`, confidentialityStatus: false, reportDate: "2026-09-10" });
  const response = await app.request("institutions");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).institutions.length, 37);
  assert.equal(app.customerReads(), 1);
});

test("HTTP selection, submit, signed private download and live revocation", async () => {
  const app = setup();
  assert.equal((await app.request("session", { question: "材料" })).status, 400);
  assert.equal((await app.request("session/institution", { institutionName: "不存在" })).status, 404);
  assert.equal((await app.request("session/institution", { institutionName: "银行甲", confidentialityStatus: true })).status, 400);
  assert.equal((await app.request("session/institution", { institutionName: "银行甲" })).status, 200);
  const submission = await app.request("session", { institutionName: "银行甲", question: "请提供保密审计报告.pdf" });
  assert.equal(submission.status, 202);
  const agent = [...app.sessions.values()].find(s => s.jobs.length);
  await agent.answerQuestion(agent.jobs[0].payload);
  const state = await (await app.request("session")).json();
  const answer = state.turns[0].answer;
  const file = answer.files[0];
  const path = file.url.replace("/api/credit-assistant/", "");
  assert.equal((await app.request(path + "&download=1")).status, 200);
  assert.equal((await app.request(path, null, "HEAD")).status, 200);
  assert.equal((await app.request(path, null, "GET", { headers: { range: "bytes=0-3" } })).status, 206);
  assert.equal((await app.request("files/" + privateDoc.id)).status, 403);
  assert.equal((await app.request("session/institution", { institutionName: "银行乙" })).status, 200);
  await app.request("session/institution", { institutionName: "银行甲" });
  app.customers.set("银行甲", { ...app.customers.get("银行甲"), confidentialityStatus: false });
  const hidden = await (await app.request("session")).json();
  assert.equal(hidden.turns[0].answer.notice, CREDIT_NDA_REQUIRED);
  assert.deepEqual(hidden.turns[0].answer.files, []);
  const before = app.originalReads();
  assert.equal((await app.request(path, null, "HEAD")).status, 403);
  assert.equal((await app.request(path, null, "GET", { headers: { range: "bytes=0-2" } })).status, 403);
  assert.equal(app.originalReads(), before);
  await app.request("session/new", { institutionName: "银行甲" }, "POST");
  assert.equal((await app.request(path)).status, 403);
});

test("unsigned materials and direct file endpoints never expose restricted records or bytes", async () => {
  const app = setup();
  const list = await (await app.request("materials")).json();
  assert.deepEqual(list.documents.map(d => d.id), [publicDoc.id]);
  assert.equal((await app.request("files/" + publicDoc.id)).status, 200);
  assert.equal((await app.request("files/" + privateDoc.id)).status, 403);
  await app.request("session/institution", { institutionName: "银行乙" });
  await app.request("session", { institutionName: "银行乙", question: "保密审计报告.pdf" });
  const agent = [...app.sessions.values()].find(s => s.jobs.length);
  await agent.answerQuestion(agent.jobs[0].payload);
  assert.equal((await (await app.request("session")).json()).turns[0].answer.notice, CREDIT_NDA_REQUIRED);
});

test("generation uses its submission permission snapshot, without a final recheck", async () => {
  const app = setup();
  await app.request("session/institution", { institutionName: "银行甲" });
  await app.request("session", { institutionName: "银行甲", question: "保密审计报告.pdf" });
  const generate = globalThis.creditTestAnswer;
  globalThis.creditTestAnswer = async options => {
    const answer = await generate(options);
    app.customers.set("银行甲", { ...app.customers.get("银行甲"), confidentialityStatus: false });
    return answer;
  };
  const agent = [...app.sessions.values()].find(s => s.jobs.length);
  await agent.answerQuestion(agent.jobs[0].payload);
  assert.equal(agent.state.turns[0].answer.files[0].id, privateDoc.id);
  // A new read/download is still a new authorized request.
  assert.equal((await (await app.request("session")).json()).turns[0].answer.notice, CREDIT_NDA_REQUIRED);
});

test("database failures fail closed, and POSTs cannot bypass same-origin validation", async () => {
  const app = setup();
  assert.equal((await app.request("session/institution", { institutionName: "银行甲" }, "POST", { headers: { origin: "https://other.example" } })).status, 403);
  await app.request("session/institution", { institutionName: "银行甲" });
  await app.request("session", { institutionName: "银行甲", question: "请提供保密审计报告.pdf" });
  const agent = [...app.sessions.values()].find(s => s.jobs.length);
  await agent.answerQuestion(agent.jobs[0].payload);
  app.setUnavailable();
  assert.equal((await app.request("session")).status, 503);
  assert.equal((await app.request("files/" + privateDoc.id + "?turnId=anything")).status, 503);
  assert.equal(app.originalReads(), 0);
  assert.equal((await app.request("session", { institutionName: "银行甲", question: "再发一遍" })).status, 503);
});

test("verified users have deterministic isolated sessions and cannot select another user through cookies or headers", async () => {
  const app = setup();
  assert.equal((await app.request("session", null, "GET", { user: null })).status, 401);
  await app.request("session/institution", { institutionName: "银行甲" });
  await app.request("session", { institutionName: "银行甲", question: "年度报告.pdf" });
  const agent = app.sessions.get(creditAgentName(testUser.auth0Id, "银行甲"));
  await agent.answerQuestion(agent.jobs[0].payload);
  const sameUser = await (await app.request("session", null, "GET", { headers: { cookie: "credit-session=00000000-0000-4000-8000-000000000000" } })).json();
  assert.equal(sameUser.turns.length, 1);
  const another = { ...testUser, id: "access-test-rotated", auth0Id: "auth0|test-other" };
  const isolated = await (await app.request("session", null, "GET", { user: another,
    headers: { "x-user-id": testUser.auth0Id, "x-credit-user-id": testUser.auth0Id } })).json();
  assert.equal(isolated.turns.length, 0);
  const issued = sameUser.turns[0].answer.files[0];
  // Public documents may be read by either logged-in identity; private turn IDs never confer ownership.
  assert.equal(issued.id, publicDoc.id);
  await app.request("session", { institutionName: "银行甲", question: "保密审计报告.pdf" });
  await agent.answerQuestion(agent.jobs.at(-1).payload);
  const privateUrl = agent.state.turns.at(-1).answer.files[0].url.replace("/api/credit-assistant/", "");
  assert.equal((await app.request(privateUrl, null, "GET", { user: another })).status, 403);
  await app.request("session/institution", { institutionName: "银行乙" });
  assert.equal((await (await app.request("session")).json()).turns.length, 0);
  await app.request("session/institution", { institutionName: "银行甲" });
  assert.equal((await (await app.request("session")).json()).turns.length, 2);
});

test("long questions pass the actual HTTP route and retain only a byte-level transport bound", async () => {
  const app = setup();
  await app.request("session/institution", { institutionName: "银行甲" });
  const question = "公司财务资料".repeat(4000);
  assert.equal((await app.request("session", { institutionName: "银行甲", question })).status, 202);
  const agent = app.sessions.get(creditAgentName(testUser.auth0Id, "银行甲"));
  assert.equal(agent.state.pendingQuestion, question);
  assert.equal((await app.request("session", { institutionName: "银行甲", question: "大".repeat(1024 * 1024) })).status, 413);
});

test("SSE milestones never re-expose historical private answers after a new unsigned submission", async () => {
  const app = setup();
  await app.request("session/institution", { institutionName: "银行甲" });
  await app.request("session", { institutionName: "银行甲", question: "保密审计报告.pdf" });
  const agent = app.sessions.get(creditAgentName(testUser.auth0Id, "银行甲"));
  await agent.answerQuestion(agent.jobs[0].payload);
  app.customers.set("银行甲", { ...app.customers.get("银行甲"), confidentialityStatus: false });
  await app.request("session", { institutionName: "银行甲", question: "年度报告.pdf" });
  const response = await app.request("session/events");
  const reading = response.text();
  await agent.answerQuestion(agent.jobs.at(-1).payload);
  const events = await reading;
  assert.equal(events.includes(privateDoc.id), false);
  assert.equal(events.includes("保密审计报告.pdf"), false);
  assert.match(events, /尚未签署保密协议/);
  assert.match(events, /"running":false/);
});

test("SSE sends stages and draft text immediately, reconnects to the running turn, and closes on completion", async () => {
  const app = setup();
  await app.request("session/institution", { institutionName: "银行甲" });
  await app.request("session", { institutionName: "银行甲", question: "年度报告.pdf" });
  const agent = app.sessions.get(creditAgentName(testUser.auth0Id, "银行甲"));
  const response = await app.request("session/events");
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  assert.match(decoder.decode((await reader.read()).value), /"running":true/);
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const realAnswer = globalThis.creditTestAnswer;
  globalThis.creditTestAnswer = async options => {
    options.progress("正在检索材料", "retrieval"); options.draft("公司资产"); await gate;
    return realAnswer(options);
  };
  const running = agent.answerQuestion(agent.jobs[0].payload);
  const stage = decoder.decode((await reader.read()).value);
  assert.match(stage, /"stage":"retrieval"/);
  assert.match(decoder.decode((await reader.read()).value), /event: draft[\s\S]*公司资产/);
  await reader.cancel();
  const reconnected = await app.request("session/events");
  const restored = reconnected.body.getReader();
  assert.match(decoder.decode((await restored.read()).value), /"draftText":"公司资产"/);
  finish(); await running;
  let final = "";
  while (true) { const part = await restored.read(); if (part.done) break; final += decoder.decode(part.value); }
  assert.match(final, /"running":false/);
  assert.match(final, /年度报告.pdf/);
  assert.equal(agent.jobs.length, 1, "reconnect must not schedule a second answer");
});
