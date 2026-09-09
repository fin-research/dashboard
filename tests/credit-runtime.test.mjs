import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSse } from "../src/lib/server/ai-stream.ts";

const requireWrangler = createRequire(import.meta.resolve("wrangler"));
const { Miniflare, convertV4MiniflareOptions } = requireWrangler("miniflare");
const { build } = requireWrangler("esbuild");
const root = fileURLToPath(new URL("../", import.meta.url));

test("real Agents SQLite/alarm runtime streams across requests, persists and archives the fixed conversation", { timeout: 30000 }, async () => {
  const bundled = await build({ stdin: { contents: `
    export { CreditAgent } from './worker/credit-agent.ts';
    import { creditAssistantHttp } from './worker/credit-assistant-http.ts';
    export default { fetch(request, env) { return creditAssistantHttp(request, env,
      { id:'access-test', auth0Id:'auth0|test', email:'test@18.cn', issuedAt:0, expiresAt:9999999999 }); } };
  `, resolveDir: root, sourcefile: "credit-runtime-fixture.ts" }, bundle: true, write: false, format: "esm", platform: "node", target: "es2022",
    external: ["cloudflare:*", "node:*"], plugins: [{ name: "runtime-fixtures", setup(plugin) {
      plugin.onResolve({ filter: /(?:postgres|credit-assistant)\.ts$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /postgres\.ts$/, namespace: "fixture" }, () => ({ contents: `
        export async function withPostgres(_connection,_app,op) { return op({query:async(sql,values)=>({rows:sql.startsWith('SELECT')
          ? [{name:values[0],confidentialityStatus:false,reportDate:'2026-09-09'}] : []})}); }
      ` }));
      plugin.onLoad({ filter: /credit-assistant\.ts$/, namespace: "fixture" }, () => ({ contents: `
        import { env } from 'cloudflare:workers';
        export async function recoverQueuedCreditAnswers() {}
        export async function answerCreditQuestion(options) {
          await env.TEST_GATE.fetch('https://gate.test/ready');
          options.progress('正在检索材料','retrieval');
          options.draft('公司资产');
          await new Promise(resolve=>setTimeout(resolve,150));
          options.draft('公司资产100亿元。');
          options.progress('正在复核','review');
          await new Promise(resolve=>setTimeout(resolve,150));
          return {status:'complete',paragraphs:[{text:'公司资产100亿元。',citations:[]}],gaps:[],attachments:[],sources:[],calculations:[],files:[],warnings:[],
            corpusVersion:options.corpus.builtAt,createdAt:new Date().toISOString(),disclosure:{policyVersion:1,institutionName:options.customer.name,documentIds:[],blocked:false}};
        }
      ` }));
    } }] });
  let releaseGate;
  const gate = new Promise(resolve => { releaseGate = resolve; });
  const directory = await mkdtemp(join(tmpdir(), "credit-sse-runtime-"));
  const config = convertV4MiniflareOptions({ workers: [{ name: "credit-test", modules: true, script: bundled.outputFiles[0].text, compatibilityDate: "2026-08-20", compatibilityFlags: ["nodejs_compat"],
    durableObjects: { CREDIT_AGENT: { className: "CreditAgent", useSQLite: true } }, r2Buckets: ["CREDIT"],
    bindings: { HYPERDRIVE: { connectionString: "test" } }, serviceBindings: { TEST_GATE: async () => { await gate; return new Response("ready"); } } }] });
  const mf = new Miniflare({ ...config, resourcePersistencePath: directory });
  try {
    await (await mf.getR2Bucket("CREDIT")).put("catalog/corpus.json", JSON.stringify({ version: "credit-document-v2", builtAt: "2026-09-09", documents: [], blocks: [] }));
    const request = (path, body) => mf.dispatchFetch("https://test.example/api/credit-assistant/" + path, {
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}), headers: { origin: "https://test.example", "content-type": "application/json" },
    });
    const customer = { institutionName: "测试银行" };
    assert.equal((await request("session/institution", customer)).status, 200);
    assert.equal((await request("session", { ...customer, question: "公司资产多少？" })).status, 202);
    const response = await request("session/events?institutionName=" + encodeURIComponent(customer.institutionName));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/event-stream/);
    releaseGate();
    const events = [];
    await readSse(response.body, event => events.push({ type: event.event, data: JSON.parse(event.data) }), 100000);
    assert.ok(events.some(event => event.type === "draft" && event.data.text === "公司资产"));
    assert.ok(events.some(event => event.type === "session" && event.data.stage === "review"));
    assert.equal(events.at(-1).data.running, false);
    const read = () => request("session?institutionName=" + encodeURIComponent(customer.institutionName)).then(response => response.json());
    const saved = await read();
    assert.equal(saved.turns[0].answer.paragraphs[0].text, "公司资产100亿元。");
    const fresh = await request("session/new", customer);
    assert.equal(fresh.status, 200);
    assert.equal((await read()).turns.length, 0);
    // A second new-conversation action also succeeds: archive IDs and table
    // creation work in SQLite, rather than only in the mock Agent used by unit tests.
    assert.equal((await request("session/new", customer)).status, 200);
  } finally { releaseGate(); await mf.dispose(); await rm(directory, { recursive: true }); }
});
