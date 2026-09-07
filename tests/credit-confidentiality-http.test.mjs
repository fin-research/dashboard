import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { answerCreditQuestion } from "../src/lib/server/credit-assistant.ts";
import { CREDIT_NDA_REQUIRED } from "../src/lib/server/credit-confidentiality.ts";

// Execute the actual Worker handlers; replace only the Cloudflare runtime,
// database transport and model transport, not routing or disclosure logic.
const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const agents = moduleUrl(`export class Agent {
  constructor(ctx, env) { this.env = env; this.jobs = []; }
  get state() { return this._state ??= structuredClone(this.initialState); }
  setState(state) { this._state = state; }
  async schedule(_delay, callback, payload) { this.jobs.push({callback,payload}); }
  getQueues() { return []; }
} export async function getAgentByName(binding, name) { return binding.get(name); }`);
const postgres = moduleUrl("export async function withPostgres(_connection, _application, operation) { return operation(globalThis.creditTestClient); }");
const assistant = moduleUrl(`export { recoverQueuedCreditAnswers } from ${JSON.stringify(new URL("../src/lib/server/credit-assistant.ts", import.meta.url).href)};
export async function answerCreditQuestion(options) { return globalThis.creditTestAnswer(options); }`);
async function workerModule(file) {
  const url = new URL(`../worker/${file}`, import.meta.url);
  const source = (await readFile(url, "utf8")).replace(/from "([^"]+)"/g, (_match, specifier) => `from ${JSON.stringify(
    specifier === "agents" ? agents : specifier.endsWith("/postgres.ts") ? postgres : specifier.endsWith("/credit-assistant.ts") ? assistant : new URL(specifier, url).href)}`);
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

function setup() {
  const customers = new Map([["银行甲", { name: "银行甲", confidentialityStatus: "signed", reportDate: "2026-09-07" }],
    ["银行乙", { name: "银行乙", confidentialityStatus: "not_signed", reportDate: "2026-09-07" }]]);
  let unavailable = false;
  globalThis.creditTestClient = { query: async (sql, values) => {
    if (unavailable) throw new Error("database unavailable");
    return { rows: sql.startsWith("SELECT") ? [...customers.values()].filter(c => values[1] ? c.name === values[0] : c.name.includes(values[0])) : [] };
  } };
  globalThis.creditTestAnswer = options => answerCreditQuestion({ ...options, semanticSearch: undefined,
    generate: async (_credentials, _messages, schema) => schema.parse({ step: { action: "answer", answer: {
      status: "complete", paragraphs: [], gaps: [], attachments: [options.question.includes("保密") ? privateDoc.id : publicDoc.id],
    } } }) });
  const sessions = new Map();
  let originalReads = 0;
  const env = { HYPERDRIVE: { connectionString: "test" }, CREDIT: { get: async key => {
    if (key === "catalog/corpus.json") return { size: 100, json: async () => corpus };
    originalReads++;
    return { body: "file", size: 4, httpEtag: "test-etag", range: { offset: 0, length: 4 } };
  } }, CREDIT_AGENT: { get: name => {
    if (!sessions.has(name)) { const agent = new CreditAgent({}, env); agent.fetch = request => agent.onRequest(request); sessions.set(name, agent); }
    return sessions.get(name);
  } } };
  let cookie = "";
  async function request(path, body, method = body ? "POST" : "GET", options = {}) {
    const response = await creditAssistantHttp(new Request(origin + "/api/credit-assistant/" + path, {
      method, headers: { origin, cookie, "content-type": "application/json", ...options.headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }), env);
    if (response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie").split(";")[0];
    return response;
  }
  return { customers, sessions, request, setUnavailable: () => { unavailable = true; }, originalReads: () => originalReads };
}

test("HTTP selection, submit, signed private download and live revocation", async () => {
  const app = setup();
  assert.equal((await app.request("session", { question: "材料" })).status, 400);
  assert.equal((await app.request("session/institution", { institutionName: "不存在" })).status, 404);
  assert.equal((await app.request("session/institution", { institutionName: "银行甲", confidentialityStatus: "signed" })).status, 400);
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
  assert.equal((await app.request("session/institution", { institutionName: "银行乙" })).status, 409);
  app.customers.set("银行甲", { ...app.customers.get("银行甲"), confidentialityStatus: "not_signed" });
  const hidden = await (await app.request("session")).json();
  assert.equal(hidden.turns[0].answer.notice, CREDIT_NDA_REQUIRED);
  assert.deepEqual(hidden.turns[0].answer.files, []);
  const before = app.originalReads();
  assert.equal((await app.request(path, null, "HEAD")).status, 403);
  assert.equal((await app.request(path, null, "GET", { headers: { range: "bytes=0-2" } })).status, 403);
  assert.equal(app.originalReads(), before);
  await app.request("session/new", {}, "POST");
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

test("revocation during generation is checked before persisting a result", async () => {
  const app = setup();
  await app.request("session/institution", { institutionName: "银行甲" });
  await app.request("session", { institutionName: "银行甲", question: "保密审计报告.pdf" });
  const generate = globalThis.creditTestAnswer;
  globalThis.creditTestAnswer = async options => {
    const answer = await generate(options);
    app.customers.set("银行甲", { ...app.customers.get("银行甲"), confidentialityStatus: "not_signed" });
    return answer;
  };
  const agent = [...app.sessions.values()].find(s => s.jobs.length);
  await agent.answerQuestion(agent.jobs[0].payload);
  assert.equal(agent.state.turns[0].answer.notice, CREDIT_NDA_REQUIRED);
  assert.deepEqual(agent.state.turns[0].answer.files, []);
});

test("database failures fail closed, and POSTs cannot bypass same-origin validation", async () => {
  const app = setup();
  assert.equal((await app.request("session/institution", { institutionName: "银行甲" }, "POST", { headers: { origin: "https://other.example" } })).status, 403);
  await app.request("session/institution", { institutionName: "银行甲" });
  app.setUnavailable();
  assert.equal((await app.request("session")).status, 503);
  assert.equal((await app.request("files/" + privateDoc.id + "?turnId=anything")).status, 503);
  assert.equal(app.originalReads(), 0);
});
