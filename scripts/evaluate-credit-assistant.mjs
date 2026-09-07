import { readFile, writeFile, mkdir } from "node:fs/promises";
import { answerCreditQuestion } from "../src/lib/server/credit-assistant.ts";
import { corpusSchema, customerAnswerText } from "../src/lib/credit-assistant/types.ts";
import { cloudflareClient } from "./credit-cloudflare-client.mjs";
import { withPostgres } from "../src/lib/server/postgres.ts";
import { findCreditCustomers } from "../src/lib/server/credit-repository.ts";

const cases = [
  { id: "material", question: "请提供东方财富证券2025年度审计报告。" },
  { id: "capital", question: "2025年公司吸收投资收到的现金30.90亿元，主要是吸收哪里的投资？请核对主体、金额和用途分类，给出可向客户提供的答复和来源。" },
  { id: "borrowing", question: "2025年公司取得借款收到的现金50亿元，主要是什么用途，哪里借入的？请给出准确来源，材料未披露的不要推断。" },
  { id: "calculation", question: "2025年公司现金增资中，计入实收资本和资本公积分别占增资款的比例是多少？请计算并列明来源和公式。" },
];
const selected = process.argv.find(a => a.startsWith("--case="))?.slice(7);
if (selected && !cases.some(c => c.id === selected)) throw new Error("未知用例：" + selected);
const baseArgument = process.argv.find(a => a.startsWith("--base-url="))?.slice(11);
const base = baseArgument ? new URL(baseArgument).origin : undefined;
const institutionName = process.argv.find(a => a.startsWith("--institution="))?.slice(14);
if (!institutionName) throw new Error("请使用 --institution=授信库中的机构名称，验收也必须核对真实保密协议状态");
if (!base && !process.env.CF_AIG_TOKEN) throw new Error("本地验收需要 CF_AIG_TOKEN；线上验收使用 --base-url=https://eastmoney.hasbai.xyz");
const config = base ? undefined : JSON.parse(await readFile("wrangler.jsonc", "utf8"));
const corpus = base ? undefined : corpusSchema.parse(JSON.parse(await readFile(".credit-local/corpus/corpus.json", "utf8")));
const request = base ? undefined : await cloudflareClient();
const customer = base ? undefined : await withPostgres(process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE ?? process.env.DATABASE_URL,
  "credit-evaluation", async client => (await findCreditCustomers(client, institutionName, true))[0]);
if (!base && !customer) throw new Error("最新授信记录中没有该机构");
await mkdir(".credit-local/evaluations", { recursive: true });
for (const item of cases.filter(c => !selected || selected === c.id)) {
  const started = Date.now();
  const progress = phase => console.log(JSON.stringify({ case: item.id, phase }));
  progress("started");
  let result;
  try {
    result = base ? await evaluateHttp(item, progress) : { answer: await answerCreditQuestion({ question: item.question, corpus, customer, history: [],
      credentials: { accountId: config.vars.CLOUDFLARE_ACCOUNT_ID, gatewayId: config.vars.AI_GATEWAY_ID, token: process.env.CF_AIG_TOKEN },
      progress,
      semanticSearch: async query => {
        const response = await (await request("/ai-search/namespaces/default/instances/credit/search", { method: "POST",
          headers: { "content-type": "application/json" }, body: JSON.stringify({ query, ai_search_options: {
            retrieval: { retrieval_type: "hybrid", max_num_results: 50 }, query_rewrite: { enabled: false }, cache: { enabled: false },
          } }) })).json();
        return (response.result?.chunks ?? []).map(c => ({ key: c.item.key, text: c.text }));
      },
    }) };
  } catch (error) {
    result = { error: error instanceof Error ? error.message : "验收失败" };
  }
  const prefix = `.credit-local/evaluations/${item.id}${base ? "-production" : ""}`;
  await writeFile(prefix + ".json", JSON.stringify({ question: item.question, ...result, elapsedMs: Date.now() - started, evaluatedAt: new Date().toISOString() }, null, 2));
  if (result.error) {
    console.error(JSON.stringify({ case: item.id, error: result.error }));
    process.exitCode = 1;
    break; // Do not repeatedly consume requests when the provider is unavailable.
  }
  const { answer } = result;
  await writeFile(prefix + ".md", `# ${item.question}\n\n${customerAnswerText(answer)}\n`);
  console.log(JSON.stringify({ case: item.id, status: answer.status, sources: answer.sources.length, calculations: answer.calculations.length, elapsedMs: Date.now() - started }));
}

async function evaluateHttp(item, progress) {
  // No existing browser cookie is reused: every case creates an isolated evaluation session.
  const select = await fetch(base + "/api/credit-assistant/session/institution", { method: "POST",
    headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ institutionName }), signal: AbortSignal.timeout(45_000) });
  const selectedCookie = select.headers.get("set-cookie")?.split(";")[0];
  if (!select.ok || !selectedCookie) throw new Error("选择验收机构失败 HTTP " + select.status);
  await select.body?.cancel();
  const submit = await fetch(base + "/api/credit-assistant/session", { method: "POST",
    headers: { origin: base, cookie: selectedCookie, "content-type": "application/json" }, body: JSON.stringify({ question: item.question, institutionName }),
    signal: AbortSignal.timeout(45_000) });
  const cookie = submit.headers.get("set-cookie")?.split(";")[0];
  if (submit.status !== 202 || !cookie) throw new Error("创建验收会话失败 HTTP " + submit.status);
  await submit.body?.cancel();
  const deadline = Date.now() + 15 * 60_000;
  let last = "";
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    let state;
    try {
      const response = await fetch(base + "/api/credit-assistant/session", { headers: { cookie }, signal: AbortSignal.timeout(25_000) });
      if (!response.ok) throw new Error("读取验收会话失败 HTTP " + response.status);
      state = await response.json();
    } catch { continue; }
    if (state.progress !== last) { last = state.progress; progress(last); }
    if (!state.running) {
      const answer = state.turns.at(-1)?.answer;
      return state.error ? { error: state.error, state } : answer ? { answer } : { error: "任务结束但没有答复", state };
    }
  }
  throw new Error("真实问答验收等待超过 15 分钟，请在服务日志中检查任务状态");
}
