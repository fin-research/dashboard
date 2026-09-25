import type { CreditAnswer } from "../credit-assistant/types.ts";

export function creditAnswerForTurn(answer: CreditAnswer, turnId: string): CreditAnswer {
  const urlFor = (url: string) => {
    const parsed = new URL(url, "https://credit.invalid");
    parsed.searchParams.set("turnId", turnId);
    return parsed.pathname + parsed.search + parsed.hash;
  };
  return { ...answer, files: answer.files.map(file => ({ ...file, url: urlFor(file.url) })),
    sources: answer.sources.map(source => ({ ...source, url: urlFor(source.url) })) };
}
