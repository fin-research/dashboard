import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { readSse, readResponsesStream } from "../src/lib/server/ai-stream.ts";
import { AiGatewayResponseError, generateAiGatewayObject } from "../src/lib/server/ai-gateway.ts";
import { creditDraftText } from "../src/lib/server/credit-draft.ts";
import { answerCreditQuestion, CREDIT_SCOPE_REFUSAL, CREDIT_SEARCH_TIMEOUT_MS } from "../src/lib/server/credit-assistant.ts";
import { creditQuestionSchema } from "../src/lib/credit-assistant/types.ts";
import { creditAgentName } from "../src/lib/server/credit-session.ts";

const encoder = new TextEncoder();
const credentials = { accountId: "test", gatewayId: "test", token: "test" };
const customer = { name: "测试银行", confidentialityStatus: false, reportDate: "2026-09-09" };
const doc = { id: "a".repeat(24), title: "年度报告.pdf", relativePath: "定期报告/年度报告.pdf", originalKey: "originals/定期报告/年度报告.pdf",
  sha256: "0".repeat(64), bytes: 10, authority: "audited", modifiedAt: "2026-09-09", blockCount: 1, ocrCount: 0 };
const corpus = { version: "credit-document-v2", builtAt: "2026-09-09", documents: [doc], blocks: [],
  searchFiles: [{ key: "search/report.md", documentId: doc.id, sha256: "0".repeat(64), bytes: 10, part: 1 }] };

const byteStream = text => new ReadableStream({ start(controller) {
  for (const byte of encoder.encode(text)) controller.enqueue(Uint8Array.of(byte));
  controller.close();
} });
const event = data => `data: ${JSON.stringify(data)}\r\n\r\n`;

test("SSE decoding preserves split Chinese UTF-8, CRLF, multiline events and trailing frames", async () => {
  const received = [];
  await readSse(byteStream(': heartbeat\r\nevent: draft\r\ndata: 第一行\r\ndata: 第二行\r\n\r\ndata: 尾帧'), value => received.push(value), 1000);
  assert.deepEqual(received, [{ event: "draft", data: "第一行\n第二行" }, { event: "message", data: "尾帧" }]);
  await assert.rejects(readSse(byteStream("data: oversized"), () => {}, 4), /size limit/);
});

test("Responses streaming delivers output before completion and excludes reasoning and commentary", async () => {
  let controller;
  const body = new ReadableStream({ start(value) { controller = value; } });
  const received = [];
  const complete = { status: "completed", output: [{ type: "message", phase: "final_answer", content: [{ type: "output_text", text: '{"ok":true}' }] }] };
  const pending = readResponsesStream(body, text => received.push(text), 10000);
  for (const value of [
    { type: "response.reasoning_summary_text.delta", delta: "private reasoning" },
    { type: "response.output_item.added", output_index: 0, item: { type: "message", phase: "commentary" } },
    { type: "response.output_text.delta", output_index: 0, delta: "tool preamble" },
    { type: "response.output_item.added", output_index: 1, item: { type: "message", phase: "final_answer" } },
    { type: "response.output_text.delta", output_index: 1, delta: '{"ok":' },
  ]) controller.enqueue(encoder.encode(event(value)));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(received, ['{"ok":']);
  controller.enqueue(encoder.encode(event({ type: "response.output_text.delta", output_index: 1, delta: "true}" })));
  controller.enqueue(encoder.encode(event({ type: "response.completed", response: complete })));
  controller.close();
  assert.deepEqual(await pending, complete);
  assert.equal(received.join(""), '{"ok":true}');
  await assert.rejects(readResponsesStream(byteStream(event({ type: "response.output_text.delta", delta: "partial" })), () => {}, 1000), /before response completion/);
});

test("streaming gateway uses the existing provider and validates the completed business schema", async () => {
  const deltas = [];
  const options = { taskType: "credit_answer", metadata: {}, promptCacheKey: "test-stream", requestTimeoutMs: 1000, onTextDelta: text => deltas.push(text) };
  const response = value => new Response(byteStream(event({ type: "response.output_text.delta", delta: JSON.stringify(value) })
    + event({ type: "response.completed", response: { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }] } })),
  { headers: { "content-type": "text/event-stream", "cf-aig-log-id": "stream-test" } });
  const output = await generateAiGatewayObject(credentials, [{ role: "user", content: "test" }], z.object({ ok: z.boolean() }), "test", options,
    async (url, init) => { assert.match(url, /custom-codex\/responses$/); assert.equal(JSON.parse(init.body).stream, true); return response({ ok: true }); });
  assert.deepEqual(output, { ok: true }); assert.equal(deltas.join(""), '{"ok":true}');
  await assert.rejects(generateAiGatewayObject(credentials, [], z.object({ ok: z.boolean() }), "test", options,
    async () => response({ ok: "wrong" })), /business schema/);
});

test("draft projection handles incomplete escaped strings without rendering tool JSON or citations", () => {
  assert.equal(creditDraftText('{"step":{"action":"read","sourceIds":["private"]}}'), "");
  const text = '公司现金为10亿元。\n报告含"括号"，路径不作链接。';
  const json = JSON.stringify({ step: { action: "answer", answer: { paragraphs: [{ text, citations: [{ sourceId: "private", quote: '不得出现："text":"伪造"' }] }] } } });
  assert.equal(creditDraftText(json), text);
  const prefix = '{"step":{"action":"answer","answer":{"paragraphs":[{"text":"现金';
  assert.equal(creditDraftText(prefix), "现金");
  assert.equal(creditDraftText(prefix + '\\u4e'), "现金");
  assert.equal(creditDraftText(prefix + '\\u4e00'), "现金一");
});

test("scope rejection returns the fixed message before retrieval or answer generation", async () => {
  let calls = 0;
  const answer = await answerCreditQuestion({ credentials, customer, corpus, history: [], question: "明天天气怎么样？",
    semanticSearch: async () => assert.fail("out-of-scope requests must not retrieve materials"),
    generate: async (_credentials, messages, schema, name) => {
      calls++; assert.equal(name, "credit_scope"); assert.equal(JSON.parse(messages[1].content).question, "明天天气怎么样？");
      return schema.parse({ inScope: false, queries: [], attachments: [] });
    } });
  assert.equal(calls, 1); assert.equal(answer.notice, CREDIT_SCOPE_REFUSAL);
  assert.deepEqual([answer.paragraphs, answer.files, answer.sources, answer.calculations], [[], [], [], []]);
});

test("related follow-ups reach the scope classifier with same-customer history", async () => {
  const prior = { status: "complete", paragraphs: [], gaps: [], attachments: [doc.id], files: [{ id: doc.id, title: doc.title, url: "/file" }],
    sources: [], calculations: [], warnings: [], corpusVersion: corpus.builtAt, createdAt: "2026-09-09",
    disclosure: { policyVersion: 1, institutionName: customer.name, documentIds: [doc.id], blocked: false } };
  const answer = await answerCreditQuestion({ credentials, customer, corpus, question: "再发一遍", history: [{ id: "before", question: "请发年度报告", answer: prior, createdAt: prior.createdAt }],
    generate: async (_credentials, messages, schema, name) => {
      if (name === "credit_scope") {
        assert.equal(JSON.parse(messages[1].content).history[0].files[0], doc.title);
        return schema.parse({ inScope: true, queries: [], attachments: [] });
      }
      return schema.parse({ step: { action: "answer", answer: { status: "complete", paragraphs: [], gaps: [], attachments: [doc.id] } } });
    } });
  assert.equal(answer.files[0].id, doc.id);
});

test("the answer model can still refuse an out-of-scope request after scope admission", async () => {
  const answer = await answerCreditQuestion({ credentials, customer, corpus, history: [], question: "授信报告以外的事情",
    generate: async (_credentials, _messages, schema, name) => schema.parse(name === "credit_scope" ? { inScope: true, queries: [], attachments: [] } : { step: { action: "refuse" } }) });
  assert.equal(answer.notice, CREDIT_SCOPE_REFUSAL);
});

test("AI Search source text streams as answer prose and supplies its original file card", async () => {
  const drafts = [], stages = [];
  const text = "公司资产100亿元。";
  const answer = await answerCreditQuestion({ credentials, customer, corpus, history: [], question: "公司资产多少？",
    progress: (_message, stage) => stages.push(stage), draft: text => drafts.push(text),
    semanticSearch: async () => [{ key: "search/report.md", text }],
    generate: async (_credentials, messages, schema, name, options) => {
      if (name === "credit_scope") return schema.parse({ inScope: true, queries: [], attachments: [] });
      if (name === "credit_review") return schema.parse({ approved: true, issues: [] });
      const source = JSON.parse(messages[2].content).sources[0];
      assert.equal(source.text, text);
      const step = { action: "answer", answer: { status: "complete", paragraphs: [{ text, citations: [{ sourceId: source.id, quote: text }] }], attachments: [], gaps: [] } };
      const serialized = JSON.stringify({ step });
      for (const delta of serialized) options.onTextDelta(delta);
      return schema.parse({ step });
    } });
  assert.ok(drafts.includes("公司")); assert.equal(drafts.at(-1), text);
  assert.ok(drafts.every(draft => !draft.includes("sourceId") && !draft.includes("search-")));
  assert.deepEqual(stages, ["scope", "retrieval", "analysis", "answer", "review"]);
  assert.equal(answer.files[0].id, doc.id); assert.equal(answer.sources[0].extraction, "ai_search");
});

test("questions longer than 3000 characters are accepted and sessions are stable per verified user and customer", () => {
  assert.equal(creditQuestionSchema.safeParse({ institutionName: customer.name, question: "公司财务资料".repeat(4000) }).success, true);
  assert.equal(creditQuestionSchema.safeParse({ institutionName: customer.name, question: "   " }).success, false);
  assert.equal(creditAgentName("auth0|test", "银行甲"), creditAgentName("auth0|test", " 银行甲 "));
  assert.notEqual(creditAgentName("auth0|test", "银行甲"), creditAgentName("auth0|test", "银行乙"));
  assert.notEqual(creditAgentName("auth0|test", "银行甲"), creditAgentName("auth0|test-other", "银行甲"));
  assert.equal(CREDIT_SEARCH_TIMEOUT_MS, 60_000);
});

test("multi-round retrieval and failed review report real activities, not premature completed answers", async () => {
  const stages = [], drafts = [];
  let stepIndex = 0, reviews = 0;
  const actions = ["search", "read", "answer", "search", "answer"];
  const text = "公司资产100亿元。";
  await answerCreditQuestion({ credentials, customer, corpus, history: [], question: "请核对公司资产",
    progress: (_message, stage) => stages.push(stage), draft: text => drafts.push(text),
    semanticSearch: async query => [{ key: "search/report.md", text: text + query }],
    generate: async (_credentials, messages, schema, name, options) => {
      if (name === "credit_scope") return schema.parse({ inScope: true, queries: [], attachments: [] });
      if (name === "credit_review") return schema.parse({ approved: ++reviews === 2, issues: reviews === 1 ? ["请再核实口径"] : [] });
      assert.equal(stages.at(-1), "analysis", "waiting for the next model action is analysis, not answer generation");
      const action = actions[stepIndex++];
      const source = JSON.parse(messages[2].content).sources[0];
      const step = action === "search" ? { action, query: reviews ? "合并范围附注" : "资产附注" } : action === "read" ? { action, sourceIds: [source.id] }
        : { action, answer: { status: "complete", paragraphs: [{ text, citations: [{ sourceId: source.id, quote: text }] }], attachments: [], gaps: [] } };
      if (action === "answer") options.onTextDelta(JSON.stringify({ step }));
      return schema.parse({ step });
    } });
  assert.equal(stages.filter(stage => stage === "retrieval").length, 3);
  assert.equal(stages.filter(stage => stage === "answer").length, 2);
  assert.equal(stages.filter(stage => stage === "review").length, 2);
  assert.ok(stages.includes("read"));
  assert.ok(drafts.slice(drafts.indexOf(text) + 1, -1).includes(""), "rejected draft is withdrawn before more work");
});

test("review provider failures stop the turn without silently retrying model requests", async () => {
  const names = [];
  await assert.rejects(answerCreditQuestion({ credentials, customer, corpus, history: [], question: "公司资产多少？",
    semanticSearch: async () => [{ key: "search/report.md", text: "资产100亿元。" }],
    generate: async (_credentials, messages, schema, name) => {
      names.push(name);
      if (name === "credit_scope") return schema.parse({ inScope: true, queries: [], attachments: [] });
      if (name === "credit_review") throw new AiGatewayResponseError({ provider: "custom-codex", status: 429, gatewayLogId: "test", retryable: true, message: "rate limited" });
      const source = JSON.parse(messages[2].content).sources[0];
      return schema.parse({ step: { action: "answer", answer: { status: "complete", paragraphs: [{ text: "资产100亿元。", citations: [{ sourceId: source.id, quote: source.text }] }], attachments: [], gaps: [] } } });
    } }), { status: 429 });
  assert.deepEqual(names, ["credit_scope", "credit_step", "credit_review"]);
});
