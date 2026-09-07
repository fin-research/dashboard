import { readFile, writeFile, mkdir } from "node:fs/promises";
import { answerCreditQuestion } from "../src/lib/server/credit-assistant.ts";
import { corpusSchema, customerAnswerText } from "../src/lib/credit-assistant/types.ts";
import { cloudflareClient } from "./credit-cloudflare-client.mjs";

if (!process.env.CF_AIG_TOKEN) throw new Error("真实模型验收需要 CF_AIG_TOKEN；请使用 node --env-file=.dev.vars scripts/evaluate-credit-assistant.mjs");
const config = JSON.parse(await readFile("wrangler.jsonc", "utf8"));
const corpus = corpusSchema.parse(JSON.parse(await readFile(".credit-local/corpus/corpus.json", "utf8")));
const request = await cloudflareClient();
const cases = [
  { id: "material", question: "请提供东方财富证券2025年度审计报告。" },
  { id: "capital", question: "2025年公司吸收投资收到的现金30.90亿元，主要是吸收哪里的投资？请核对主体、金额和用途分类，给出可向客户提供的答复和来源。" },
  { id: "borrowing", question: "2025年公司取得借款收到的现金50亿元，主要是什么用途，哪里借入的？请给出准确来源，材料未披露的不要推断。" },
  { id: "calculation", question: "2025年公司现金增资中，计入实收资本和资本公积分别占增资款的比例是多少？请计算并列明来源和公式。" },
];
const selected = process.argv.find(a => a.startsWith("--case="))?.slice(7);
await mkdir(".credit-local/evaluations", { recursive: true });
for (const item of cases.filter(c => !selected || selected === c.id)) {
  const started = Date.now();
  console.log(JSON.stringify({ case: item.id, phase: "started" }));
  const answer = await answerCreditQuestion({ question: item.question, corpus, history: [],
    credentials: { accountId: config.vars.CLOUDFLARE_ACCOUNT_ID, gatewayId: config.vars.AI_GATEWAY_ID, token: process.env.CF_AIG_TOKEN },
    progress: phase => console.log(JSON.stringify({ case: item.id, phase })),
    semanticSearch: async query => {
      const result = await (await request("/ai-search/namespaces/default/instances/credit/search", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ query, ai_search_options: {
          retrieval: { retrieval_type: "hybrid", max_num_results: 50 }, query_rewrite: { enabled: false }, cache: { enabled: false },
        } }) })).json();
      return (result.result?.chunks ?? []).map(c => c.item.key);
    },
  });
  await writeFile(`.credit-local/evaluations/${item.id}.json`, JSON.stringify({ question: item.question, answer, elapsedMs: Date.now() - started }, null, 2));
  await writeFile(`.credit-local/evaluations/${item.id}.md`, `# ${item.question}\n\n${customerAnswerText(answer)}\n`);
  console.log(JSON.stringify({ case: item.id, status: answer.status, sources: answer.sources.length, calculations: answer.calculations.length, elapsedMs: Date.now() - started }));
}
