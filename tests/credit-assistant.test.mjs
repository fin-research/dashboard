import assert from "node:assert/strict";
import test from "node:test";
import { Decimal } from "decimal.js";
import { z } from "zod";
import { arithmetic, calculateCredit, finalizeCreditAnswer, lexicalSearch, verifyQuote, searchResultEvidence, isCreditOriginalKey } from "../src/lib/server/credit-evidence.ts";
import { answerCreditQuestion as runCreditQuestion, recoverQueuedCreditAnswers, CREDIT_SEARCH_TIMEOUT_MS } from "../src/lib/server/credit-assistant.ts";
import { generateAiGatewayObject } from "../src/lib/server/ai-gateway.ts";
import { customerAnswerText, stepSchema } from "../src/lib/credit-assistant/types.ts";

const answerCreditQuestion = options => runCreditQuestion({ ...options, generate: (...args) => args[3] === "credit_scope"
  ? Promise.resolve(args[2].parse({ inScope: true })) : options.generate(...args) });

const doc = { id: "a".repeat(24), title: "2025年审计报告.pdf", relativePath: "定期报告/2025年审计报告.pdf", sha256: "a".repeat(64), bytes: 123,
  authority: "audited", originalKey: "originals/定期报告/2025年审计报告.pdf", modifiedAt: "2026-01-01", blockCount: 2, ocrCount: 0 };
const blocks = [{ id: "a-1", documentId: doc.id, locator: "PDF第3页", text: "2025年合并报表，单位元。吸收投资收到的现金 3,090,000,000.00，2024年为0。", extraction: "text", searchKey: "search/a-1.md" },
  { id: "a-2", documentId: doc.id, locator: "PDF第4页", text: "股东甲现金增资30.90亿元，其中6.00亿元计入实收资本，24.90亿元计入资本公积。", extraction: "text", searchKey: "search/a-2.md" }];
const corpus = { version: "credit-extract-v1", builtAt: "2026-09-07", documents: [doc], blocks };
const opened = new Map(blocks.map(b => [b.id, b]));
const calculation = { label: "元换算亿元", expression: "a/100000000", resultUnit: "亿元", decimals: 2,
  inputs: [{ name: "a", value: "3090000000", unit: "元", sourceId: "a-1", quote: "吸收投资收到的现金 3,090,000,000.00" }] };
const draft = { status: "complete", paragraphs: [{ text: "2025年吸收投资收到现金30.90亿元。", citations: [{ sourceId: "calc-1", quote: "30.90" }] }], gaps: [], attachments: [doc.id] };
const customer = { name: "测试银行", confidentialityStatus: true, reportDate: "2026-09-07" };
const credentials = { accountId: "test", gatewayId: "default", token: "test-token" };

test("calculation retains exact decimal result and source inputs", () => {
  const result = calculateCredit(calculation, opened, "calc-1");
  assert.equal(result.result, "30.90");
  assert.equal(result.inputs[0].sourceId, "a-1");
  assert.equal(arithmetic("(a+b)/100", new Map([["a",new Decimal("0.1")],["b",new Decimal("0.2")]])).toString(), "0.003");
});
test("calculation rejects unsupported values, arbitrary code and zero denominators", () => {
  assert.throws(() => calculateCredit({ ...calculation, inputs: [{ ...calculation.inputs[0], value: "5000000000" }] }, opened, "calc-1"), /数值不在/);
  assert.throws(() => arithmetic("process.exit()", new Map()), /只允许/);
  assert.throws(() => arithmetic("a/0", new Map([["a", new Decimal(1)]])), /分母为零/);
  assert.throws(() => arithmetic("a+37", new Map([["a", new Decimal(1)]])), /缺少来源/);
});
test("citations reject fabricated source IDs, quotes and unreadable pages", () => {
  assert.throws(() => verifyQuote(undefined, "text"), /引用/);
  assert.throws(() => verifyQuote(blocks[0], "工商银行借入50亿元"), /引用/);
  assert.throws(() => verifyQuote({ ...blocks[0], extraction: "unreadable" }, "单位元"), /引用/);
  verifyQuote(blocks[0], "单位 元");
});
test("final answer resolves immutable attachments and calculation provenance", () => {
  const result = finalizeCreditAnswer(draft, corpus, opened, [calculateCredit(calculation, opened, "calc-1")]);
  assert.equal(result.sources[0].url, `/api/credit-assistant/files/${doc.id}#page=3`);
  assert.equal(result.sources[0].text, undefined);
  assert.match(customerAnswerText(result), /a=3090000000元/);
  assert.match(customerAnswerText(result), /2025年审计报告.pdf，PDF第3页/);
  assert.throws(() => finalizeCreditAnswer({ ...draft, attachments: ["../../private"] }, corpus, opened, [calculateCredit(calculation, opened, "calc-1")]), /附件不存在/);
});
test("OCR and unconfirmed documents cannot appear as fully verified answers", () => {
  const changed = { ...corpus, documents: [{ ...doc, authority: "draft" }], blocks: [{ ...blocks[0], extraction: "ocr" }] };
  const answer = finalizeCreditAnswer({ status: "complete", paragraphs: [{ text: "现金流数据见原文。", citations: [{ sourceId: "a-1", quote: "吸收投资收到的现金" }] }], gaps: [], attachments: [] }, changed, new Map([["a-1", changed.blocks[0]]]), []);
  assert.equal(answer.status, "partial"); assert.equal(answer.warnings.length, 2);
});
test("search finds Chinese terms and current report facts", () => {
  assert.equal(lexicalSearch(corpus, "2025年吸收投资收到的现金", 1)[0].id, "a-1");
});
test("agent calculates, validates and independently reviews before delivering", async () => {
  let calls = 0;
  const generate = async (_credentials, _messages, schema, name) => {
    calls++;
    if (name === "credit_review") return schema.parse({ approved: true, issues: [] });
    return schema.parse({ step: calls === 1 ? { action: "calculate", calculation } : { action: "answer", answer: draft } });
  };
  const answer = await answerCreditQuestion({ customer, question: "2025吸收投资现金换算亿元", corpus, history: [], credentials, generate,
    semanticSearch: async () => ["search/unknown.md"] });
  assert.equal(calls, 3); assert.equal(answer.calculations[0].result, "30.90");
});
test("review rejection requires correction; unverified invented claims never reach result", async () => {
  let modelSteps = 0;
  const generate = async (_credentials, _messages, schema, name) => {
    if (name === "credit_review") return schema.parse({ approved: false, issues: ["借款银行没有披露"] });
    modelSteps++;
    return schema.parse({ step: { action: "answer", answer: modelSteps === 1 ? {
      status: "complete", paragraphs: [{ text: "借款来自银行乙。", citations: [{ sourceId: "a-1", quote: "吸收投资收到的现金" }] }], gaps: [], attachments: [],
    } : { status: "insufficient", paragraphs: [], gaps: ["现有资料未披露具体借款银行。"], attachments: [] } } });
  };
  const answer = await answerCreditQuestion({ customer, question: "2025借款哪里借入", corpus, history: [], credentials, generate });
  assert.equal(answer.status, "insufficient"); assert.equal(answer.paragraphs.length, 0); assert.equal(modelSteps, 2);
});
test("credit model is pinned to codex with max effort and no provider fallback", async () => {
  const calls = [];
  await assert.rejects(generateAiGatewayObject(credentials, [{ role: "user", content: "test" }], z.object({ ok: z.boolean() }), "test",
    { taskType: "credit_answer", metadata: {}, promptCacheKey: "test", requestTimeoutMs: 1000 }, async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) }); return new Response("Unavailable", { status: 503 });
    }));
  assert.equal(calls.length, 1); assert.match(calls[0].url, /custom-codex\/responses$/);
  assert.equal(calls[0].body.model, "gpt-5.6-luna"); assert.equal(calls[0].body.reasoning.effort, "max");
});

test("slow semantic search does not block canonical lexical evidence", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let initialSources;
  const answerPromise = answerCreditQuestion({ customer, question: "2025吸收投资现金", corpus, history: [], credentials,
    semanticSearch: () => new Promise(() => {}),
    generate: async (_credentials, messages, schema) => {
      initialSources = JSON.parse(messages[2].content).sources;
      return schema.parse({ step: { action: "answer", answer: { status: "complete", paragraphs: [], gaps: [], attachments: [doc.id] } } });
    },
  });
  await Promise.resolve();
  t.mock.timers.tick(CREDIT_SEARCH_TIMEOUT_MS);
  const answer = await answerPromise;
  assert.ok(initialSources.some(s => s.id === "a-1"));
  assert.match(answer.warnings.join(""), /全文精确检索/);
  assert.equal(answer.files[0].id, doc.id);
});

test("follow-up questions retain prior attachments, evidence and calculations", async () => {
  const previous = { ...finalizeCreditAnswer(draft, corpus, opened, [calculateCredit(calculation, opened, "calc-1")]), disclosure: { policyVersion: 1, institutionName: customer.name, documentIds: [doc.id], blocked: false } };
  const history = [{ id: "previous", question: "请提供2025年审计报告及吸收投资现金数据", answer: previous, createdAt: previous.createdAt }];
  const answer = await answerCreditQuestion({ customer, question: "把刚才那份报告再发给我", corpus, history, credentials,
    generate: async (_credentials, messages, schema) => {
      const context = JSON.parse(messages[1].content);
      const prior = context.history[0];
      assert.equal(prior.question, history[0].question);
      assert.equal(prior.files[0].title, doc.title);
      assert.equal(prior.sources[0].id, "a-1");
      assert.equal(prior.calculations[0].result, "30.90");
      return schema.parse({ step: { action: "answer", answer: { status: "complete", paragraphs: [], gaps: [], attachments: [prior.files[0].id] } } });
    },
  });
  assert.equal(answer.files[0].url, `/api/credit-assistant/files/${doc.id}`);
  assert.equal(history.length, 1);
});

test("AI Search passages are directly citable and mapped to current original files", () => {
  const key = "search/定期报告/2025年度审计报告.pdf.md";
  const pages = [{ ...blocks[0], id: "cover", text: "2025年度审计报告封面", searchKey: key },
    { ...blocks[1], id: "late-note", locator: "PDF第102页", text: "关联方东方财富支付借款利息8,520,547.95元。", searchKey: key }];
  const whole = { ...corpus, version: "credit-document-v2", blocks: pages,
    searchFiles: [{ key, documentId: doc.id, bytes: 100, sha256: "b".repeat(64), part: 1 },
      { key: key + ".part-002.md", documentId: doc.id, bytes: 100, sha256: "c".repeat(64), part: 2 }] };
  const result = searchResultEvidence(whole, [{ key, text: "关联方东方财富支付借款利息8,520,547.95元。" }]);
  assert.equal(result[0].extraction, "ai_search");
  assert.equal(result[0].documentId, doc.id);
  assert.equal(searchResultEvidence(whole, [{ key: key + ".part-002.md", text: "关联方借款利息" }])[0].text, "关联方借款利息");
  assert.deepEqual(searchResultEvidence(whole, [{ key: "search/deleted.md", text: "伪造来源" }]), []);
  assert.equal(result[0].text, pages[1].text);
  const indexOnly = searchResultEvidence({ ...whole, blocks: [] }, [{ key, text: "直接来自索引的新增内容50亿元" }])[0];
  verifyQuote(indexOnly, "新增内容50亿元");
  const answer = finalizeCreditAnswer({ status: "complete", paragraphs: [{ text: "新增内容50亿元", citations: [{ sourceId: indexOnly.id, quote: "新增内容50亿元" }] }], gaps: [], attachments: [] },
    whole, new Map([[indexOnly.id, indexOnly]]), []);
  assert.equal(answer.files[0].id, doc.id);
  assert.equal(answer.sources[0].locator, "AI Search 检索片段");
});

test("original file keys preserve names while rejecting traversal and non-material paths", () => {
  assert.ok(isCreditOriginalKey("originals/定期报告/2025年度/公司报告.pdf"));
  assert.ok(isCreditOriginalKey("originals/业务/【请证投部&计财部确认】情况.docx"));
  for (const key of ["originals/../secret.pdf", "originals//报告.pdf", "originals/报告.pdf\n", "originals/报告\\a.pdf", "catalog/corpus.json", "originals/file.exe"]) assert.equal(isCreditOriginalKey(key), false);
});

test("a multi-row search chunk preserves every returned row and its numeric context", () => {
  const key = "search/财务报表.xlsx.md";
  const rows = [{ ...blocks[0], id: "borrowing-row", searchKey: key, text: "2025年 取得借款收到的现金 5000000000" },
    { ...blocks[1], id: "neighbor-row", searchKey: key, text: "2025年 分配股利利润或偿付利息支付的现金。筹资活动现金流出小计。支付其他与筹资活动有关的现金。" }];
  const text = rows.map(b => b.text).join("\n");
  const result = searchResultEvidence({ ...corpus, blocks: rows }, [{ key, text }]);
  assert.equal(result[0].text, text);
  assert.equal(result[0].documentId, doc.id);
});

test("credit tool decisions use the Responses-supported anyOf schema", () => {
  const json = z.toJSONSchema(stepSchema);
  assert.equal(json.properties.step.anyOf.length, 5);
  assert.equal(JSON.stringify(json).includes('"oneOf"'), false);
  assert.deepEqual(stepSchema.parse({ step: { action: "search", query: "借款" } }), { step: { action: "search", query: "借款" } });
  assert.equal(stepSchema.safeParse({ step: { action: "calculate", query: "借款" } }).success, false);
});

test("interrupted legacy work is removed only after a durable recovery is scheduled", async () => {
  const payload = { id: "12345678-1234-4123-8123-123456789abc", question: "请提供报告" };
  const job = { id: "queue-1", callback: "answerQuestion", payload };
  const events = [];
  await recoverQueuedCreditAnswers([job, { ...job, id: "unrelated", callback: "other" }, { ...job, payload: {} }],
    async value => events.push({ scheduled: value }), id => events.push({ removed: id }));
  assert.deepEqual(events, [{ scheduled: payload }, { removed: "queue-1" }]);
  await assert.rejects(recoverQueuedCreditAnswers([job], async () => { throw new Error("alarm unavailable"); },
    () => assert.fail("must retain the old queue row")), /alarm unavailable/);
});

test("credit work stops within its overall execution budget", async t => {
  t.mock.timers.enable({ apis: ["Date"] });
  let calls = 0;
  const result = await answerCreditQuestion({ customer, question: "查找现金流数据", corpus, history: [], credentials,
    generate: async (_credentials, _messages, schema) => {
      calls++;
      t.mock.timers.tick(12 * 60_000);
      return schema.parse({ step: { action: "read", sourceIds: ["a-1"] } });
    } });
  assert.equal(calls, 1);
  assert.equal(result.status, "insufficient");
});
