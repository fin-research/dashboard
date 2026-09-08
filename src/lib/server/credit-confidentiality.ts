import type { CreditAnswer, CreditCorpus, CreditCustomer, CreditDocument, CreditSession, CreditTurn } from "../credit-assistant/types.ts";

export const CREDIT_NDA_REQUIRED = "该机构尚未签署保密协议，请提交授信流程签署保密协议之后方可提供该数据。";
export const CREDIT_CUSTOMER_REQUIRED = "请先输入客户名称并从列表中选择机构。";

export function isPublicCreditDocument(doc: CreditDocument): boolean {
  // Neither an audited label nor a client-supplied flag confers public status.
  const parts = doc.relativePath.split("/");
  return parts.length >= 2 && parts[0] === "定期报告"
    && parts.every(p => p !== "" && p !== "." && p !== "..")
    && !/[\\\u0000-\u001f\u007f]/.test(doc.relativePath)
    && doc.originalKey === `originals/${doc.relativePath}`;
}

export function canProvideCreditDocument(doc: CreditDocument | undefined, customer: CreditCustomer | null): boolean {
  return !!doc && (isPublicCreditDocument(doc) || customer?.confidentialityStatus === true);
}

export function creditCorpusForCustomer(corpus: CreditCorpus, customer: CreditCustomer | null): CreditCorpus {
  const documents = corpus.documents.filter(d => canProvideCreditDocument(d, customer));
  const ids = new Set(documents.map(d => d.id));
  return { ...corpus, documents, blocks: corpus.blocks.filter(b => ids.has(b.documentId)),
    searchFiles: corpus.searchFiles?.filter(f => ids.has(f.documentId)) };
}

export function creditNdaRefusal(corpus: CreditCorpus, customer: CreditCustomer | null): CreditAnswer {
  return { status: "insufficient", paragraphs: [], gaps: [], attachments: [], sources: [], calculations: [], files: [],
    warnings: [], notice: customer ? CREDIT_NDA_REQUIRED : CREDIT_CUSTOMER_REQUIRED,
    corpusVersion: corpus.builtAt, createdAt: new Date().toISOString(),
    disclosure: { policyVersion: 1, institutionName: customer?.name ?? "", documentIds: [], blocked: true } };
}

export function canProvideCreditAnswer(answer: CreditAnswer, corpus: CreditCorpus, customer: CreditCustomer | null): boolean {
  const access = answer.disclosure;
  if (!customer || access?.policyVersion !== 1 || access.institutionName !== customer.name) return false;
  const ids = new Set([...access.documentIds, ...answer.sources.map(s => s.documentId), ...answer.attachments, ...answer.files.map(f => f.id)]);
  // Missing/deleted documents and legacy answers without access provenance fail closed.
  return [...ids].every(id => canProvideCreditDocument(corpus.documents.find(d => d.id === id), customer));
}

export function creditHistoryForCustomer(turns: CreditTurn[], corpus: CreditCorpus, customer: CreditCustomer): CreditTurn[] {
  // Do not pass even the old user question when its answer's evidence became restricted.
  return turns.filter(t => !t.answer.disclosure?.blocked && canProvideCreditAnswer(t.answer, corpus, customer));
}

export function discloseCreditSession(session: CreditSession, corpus: CreditCorpus, customer: CreditCustomer | null): CreditSession {
  if (!session.customer) return { ...session, turns: [], pendingQuestion: "", customer: null };
  return { ...session, customer, turns: session.turns.map(t => canProvideCreditAnswer(t.answer, corpus, customer) ? t :
    { ...t, question: "此前问题涉及受限材料", answer: creditNdaRefusal(corpus, customer) }) };
}

export function canDownloadCreditDocument(doc: CreditDocument, session: CreditSession | null, turnId: string | null): boolean {
  if (isPublicCreditDocument(doc)) return true;
  if (session?.customer?.confidentialityStatus !== true || !turnId) return false;
  const answer = session.turns.find(t => t.id === turnId)?.answer;
  return !!answer && answer.disclosure?.policyVersion === 1 && !answer.disclosure.blocked
    && answer.disclosure.institutionName === session.customer.name
    && (answer.files.some(f => f.id === doc.id) || answer.sources.some(s => s.documentId === doc.id));
}

export function creditAnswerForTurn(answer: CreditAnswer, turnId: string): CreditAnswer {
  const urlFor = (url: string) => {
    const parsed = new URL(url, "https://credit.invalid");
    parsed.searchParams.set("turnId", turnId);
    return parsed.pathname + parsed.search + parsed.hash;
  };
  return { ...answer, files: answer.files.map(f => ({ ...f, url: urlFor(f.url) })),
    sources: answer.sources.map(s => ({ ...s, url: urlFor(s.url) })) };
}
