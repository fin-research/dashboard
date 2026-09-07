import { z } from "zod";

export const documentSchema = z.object({
  id: z.string(), title: z.string(), relativePath: z.string(), sha256: z.string(),
  bytes: z.number(), authority: z.enum(["audited", "disclosure", "internal", "historical_reply", "draft"]),
  originalKey: z.string(), modifiedAt: z.string(), blockCount: z.number(), ocrCount: z.number(),
});
export const blockSchema = z.object({
  id: z.string(), documentId: z.string(), locator: z.string(), text: z.string(),
  extraction: z.enum(["text", "ocr", "unreadable"]), searchKey: z.string(),
});
export const corpusSchema = z.object({
  version: z.literal("credit-extract-v1"), builtAt: z.string(),
  documents: z.array(documentSchema).max(500), blocks: z.array(blockSchema).max(30000),
});
export type CreditDocument = z.infer<typeof documentSchema>;
export type CreditBlock = z.infer<typeof blockSchema>;
export type CreditCorpus = z.infer<typeof corpusSchema>;
export const citationSchema = z.object({ sourceId: z.string(), quote: z.string().min(2).max(1000) });
export const calculationSchema = z.object({
  label: z.string().max(200), expression: z.string().max(300), resultUnit: z.string().max(40),
  decimals: z.number().int().min(0).max(8),
  inputs: z.array(z.object({ name: z.string().regex(/^[a-z]$/), value: z.string().max(50),
    unit: z.string().max(40), sourceId: z.string(), quote: z.string().min(2).max(1500) })).min(1).max(20),
});
export const answerSchema = z.object({
  status: z.enum(["complete", "partial", "insufficient"]),
  paragraphs: z.array(z.object({ text: z.string().min(1).max(2000),
    citations: z.array(citationSchema).min(1).max(8) })).max(10),
  gaps: z.array(z.string().max(800)).max(15),
  attachments: z.array(z.string()).max(12),
});
export type CreditAnswerDraft = z.infer<typeof answerSchema>;
export type CreditCalculation = z.infer<typeof calculationSchema> & { id: string; result: string };
export type CreditSource = CreditBlock & { title: string; authority: CreditDocument["authority"]; url: string };
export type CreditAnswer = CreditAnswerDraft & {
  sources: Array<Omit<CreditSource, "text" | "searchKey">>; calculations: CreditCalculation[];
  files: Array<{ id: string; title: string; url: string }>;
  corpusVersion: string; createdAt: string; warnings: string[];
};
export type CreditTurn = { id: string; question: string; answer: CreditAnswer; createdAt: string };
export type CreditSession = {
  turns: CreditTurn[]; running: boolean; progress: string; error: string | null; startedAt: number;
  pendingQuestion?: string;
};
export const stepSchema = z.object({ step: z.discriminatedUnion("action", [
  z.object({ action: z.literal("search"), query: z.string().min(1).max(500) }),
  z.object({ action: z.literal("read"), sourceIds: z.array(z.string()).min(1).max(12) }),
  z.object({ action: z.literal("calculate"), calculation: calculationSchema }),
  z.object({ action: z.literal("answer"), answer: answerSchema }),
]) });

export function customerAnswerText(answer: CreditAnswer): string {
  const ids = [...new Set(answer.paragraphs.flatMap(p => p.citations.map(c => c.sourceId)))];
  const paragraphs = answer.paragraphs.map(p => `${p.text}${p.citations.map(c => `[${ids.indexOf(c.sourceId) + 1}]`).join("")}`);
  if (answer.gaps.length) paragraphs.push(`尚需补充确认：\n${answer.gaps.map(x => `- ${x}`).join("\n")}`);
  if (answer.warnings.length) paragraphs.push(`资料说明：\n${answer.warnings.map(x => `- ${x}`).join("\n")}`);
  const refs = ids.map((id, i) => {
    const source = answer.sources.find(s => s.id === id);
    const calc = answer.calculations.find(c => c.id === id);
    return `[${i + 1}] ${source ? `${source.title}，${source.locator}` : calc ? `${calc.label}：${calc.expression} = ${calc.result} ${calc.resultUnit}；${calc.inputs.map(x => {
      const s = answer.sources.find(s => s.id === x.sourceId);
      return `${x.name}=${x.value}${x.unit}（${s?.title ?? x.sourceId}，${s?.locator ?? ""}）`;
    }).join("；")}` : id}`;
  });
  if (refs.length) paragraphs.push(`资料来源：\n${refs.join("\n")}`);
  if (answer.files.length) paragraphs.push(`随附材料：${answer.files.map(x => x.title).join("；")}`);
  return paragraphs.join("\n\n");
}
