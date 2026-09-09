import type { R2Bucket } from "@cloudflare/workers-types";
import { Decimal } from "decimal.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { corpusSchema, type CreditCorpus, type CreditBlock, type CreditCalculation,
  type CreditAnswerDraft, type CreditAnswer, type CreditSource, calculationSchema } from "../credit-assistant/types.ts";
import type { z } from "zod";

export async function loadCreditCorpus(bucket: R2Bucket): Promise<CreditCorpus> {
  const object = await bucket.get("catalog/corpus.json");
  if (!object) throw new Error("授信材料尚未导入");
  if (object.size > 24 * 1024 * 1024) throw new Error("材料索引超过上限，请拆分资料库");
  return corpusSchema.parse(await object.json());
}
export function normalized(text: string): string { return text.normalize("NFKC").replace(/\s+/g, ""); }
export function verifyQuote(source: CreditBlock | undefined, quote: string): void {
  if (!source || source.extraction === "unreadable" || !normalized(source.text).includes(normalized(quote))) {
    throw new Error("引用未对应已读取材料中的原文，请重新读取并逐字引用");
  }
}
function terms(query: string): string[] {
  const words = query.toLowerCase().match(/[a-z0-9.]+|[\u4e00-\u9fff]+/g) ?? [];
  return [...new Set(words.flatMap(w => /^[\u4e00-\u9fff]+$/.test(w) && w.length > 2
    ? [w, ...Array.from({ length: w.length - 1 }, (_, i) => w.slice(i, i + 2))] : [w]))];
}
function rankCreditBlocks(corpus: CreditCorpus, query: string): Array<{ block: CreditBlock; score: number }> {
  const tokens = terms(query);
  const documents = new Map(corpus.documents.map(d => [d.id, d]));
  return corpus.blocks.filter(b => b.extraction !== "unreadable").map(block => {
    const doc = documents.get(block.documentId)!;
    const title = doc.relativePath.toLowerCase();
    const body = block.text.toLowerCase();
    let score = tokens.reduce((sum, t) => sum + (body.includes(t) ? 1 : 0) + (title.includes(t) ? .4 : 0), 0);
    const year = query.match(/20\d{2}/)?.[0];
    if (year && title.includes(year)) score += 1.5;
    if (doc.authority === "audited" || doc.authority === "disclosure") score *= 1.15;
    if (doc.authority === "draft") score *= .7;
    return { block, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
}
export function lexicalSearch(corpus: CreditCorpus, query: string, limit = 16): CreditBlock[] {
  return rankCreditBlocks(corpus, query).slice(0, limit).map(x => x.block);
}
export type CreditSearchHit = { key: string; text: string; id?: string };
export function searchResultEvidence(corpus: CreditCorpus, hits: Array<CreditSearchHit | string>): CreditBlock[] {
  const found = new Map<string, CreditBlock>();
  for (const raw of hits.slice(0, 50)) {
    const hit = typeof raw === "string" ? { key: raw, text: "" } : raw;
    if (!hit.text.trim()) continue;
    const file = corpus.searchFiles?.find(f => f.key === hit.key);
    const documentId = file?.documentId ?? corpus.blocks.find(b => b.searchKey === hit.key)?.documentId;
    if (!documentId || !corpus.documents.some(d => d.id === documentId)) continue;
    const id = "search-" + bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([documentId, hit.key, hit.text])))).slice(0, 32);
    found.set(id, { id, documentId, text: hit.text, searchKey: hit.key,
      extraction: "ai_search", locator: "AI Search 检索片段" });
  }
  return [...found.values()].slice(0, 12);
}
export function isCreditOriginalKey(key: string): boolean {
  return key.startsWith("originals/") && /\.(pdf|docx?|xlsx?)$/i.test(key)
    && new TextEncoder().encode(key).byteLength <= 1024 && !/[\\\u0000-\u001f\u007f]/.test(key)
    && key.split("/").every(segment => segment !== "" && segment !== "." && segment !== "..");
}
export function sourceFor(corpus: CreditCorpus, block: CreditBlock): CreditSource {
  const doc = corpus.documents.find(d => d.id === block.documentId)!;
  const page = block.locator.match(/^PDF第(\d+)页/)?.[1];
  return { ...block, title: doc.title, authority: doc.authority,
    url: `/api/credit-assistant/files/${doc.id}${page ? `#page=${page}` : ""}` };
}

/** A bounded arithmetic parser: no eval, functions, property access, or model-generated code. */
export function arithmetic(expression: string, variables: Map<string, Decimal>): Decimal {
  const clean = expression.replace(/\s/g, "");
  const tokens = clean.match(/[a-z]|\d+(?:\.\d+)?|[()+*/-]/g) ?? [];
  if (tokens.join("") !== clean || tokens.length > 150) throw new Error("计算式只允许变量和四则运算");
  let cursor = 0;
  function atom(): Decimal {
    const token = tokens[cursor++];
    if (token === "-") return atom().negated();
    if (token === "+") return atom();
    if (token === "(") {
      const result = sum();
      if (tokens[cursor++] !== ")") throw new Error("计算括号不匹配");
      return result;
    }
    if (token && variables.has(token)) return variables.get(token)!;
    if (token && /^(0|1|100|10000|100000000)$/.test(token)) return new Decimal(token);
    throw new Error("计算变量缺少来源，常数仅允许单位换算因子");
  }
  function product(): Decimal {
    let value = atom();
    while (tokens[cursor] === "*" || tokens[cursor] === "/") {
      const op = tokens[cursor++]; const right = atom();
      if (op === "/" && right.isZero()) throw new Error("分母为零，不能计算");
      value = op === "*" ? value.mul(right) : value.div(right);
    }
    return value;
  }
  function sum(): Decimal {
    let value = product();
    while (tokens[cursor] === "+" || tokens[cursor] === "-") {
      const op = tokens[cursor++]; const right = product();
      value = op === "+" ? value.add(right) : value.sub(right);
    }
    return value;
  }
  const result = sum();
  if (cursor !== tokens.length || !result.isFinite() || result.abs().greaterThan("1e30")) throw new Error("无效计算结果");
  return result;
}
export function calculateCredit(input: z.infer<typeof calculationSchema>, opened: Map<string, CreditBlock>, id: string): CreditCalculation {
  const calc = calculationSchema.parse(input);
  const variables = new Map<string, Decimal>();
  for (const item of calc.inputs) {
    verifyQuote(opened.get(item.sourceId), item.quote);
    if (variables.has(item.name)) throw new Error("计算变量重复");
    const value = new Decimal(item.value.replaceAll(",", ""));
    const numbers = item.quote.normalize("NFKC").replace(/(?<=\d),(?=\d)/g, "").match(/-?\d+(?:\.\d+)?/g) ?? [];
    if (!numbers.some(n => new Decimal(n).equals(value))) throw new Error("计算输入数值不在所引用原文中");
    variables.set(item.name, value);
  }
  return { ...calc, id, result: arithmetic(calc.expression, variables).toFixed(calc.decimals) };
}

export function finalizeCreditAnswer(draft: CreditAnswerDraft, corpus: CreditCorpus,
  opened: Map<string, CreditBlock>, calculations: CreditCalculation[]): CreditAnswer {
  const ids = new Set<string>();
  const usedCalculations = new Set<string>();
  for (const paragraph of draft.paragraphs) {
    for (const citation of paragraph.citations) {
      const calc = calculations.find(c => c.id === citation.sourceId);
      if (calc) {
        if (!normalized(citation.quote).includes(normalized(calc.result))) throw new Error("计算引用必须包含工具结果");
        usedCalculations.add(calc.id);
        calc.inputs.forEach(i => ids.add(i.sourceId));
      } else {
        verifyQuote(opened.get(citation.sourceId), citation.quote);
        ids.add(citation.sourceId);
      }
    }
  }
  if (!draft.paragraphs.length && !draft.gaps.length && !draft.attachments.length) throw new Error("回答为空");
  const sources = [...ids].map(id => sourceFor(corpus, opened.get(id)!));
  const attachmentIds = [...new Set([...draft.attachments, ...sources.map(s => s.documentId)])];
  const files = attachmentIds.map(id => {
    const doc = corpus.documents.find(d => d.id === id);
    if (!doc) throw new Error("附件不存在于材料目录");
    return { id, title: doc.title, url: `/api/credit-assistant/files/${id}` };
  });
  const warnings: string[] = [];
  if (sources.some(s => s.extraction === "ocr" || s.extraction === "ai_search" && corpus.documents.find(d => d.id === s.documentId)?.ocrCount)) {
    warnings.push("部分来源包含扫描识别内容，涉及数值请对照所附原件复核。");
  }
  if (sources.some(s => s.authority === "draft")) warnings.push("部分材料标注待部门确认，相关内容应在确认后对外使用。");
  if (sources.some(s => s.authority === "historical_reply")) warnings.push("历史授信答复仅代表原答复时点，不能据此确认当前情况。");
  return { ...draft, attachments: attachmentIds, status: warnings.length || draft.gaps.length ? (draft.status === "insufficient" ? "insufficient" : "partial") : draft.status,
    sources: sources.map(({ text: _text, searchKey: _key, ...source }) => source),
    calculations: calculations.filter(c => usedCalculations.has(c.id)), files,
    warnings, corpusVersion: corpus.builtAt, createdAt: new Date().toISOString() };
}
