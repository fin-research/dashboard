import assert from "node:assert/strict";
import test from "node:test";
import { answerCreditQuestion, calculatedCreditDraft } from "../src/lib/server/credit-assistant.ts";
import { creditFailure, CreditExecutionError } from "../src/lib/server/credit-errors.ts";
import { AiGatewayResponseError } from "../src/lib/server/ai-gateway.ts";
import { creditCacheParts } from "../src/lib/server/credit-checkpoint.ts";
import { CreditEventHub } from "../src/lib/server/credit-events.ts";

const doc = { id: "public-report", title: "2025年公司年报.pdf", relativePath: "定期报告/2025年公司年报.pdf",
  originalKey: "originals/定期报告/2025年公司年报.pdf", sha256: "a".repeat(64), bytes: 1, authority: "audited", modifiedAt: "2026-09-10", blockCount: 1, ocrCount: 0 };
const text = "2025年合并口径，单位亿元：流动资产120，流动负债80，存货20。速动资产按流动资产扣除存货计算。";
const block = { id: "balance", documentId: doc.id, locator: "PDF第3页", text, extraction: "text", searchKey: "search/report.md" };
const corpus = { version: "credit-document-v2", builtAt: "2026-09-10", documents: [doc], blocks: [block] };
const customer = { name: "测试银行", confidentialityStatus: false, reportDate: "2026-09-10" };
const base = { corpus, customer, question: "2025年公司流动比率、速动比率是多少？", history: [], credentials: { accountId: "test", gatewayId: "test", token: "test" } };
const plan = { inScope: true, queries: ["2025流动资产", "2025流动负债", "2025速动比率口径"], attachments: [] };
const input = (name, value, sourceId) => ({ name, value, sourceId, quote: text, unit: "亿元" });
const attachmentAnswer = { status: "complete", paragraphs: [], gaps: [], attachments: [doc.id] };

test("two ratios need one batched calculation/answer decision; independent searches start together", async () => {
  const names = [], metrics = [], drafts = [];
  let active = 0, maxActive = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const answer = await answerCreditQuestion({ ...base, runId: "test-run", draft: text => drafts.push(text), operation: event => metrics.push(event),
    semanticSearch: async () => {
      active++; maxActive = Math.max(maxActive, active);
      if (active === 3) release();
      await gate; active--;
      return [{ key: block.searchKey, text }];
    },
    generate: async (_credentials, messages, schema, name, config) => {
      names.push(name);
      assert.equal(config.metadata.credit_run_id, "test-run");
      assert.equal(config.taskType, "credit_answer");
      if (name === "credit_scope") return schema.parse(plan);
      if (name === "credit_review") {
        const checked = JSON.parse(messages[1].content).answer;
        assert.equal(checked.paragraphs[0].text, "流动比率1.50倍，速动比率1.25倍。");
        assert.equal(checked.calculations.length, 2);
        assert.equal(checked.sources.length, 1);
        assert.ok(!JSON.stringify(checked).includes("{{calc-"));
        return schema.parse({ approved: true, issues: [] });
      }
      const evidence = JSON.parse(messages[2].content);
      assert.equal(evidence.sources.length, 1, "overlapping searches supply one complete passage");
      const sourceId = evidence.sources[0].id;
      return schema.parse({ step: { action: "calculate_answer", calculations: [
        { label: "流动比率", expression: "a/b", resultUnit: "倍", decimals: 2, inputs: [input("a", "120", sourceId), input("b", "80", sourceId)] },
        { label: "速动比率", expression: "(a-b)/c", resultUnit: "倍", decimals: 2, inputs: [input("a", "120", sourceId), input("b", "20", sourceId), input("c", "80", sourceId)] },
      ], answer: { status: "complete", paragraphs: [{ text: "流动比率{{calc-1}}倍，速动比率{{calc-2}}倍。", citations: [
        { sourceId: "calc-1", quote: "{{calc-1}}" }, { sourceId: "calc-2", quote: "{{calc-2}}" },
      ] }], gaps: [], attachments: [] } } });
    } });
  assert.equal(maxActive, 3);
  assert.deepEqual(names, ["credit_scope", "credit_step", "credit_review"]);
  assert.deepEqual(answer.calculations.map(calculation => calculation.result), ["1.50", "1.25"]);
  assert.equal(answer.files[0].id, doc.id);
  assert.ok(drafts.includes("流动比率1.50倍，速动比率1.25倍。"));
  assert.ok(metrics.every(event => event.durationMs >= 0));
  assert.ok(!JSON.stringify(metrics).includes(text));
});

test("pure material requests are routed directly without search or an answer/review round", async () => {
  let calls = 0;
  const answer = await answerCreditQuestion({ ...base, question: "请发2025年公司年报", semanticSearch: async () => assert.fail("no retrieval needed"),
    generate: async (_credentials, _messages, schema, name) => {
      calls++; assert.equal(name, "credit_scope");
      return schema.parse({ inScope: true, queries: [], attachments: [doc.id] });
    } });
  assert.equal(calls, 1); assert.equal(answer.files[0].id, doc.id);
});

test("three parallel queries share twelve complete evidence passages instead of tripling model context", async () => {
  const queryCounts = new Map();
  await answerCreditQuestion({ ...base, semanticSearch: async query => Array.from({ length: 12 }, (_, index) => ({ key: block.searchKey, text: `${query}: ${index}\n${text}` })),
    generate: async (_credentials, messages, schema, name) => {
      if (name === "credit_scope") return schema.parse(plan);
      const sources = JSON.parse(messages[2].content).sources;
      assert.equal(sources.length, 12);
      for (const source of sources) {
        assert.ok(source.text.endsWith(text));
        const query = source.text.split(":")[0]; queryCounts.set(query, (queryCounts.get(query) ?? 0) + 1);
      }
      return schema.parse({ step: { action: "answer", answer: attachmentAnswer } });
    } });
  assert.deepEqual([...queryCounts.values()], [4, 4, 4]);
});

test("repeated searches are cached, evidence is not duplicated, and a stalled run must finalize", async () => {
  let searches = 0, decisions = 0;
  await answerCreditQuestion({ ...base, semanticSearch: async () => { searches++; return [{ key: block.searchKey, text }]; },
    generate: async (_credentials, messages, schema, name) => {
      if (name === "credit_scope") return schema.parse({ ...plan, queries: ["流动资产"] });
      decisions++;
      const evidence = JSON.parse(messages[2].content);
      assert.equal(evidence.sources.length, 1);
      assert.equal(messages.length, 3);
      if (decisions < 3) return schema.parse({ step: { action: "search", query: " 流动资产 " } });
      assert.equal(evidence.finalizeOnly, true);
      assert.equal(schema.safeParse({ step: { action: "search", query: "again" } }).success, false);
      return schema.parse({ step: { action: "answer", answer: attachmentAnswer } });
    } });
  assert.equal(searches, 1); assert.equal(decisions, 3);
});

test("an unavailable semantic service is tried only once per run, then local evidence remains usable", async () => {
  let searches = 0, decisions = 0;
  const answer = await answerCreditQuestion({ ...base, semanticSearch: async () => { searches++; throw new Error("offline"); },
    generate: async (_credentials, _messages, schema, name) => {
      if (name === "credit_scope") return schema.parse({ ...plan, queries: ["流动资产"] });
      return schema.parse({ step: ++decisions === 1 ? { action: "search_many", queries: ["流动负债", "存货"] } : { action: "answer", answer: attachmentAnswer } });
    } });
  assert.equal(searches, 1); assert.match(answer.warnings.join(""), /全文/);
});

test("document reads provide relevant original text immediately instead of requiring another directory lookup", async () => {
  let decisions = 0;
  await answerCreditQuestion({ ...base, generate: async (_credentials, messages, schema, name) => {
    if (name === "credit_scope") return schema.parse({ ...plan, queries: ["missing"] });
    if (++decisions === 1) return schema.parse({ step: { action: "read", sourceIds: [doc.id] } });
    const evidence = JSON.parse(messages[2].content);
    assert.equal(evidence.sources[0].text, text);
    assert.equal(evidence.toolResults[0].directory[0].sourceId, block.id);
    return schema.parse({ step: { action: "answer", answer: attachmentAnswer } });
  } });
});

test("two failed independent reviews stop immediately without spending the remaining decision budget", async () => {
  let decisions = 0, reviews = 0;
  const drafts = [];
  const answer = await answerCreditQuestion({ ...base, draft: draft => drafts.push(draft), generate: async (_credentials, _messages, schema, name) => {
    if (name === "credit_scope") return schema.parse(plan);
    if (name === "credit_review") { reviews++; return schema.parse({ approved: false, issues: ["口径不符"] }); }
    decisions++;
    return schema.parse({ step: { action: "answer", answer: { ...attachmentAnswer, paragraphs: [{ text: "不支持的结论", citations: [{ sourceId: block.id, quote: text }] }] } } });
  } });
  assert.equal(decisions, 2); assert.equal(reviews, 2);
  assert.equal(answer.status, "insufficient"); assert.deepEqual(answer.paragraphs, []);
  assert.match(answer.gaps[0], /两次证据复核/); assert.equal(drafts.at(-1), "");
});

test("unknown calculation placeholders fail closed", () => {
  assert.throws(() => calculatedCreditDraft({ ...attachmentAnswer, paragraphs: [{ text: "{{calc-99}}", citations: [] }] }, []), /不存在/);
});

test("a batch with an unsupported input does not commit even its valid first result", async () => {
  let decisions = 0;
  await answerCreditQuestion({ ...base, generate: async (_credentials, messages, schema, name) => {
    if (name === "credit_scope") return schema.parse({ ...plan, queries: ["流动资产"] });
    if (++decisions === 1) return schema.parse({ step: { action: "calculate_answer", calculations: ["120", "999"].map(value => ({
      label: "流动比率", expression: "a/b", resultUnit: "倍", decimals: 2, inputs: [input("a", value, block.id), input("b", "80", block.id)],
    })), answer: attachmentAnswer } });
    const evidence = JSON.parse(messages[2].content);
    assert.deepEqual(evidence.calculations, []);
    assert.match(evidence.toolResults[0].error, /数值不在/);
    return schema.parse({ step: { action: "answer", answer: { status: "insufficient", paragraphs: [], attachments: [], gaps: ["需补充核对"] } } });
  } });
  assert.equal(decisions, 2);
});

test("batch calculations cannot access a restricted source even when the model invents its ID", async () => {
  const privateDoc = { ...doc, id: "private-doc", title: "内部数据.pdf", relativePath: "内部材料/内部数据.pdf", originalKey: "originals/内部材料/内部数据.pdf" };
  const privateBlock = { ...block, id: "private-source", documentId: privateDoc.id };
  const answer = await answerCreditQuestion({ ...base, corpus: { ...corpus, documents: [doc, privateDoc], blocks: [block, privateBlock] },
    generate: async (_credentials, messages, schema, name) => {
      assert.ok(!JSON.stringify(messages).includes("内部数据"));
      if (name === "credit_scope") return schema.parse({ ...plan, queries: ["流动资产"] });
      assert.equal(name, "credit_step");
      return schema.parse({ step: { action: "calculate_answer", calculations: [{ label: "比率", expression: "a/b", resultUnit: "倍", decimals: 2,
        inputs: [input("a", "120", privateBlock.id), input("b", "80", privateBlock.id)] }], answer: attachmentAnswer } });
    } });
  assert.equal(answer.disclosure.blocked, true);
  assert.deepEqual(answer.calculations, []); assert.deepEqual(answer.files, []);
});

test("an answer that must become a fixed NDA refusal skips unnecessary model review", async () => {
  const privateDoc = { ...doc, id: "private-doc", title: "内部数据.pdf", relativePath: "内部材料/内部数据.pdf", originalKey: "originals/内部材料/内部数据.pdf" };
  const privateBlock = { ...block, id: "private-source", documentId: privateDoc.id };
  let calls = 0;
  const answer = await answerCreditQuestion({ ...base, corpus: { ...corpus, documents: [doc, privateDoc], blocks: [block, privateBlock] },
    generate: async (_credentials, _messages, schema, name) => {
      calls++;
      if (name === "credit_scope") return schema.parse({ ...plan, queries: ["流动资产"] });
      assert.equal(name, "credit_step", "no review call for a fixed refusal");
      return schema.parse({ step: { action: "answer", answer: { status: "partial", paragraphs: [{ text: "流动资产120亿元", citations: [{ sourceId: block.id, quote: text }] }],
        gaps: ["缺少进一步口径"], attachments: [] } } });
    } });
  assert.equal(calls, 2); assert.equal(answer.disclosure.blocked, true);
  assert.deepEqual(answer.paragraphs, []);
});

test("failure messages distinguish upstream failures from material/deadline issues without exposing details", () => {
  for (const [status, message, code] of [[429, "token=secret", "model_busy"], [504, "timeout", "model_timeout"], [403, "private body", "model_configuration"], [200, "bad JSON", "model_output"], [502, "secret", "model_unavailable"]]) {
    const failure = creditFailure(new AiGatewayResponseError({ provider: "custom-codex", status, gatewayLogId: "log", retryable: true, message }));
    assert.equal(failure.code, code); assert.doesNotMatch(failure.message, /secret|private body|bad JSON/);
  }
  assert.equal(creditFailure(new CreditExecutionError("deadline", "private")).code, "deadline");
  assert.equal(creditFailure(new CreditExecutionError("materials", "private")).code, "materials");
});

test("a resumed run reuses successful model and search checkpoints but not an interrupted model result", async () => {
  const stored = new Map();
  const cache = { get: key => stored.get(key), put: (key, value) => stored.set(key, value) };
  const operations = [];
  const interrupted = new Error("Durable Object reset because its code was updated."); interrupted.name = "SqlError";
  await assert.rejects(answerCreditQuestion({ ...base, cache, semanticSearch: async () => [{ key: block.searchKey, text }],
    generate: async (_credentials, _messages, schema, name) => {
      if (name === "credit_scope") return schema.parse({ ...plan, queries: ["流动资产"] });
      throw interrupted;
    } }), { name: "SqlError" });
  let calls = 0;
  const resumed = await answerCreditQuestion({ ...base, cache, operation: operation => operations.push(operation),
    semanticSearch: async () => assert.fail("successful search must not be sent again"),
    generate: async (_credentials, _messages, schema, name) => {
      calls++; assert.equal(name, "credit_step");
      return schema.parse({ step: { action: "answer", answer: attachmentAnswer } });
    } });
  assert.equal(calls, 1); assert.equal(resumed.files[0].id, doc.id);
  assert.ok(operations.some(operation => operation.operation === "scope" && operation.outcome === "cache"));
  assert.ok(operations.some(operation => operation.operation === "search" && operation.outcome === "cache"));
});

test("recovery retains the original total deadline", async () => {
  await assert.rejects(answerCreditQuestion({ ...base, startedAt: Date.now() - 12 * 60_000,
    generate: async () => assert.fail("must not start another model budget") }), { code: "deadline" });
});

test("a completed review checkpoint is reusable after a restart despite the new completion timestamp", async t => {
  t.mock.timers.enable({ apis: ["Date"] });
  const stored = new Map();
  const cache = { get: key => stored.get(key), put: (key, value) => stored.set(key, value) };
  const first = await answerCreditQuestion({ ...base, cache, generate: async (_credentials, _messages, schema, name) => {
    if (name === "credit_scope") return schema.parse({ ...plan, queries: ["流动资产"] });
    if (name === "credit_review") return schema.parse({ approved: true, issues: [] });
    return schema.parse({ step: { action: "answer", answer: { ...attachmentAnswer, paragraphs: [{ text: "流动资产120亿元", citations: [{ sourceId: block.id, quote: text }] }] } } });
  } });
  t.mock.timers.tick(1000);
  const second = await answerCreditQuestion({ ...base, cache, generate: async () => assert.fail("all model results have already been checkpointed") });
  assert.deepEqual(second.paragraphs, first.paragraphs);
  assert.notEqual(second.createdAt, first.createdAt);
});

test("checkpoint chunks preserve Unicode and remain small enough for SQL values", () => {
  const text = "a".repeat(15999) + "😀中文".repeat(20000);
  const parts = creditCacheParts(text);
  assert.equal(parts.join(""), text);
  assert.ok(parts.every(part => new TextEncoder().encode(part).length <= 48000));
  assert.ok(parts.every(part => !/[\uD800-\uDBFF]$/.test(part)));
});

test("an obsolete SSE instance closes on the next heartbeat so EventSource can reconnect", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const hub = new CreditEventHub();
  const response = hub.response({ turns: [], running: true, progress: "", error: null, startedAt: 0 }, () => { throw new Error("code updated"); });
  const reader = response.body.getReader();
  assert.equal((await reader.read()).done, false);
  t.mock.timers.tick(20_000);
  assert.equal((await reader.read()).done, true);
});
