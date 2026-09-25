import assert from "node:assert/strict";
import test from "node:test";
import { creditQuestionSchema } from "../src/lib/credit-assistant/types.ts";
import { isPublicCreditDocument, loadCreditCorpus, searchResultEvidence } from "../src/lib/server/credit-evidence.ts";
import { creditAnswerForTurn } from "../src/lib/server/credit-links.ts";

const document = { id: "a".repeat(24), title: "年度报告.pdf", relativePath: "定期报告/年度报告.pdf",
  originalKey: "originals/定期报告/年度报告.pdf", sha256: "0".repeat(64), bytes: 100,
  authority: "audited", modifiedAt: "2026-09-07", blockCount: 1, ocrCount: 0 };
const block = { id: `${document.id}-1`, documentId: document.id, locator: "PDF第1页", extraction: "text",
  searchKey: "search/定期报告/年度报告.pdf.md", text: "公开现金10亿元。" };
const corpus = { version: "credit-document-v2", builtAt: "2026-09-07", documents: [document], blocks: [block],
  searchFiles: [{ key: block.searchKey, documentId: document.id, sha256: "0".repeat(64), bytes: 100, part: 1 }] };
const bucket = data => ({ get: async key => key === "credit/catalog/corpus.json" ? { size: 100, json: async () => data } : null });

test("only canonical 定期报告 paths enter the public corpus", async () => {
  assert.equal(isPublicCreditDocument(document), true);
  for (const relativePath of ["风控/审计.pdf", "定期报告备份/审计.pdf", "定期报告/../风控/报告.pdf",
    "定期报告//报告.pdf", "定期报告/报告.pdf\n", "定期报告/风控\\报告.pdf"]) {
    const candidate = { ...document, relativePath, originalKey: `originals/${relativePath}` };
    assert.equal(isPublicCreditDocument(candidate), false);
    await assert.rejects(loadCreditCorpus(bucket({ ...corpus, documents: [candidate] })), /非公开文件/);
  }
  assert.equal((await loadCreditCorpus(bucket(corpus))).documents.length, 1);
  await assert.rejects(loadCreditCorpus(bucket({ ...corpus, blocks: [{ ...block, documentId: "b".repeat(24) }] })), /非公开文件/);
  await assert.rejects(loadCreditCorpus(bucket({ ...corpus, searchFiles: [{ ...corpus.searchFiles[0], key: "search/内部/报告.md" }] })), /非公开文件/);
});

test("question API accepts ordinary text without an institution field", () => {
  assert.equal(creditQuestionSchema.safeParse({ question: "报告" }).success, true);
  assert.equal(creditQuestionSchema.safeParse({ question: "   " }).success, false);
  assert.equal(creditQuestionSchema.safeParse({ question: "报告", institutionName: "银行" }).success, false);
});

test("AI Search matches only catalog keys under the public directory", () => {
  const hits = searchResultEvidence(corpus, [
    { key: "credit/search/定期报告/年度报告.pdf.md", text: "公开现金10亿元。" },
    { key: "credit/search/风控/私有报告.pdf.md", text: "不应出现" },
  ]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].documentId, document.id);
  assert.equal(hits[0].searchKey, block.searchKey);
});

test("source and file links identify a turn without carrying institution state", () => {
  const answer = { files: [{ id: document.id, title: document.title, url: `/api/credit-assistant/files/${document.id}` }],
    sources: [{ id: block.id, url: `/api/credit-assistant/files/${document.id}#page=1` }] };
  const linked = creditAnswerForTurn(answer, "turn-1");
  assert.match(linked.files[0].url, /turnId=turn-1/);
  assert.doesNotMatch(linked.files[0].url, /institutionName|confidentiality/);
  assert.match(linked.sources[0].url, /#page=1$/);
});
