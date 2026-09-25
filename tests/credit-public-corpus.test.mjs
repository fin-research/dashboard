import assert from "node:assert/strict";
import test from "node:test";
import { creditQuestionSchema } from "../src/lib/credit-assistant/types.ts";
import { isPublicCreditDocument, loadCreditCorpus, searchResultEvidence } from "../src/lib/server/credit-evidence.ts";
import { creditAnswerForTurn } from "../src/lib/server/credit-links.ts";

const object = key => ({ key, size: 100, uploaded: new Date("2026-09-25T12:00:00Z"), httpEtag: "etag" });
const bucket = keys => ({ list: async () => ({ objects: keys.map(object), truncated: false }) });
const publicKey = "credit/public/2026半年报.pdf";

test("only direct public PDFs enter the live corpus", async () => {
  const corpus = await loadCreditCorpus(bucket([
    publicKey, "credit/public/", "credit/public/nested/private.pdf", "credit/catalog/corpus.json",
    "credit/originals/内部.pdf", "credit/public/notes.docx", "credit/public/../private.pdf",
  ]));
  assert.deepEqual(corpus.documents.map(document => document.originalKey), ["public/2026半年报.pdf"]);
  assert.equal(corpus.blocks.length, 0);
  assert.equal(isPublicCreditDocument(corpus.documents[0]), true);
  assert.equal(isPublicCreditDocument({ ...corpus.documents[0], originalKey: "originals/private.pdf" }), false);
  await assert.rejects(loadCreditCorpus(bucket(["credit/public/"])), /尚未上传/);
});

test("question API accepts ordinary text without an institution field", () => {
  assert.equal(creditQuestionSchema.safeParse({ question: "报告" }).success, true);
  assert.equal(creditQuestionSchema.safeParse({ question: "   " }).success, false);
  assert.equal(creditQuestionSchema.safeParse({ question: "报告", institutionName: "银行" }).success, false);
});

test("AI Search accepts PDF chunks only from listed public objects", async () => {
  const corpus = await loadCreditCorpus(bucket([publicKey]));
  const hits = searchResultEvidence(corpus, [
    { key: publicKey, text: "资产总计 426,403,159,812.34" },
    { key: "credit/search/内部.md", text: "不应出现" },
    { key: "credit/public/未上传.pdf", text: "不应出现" },
  ]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].documentId, corpus.documents[0].id);
  assert.equal(hits[0].searchKey, "public/2026半年报.pdf");
});

test("source and file links identify a turn without carrying institution state", async () => {
  const document = (await loadCreditCorpus(bucket([publicKey]))).documents[0];
  const answer = { files: [{ id: document.id, title: document.title, url: `/api/credit-assistant/files/${document.id}` }],
    sources: [{ id: "source-1", url: `/api/credit-assistant/files/${document.id}` }] };
  const linked = creditAnswerForTurn(answer, "turn-1");
  assert.match(linked.files[0].url, /turnId=turn-1/);
  assert.doesNotMatch(linked.files[0].url, /institutionName|confidentiality/);
});
