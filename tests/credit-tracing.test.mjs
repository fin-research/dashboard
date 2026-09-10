import assert from "node:assert/strict";
import test from "node:test";
import { CreditTrace } from "../src/lib/server/credit-tracing.ts";
import { answerCreditQuestion } from "../src/lib/server/credit-assistant.ts";
import { AiGatewayResponseError, generateAiGatewayObject } from "../src/lib/server/ai-gateway.ts";
import { recordingCreditTracing } from "./helpers/credit-trace-recorder.mjs";

const identity = { agentId: "a".repeat(64), conversationId: "ba6f6333-62dc-49d9-a35b-000000000001", runId: "ba6f6333-62dc-49d9-a35b-000000000002" };
const credentials = { accountId: "test", gatewayId: "default", token: "secret-test-token" };
const customer = { name: "敏感客户名称", confidentialityStatus: true, reportDate: "2026-09-10" };
const doc = { id: "b".repeat(24), title: "敏感文件名称.pdf", relativePath: "定期报告/敏感文件名称.pdf", originalKey: "originals/定期报告/敏感文件名称.pdf",
  authority: "audited", bytes: 1, sha256: "b".repeat(64), modifiedAt: "2026-09-10", blockCount: 1, ocrCount: 0 };
const block = { id: "b-1", documentId: doc.id, text: "公司2025年，单位元。流动资产200，存货50，流动负债100。", locator: "PDF第1页", extraction: "text", searchKey: "search/b.md" };
const corpus = { version: "credit-document-v2", builtAt: "2026-09-10", documents: [doc], blocks: [block] };
const calculation = { label: "敏感计算标签", expression: "a/c", resultUnit: "倍", decimals: 2, inputs: [
  { name: "a", value: "200", unit: "元", sourceId: block.id, quote: "流动资产200" },
  { name: "c", value: "100", unit: "元", sourceId: block.id, quote: "流动负债100" },
] };
const quick = { ...calculation, expression: "(a-b)/c", inputs: [...calculation.inputs,
  { name: "b", value: "50", unit: "元", sourceId: block.id, quote: "存货50" }] };
const options = { question: "敏感问题：公司流动比率与速动比率", credentials, customer, corpus, history: [] };
const capture = () => { const recorded = recordingCreditTracing(); return { ...recorded, trace: new CreditTrace(recorded.tracing, identity) }; };
const snapshots = spans => spans.map(span => ({ name: span.name, attributes: span.attributes }));

test("iterative search, reading, individual and batch calculations share the turn identity and correct async parents; replay does not invent model calls", async () => {
  const recorded = capture();
  const values = new Map();
  const cache = { get: key => values.get(key), put: (key, value) => values.set(key, value) };
  const steps = [
    { action: "calculate", calculation },
    { action: "search_many", queries: ["补充定义", "附注口径"] },
    { action: "read", sourceIds: [doc.id] },
    { action: "calculate_answer", calculations: [calculation, quick], answer: { status: "complete", gaps: [], attachments: [],
      paragraphs: [{ text: "敏感答复：流动比率{{calc-2}}倍，速动比率{{calc-3}}倍。", citations: [
        { sourceId: "calc-2", quote: "{{calc-2}}" }, { sourceId: "calc-3", quote: "{{calc-3}}" },
      ] }] } },
  ];
  let modelCalls = 0, searches = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const generate = async (_credentials, _messages, schema, name, config) => {
    modelCalls++;
    config.onTelemetry({ status: 200, gatewayLogId: `gateway-${modelCalls}`, inputTokens: 100, outputTokens: 20, cachedInputTokens: 50, reasoningTokens: 10 });
    return schema.parse(name === "credit_scope" ? { inScope: true, queries: ["流动比率", "速动比率"], attachments: [] }
      : name === "credit_review" ? { approved: true, issues: [] } : { step: steps.shift() });
  };
  const semanticSearch = async () => { searches++; if (searches === 2) release(); await gate; return [block.searchKey]; };
  const answer = await recorded.trace.agent(() => answerCreditQuestion({ ...options, trace: recorded.trace, cache, generate, semanticSearch }));
  // Only calculations cited in the released answer are returned, but all runs are traced.
  assert.deepEqual(answer.calculations.map(item => item.result), ["2.00", "1.50"]);
  assert.equal(modelCalls, 6);
  assert.equal(searches, 4);
  const root = recorded.spans[0];
  assert.equal(root.name, "invoke_agent CreditAgent");
  const chats = recorded.spans.filter(span => span.name.startsWith("chat "));
  assert.equal(chats.length, modelCalls);
  assert.deepEqual(chats.map(span => span.attributes["credit.stage"]), ["scope", "decision", "decision", "decision", "decision", "review"]);
  assert.equal(chats.at(-1).attributes["credit.review_approved"], true);
  for (const span of chats) {
    assert.equal(span.parent, root);
    assert.equal(span.attributes["gen_ai.request.model"], "gpt-5.6-luna");
    assert.equal(span.attributes["gen_ai.usage.input_tokens"], 100);
    assert.equal(span.attributes["gen_ai.usage.output_tokens"], 20);
  }
  const rounds = recorded.spans.filter(span => span.name === "execute_tool search_many");
  assert.deepEqual(rounds.map(span => span.attributes["credit.search_round"]), [1, 2]);
  for (const round of rounds) {
    assert.equal(round.parent, root);
    const children = recorded.spans.filter(span => span.parent === round);
    assert.deepEqual(children.map(span => span.name), ["execute_tool search", "execute_tool search"]);
    assert.ok(children.every(child => recorded.spans.some(span => span.parent === child && span.name === "execute_tool ai_search")));
  }
  const batch = recorded.spans.find(span => span.name === "execute_tool calculate_batch");
  assert.equal(recorded.spans.filter(span => span.name === "execute_tool calculate").length, 3);
  assert.equal(batch.attributes["credit.calculation_count"], 2);
  assert.equal(recorded.spans.filter(span => span.parent === batch && span.name === "execute_tool calculate").length, 2);
  assert.ok(recorded.spans.some(span => span.name === "execute_tool read"));
  for (const span of recorded.spans) {
    assert.equal(span.ended, true);
    assert.equal(span.attributes["gen_ai.agent.name"], "CreditAgent");
    assert.equal(span.attributes["gen_ai.agent.id"], identity.agentId);
    assert.equal(span.attributes["gen_ai.conversation.id"], identity.conversationId);
    assert.equal(span.attributes["credit.run_id"], identity.runId);
    assert.ok(span.attributes["credit.duration_ms"] >= 0);
  }
  assert.doesNotMatch(JSON.stringify(snapshots(recorded.spans)), /敏感|secret-test-token|a\/c|流动资产|200，|PDF第|originals\/|gen_ai\.(input|output)\.messages/);

  const resumed = capture();
  const second = await resumed.trace.agent(() => answerCreditQuestion({ ...options, trace: resumed.trace, cache,
    generate: async () => { assert.fail("replay must reuse successful model checkpoints"); },
    semanticSearch: async () => { assert.fail("replay must reuse successful search checkpoints"); } }));
  assert.deepEqual(second.calculations, answer.calculations);
  assert.equal(resumed.spans.filter(span => span.name.startsWith("chat ")).length, 0);
  assert.equal(resumed.spans.filter(span => span.name === "execute_tool model_checkpoint").length, 6);
  assert.equal(resumed.spans.filter(span => span.name === "execute_tool ai_search").length, 0);
  assert.ok(resumed.spans.every(span => span.attributes["gen_ai.usage.input_tokens"] === undefined));
});

test("failed AI Search and lexical fallback are distinct nodes without exposing queries or errors", async () => {
  const recorded = capture();
  const answer = await recorded.trace.agent(() => answerCreditQuestion({ ...options, trace: recorded.trace,
    semanticSearch: async () => { throw new Error("敏感上游错误正文"); },
    generate: async (_c, _m, schema, name) => schema.parse(name === "credit_scope" ? { inScope: true, queries: ["公司2025"], attachments: [] }
      : { step: { action: "answer", answer: { status: "insufficient", paragraphs: [], attachments: [], gaps: ["待补充"] } } }),
  }));
  assert.equal(answer.status, "insufficient");
  const search = recorded.spans.find(span => span.name === "execute_tool search");
  assert.equal(search.attributes["credit.outcome"], "fallback");
  assert.equal(search.attributes["credit.fallback_reason"], "unavailable");
  assert.equal(recorded.spans.find(span => span.name === "execute_tool ai_search").attributes["credit.outcome"], "error");
  assert.ok(recorded.spans.some(span => span.name === "execute_tool lexical_search" && span.parent === search));
  assert.ok(recorded.spans.every(span => span.ended));
  assert.doesNotMatch(JSON.stringify(snapshots(recorded.spans)), /敏感|公司2025|待补充/);
});

test("429 closes model and turn spans, keeps the original error and single-attempt policy, and records safe metadata only", async () => {
  const recorded = capture();
  let calls = 0;
  await assert.rejects(recorded.trace.agent(() => answerCreditQuestion({ ...options, trace: recorded.trace,
    generate: (...args) => generateAiGatewayObject(...args, async () => {
      calls++;
      return Response.json({ error: { message: "敏感上游错误正文 secret-test-token" } }, { status: 429, headers: { "cf-aig-log-id": "gateway-busy" } });
    }),
  })), AiGatewayResponseError);
  assert.equal(calls, 1);
  assert.equal(recorded.spans.length, 2);
  for (const span of recorded.spans) {
    assert.equal(span.ended, true);
    assert.equal(span.attributes["error.type"], "model_busy");
    assert.equal(span.attributes["http.response.status_code"], 429);
    assert.equal(span.attributes["cloudflare.ai_gateway.log_id"], "gateway-busy");
    assert.equal(span.attributes["gen_ai.usage.input_tokens"], undefined);
  }
  assert.doesNotMatch(JSON.stringify(snapshots(recorded.spans)), /敏感|secret-test-token/);
});

test("a rejected batch closes all calculation spans and preserves atomic results for the next decision", async () => {
  const recorded = capture();
  let decisions = 0;
  await recorded.trace.agent(() => answerCreditQuestion({ ...options, trace: recorded.trace,
    semanticSearch: async () => [block.searchKey],
    generate: async (_c, messages, schema, name) => {
      if (name === "credit_scope") return schema.parse({ inScope: true, queries: ["流动资产"], attachments: [] });
      if (++decisions === 1) return schema.parse({ step: { action: "calculate_answer", calculations: [calculation,
        { ...quick, inputs: quick.inputs.map(input => input.name === "b" ? { ...input, value: "999" } : input) }],
      answer: { status: "complete", paragraphs: [], gaps: [], attachments: [] } } });
      assert.deepEqual(JSON.parse(messages.at(-1).content).calculations, []);
      return schema.parse({ step: { action: "answer", answer: { status: "insufficient", paragraphs: [], gaps: ["待确认"], attachments: [] } } });
    },
  }));
  const batch = recorded.spans.find(span => span.name === "execute_tool calculate_batch");
  assert.equal(batch.attributes["credit.outcome"], "error");
  const items = recorded.spans.filter(span => span.parent === batch);
  assert.deepEqual(items.map(span => span.attributes["credit.outcome"]), ["ok", "error"]);
  assert.ok(recorded.spans.every(span => span.ended));
  assert.doesNotMatch(JSON.stringify(snapshots(recorded.spans)), /敏感|999|流动资产|待确认/);
});

test("tracing failures before or after invocation and during attributes never replay, hide or fail business work", async () => {
  for (const mode of ["before", "after", "attributes", "twice"]) {
    let calls = 0;
    const runtime = { async enterSpan(_name, callback) {
      if (mode === "before") throw new Error("tracing unavailable");
      const span = { setAttribute() { if (mode === "attributes") throw new Error("tracing attribute failed"); } };
      const pending = callback(span);
      if (mode === "twice") await callback(span);
      await pending;
      throw new Error("tracing submit failed");
    } };
    const trace = new CreditTrace(runtime, identity);
    assert.equal(await trace.agent(() => { calls++; return "business result"; }), "business result");
    assert.equal(calls, 1);
    const businessError = new Error("original business error");
    await assert.rejects(trace.agent(() => { calls++; throw businessError; }), error => error === businessError);
    assert.equal(calls, 2);
  }
});

test("a model span stays open until streamed output processing and validation settle", async () => {
  const recorded = capture();
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const run = recorded.trace.agent(() => recorded.trace.chat({ "credit.stage": "decision" }, async () => {
    entered(); await gate; return "validated final result";
  }));
  await ready;
  assert.equal(recorded.spans[1].ended, false);
  assert.equal(recorded.spans[0].ended, false);
  release();
  assert.equal(await run, "validated final result");
  assert.ok(recorded.spans.every(span => span.ended));
});
