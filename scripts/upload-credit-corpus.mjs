import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { corpusSchema } from "../src/lib/credit-assistant/types.ts";
import { cloudflareClient } from "./credit-cloudflare-client.mjs";

const directory = path.resolve(process.argv.find(x => x.startsWith("--directory="))?.split("=").slice(1).join("=") ?? ".credit-local/corpus");
const apply = process.argv.includes("--apply");
const corpus = corpusSchema.parse(JSON.parse(await readFile(path.join(directory, "corpus.json"), "utf8")));
const report = JSON.parse(await readFile(path.join(directory, "preparation-report.json"), "utf8"));
if (report.failures.length || report.unreadableBlocks) throw new Error("材料解析有失败或未识别页，请先修复");
const objects = [...corpus.documents.map(d => d.originalKey), ...corpus.blocks.map(b => b.searchKey)];
const sha = value => createHash("sha256").update(value).digest("hex");
console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", documents: corpus.documents.length, objects: objects.length, bucket: "credit" }));
if (!apply) process.exit(0);
const request = await cloudflareClient();
const instancePath = "/ai-search/namespaces/default/instances/credit";
const info = (await (await request(instancePath)).json()).result;
if (info.source !== "credit" || info.type !== "r2") throw new Error("AI Search credit 未连接 credit 存储桶");
await writeFile(path.join(directory, "search-instance-before.json"), JSON.stringify(info, null, 2));
const searchConfig = {
  source_params: { ...info.source_params, include_items: ["search/**", "/search/**"], exclude_items: ["originals/**", "/originals/**", "catalog/**", "/catalog/**"] },
  index_method: { vector: true, keyword: true }, indexing_options: { keyword_tokenizer: "trigram" },
  max_num_results: 50, cache: false, rewrite_query: false,
};
if (Object.entries(searchConfig).some(([key, value]) => JSON.stringify(info[key]) !== JSON.stringify(value))) {
  await (await request(instancePath, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(searchConfig) })).body?.cancel();
}
const checkpointFile = path.join(directory, "upload-checkpoint-v2.json");
const checkpoint = JSON.parse(await readFile(checkpointFile, "utf8").catch(() => "{}"));
let cursor = 0; let verified = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (cursor < objects.length) {
    const key = objects[cursor++];
    const bytes = await readFile(path.join(directory, key)); const digest = sha(bytes);
    if (checkpoint[key] !== digest) {
      const response = await request(`/r2/buckets/credit/objects/${key}`, { method: "PUT", body: bytes,
        headers: { "content-type": key.endsWith(".md") ? "text/markdown; charset=utf-8" : key.endsWith(".pdf") ? "application/pdf" : "application/octet-stream" } });
      await response.body?.cancel();
      checkpoint[key] = digest;
    }
    verified++;
    if (verified % 100 === 0) console.log(JSON.stringify({ uploaded: verified, total: objects.length }));
    if (verified % 100 === 0) await writeFile(checkpointFile, JSON.stringify(checkpoint));
  }
}));
await writeFile(checkpointFile, JSON.stringify(checkpoint));
// Download and hash every original; the manifest is published only after all uploads succeed.
let documentCursor = 0; let originalCount = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (documentCursor < corpus.documents.length) {
    const doc = corpus.documents[documentCursor++];
    const response = await request(`/r2/buckets/credit/objects/${doc.originalKey}`);
    if (sha(Buffer.from(await response.arrayBuffer())) !== doc.sha256) throw new Error(`原件校验失败：${doc.id}`);
    if (++originalCount % 10 === 0) console.log(JSON.stringify({ originalsHashVerified: originalCount, total: corpus.documents.length }));
  }
}));
const catalog = await readFile(path.join(directory, "corpus.json"));
await (await request("/r2/buckets/credit/objects/catalog/corpus.json", { method: "PUT", body: catalog, headers: { "content-type": "application/json" } })).body?.cancel();
const published = await request("/r2/buckets/credit/objects/catalog/corpus.json");
if (sha(Buffer.from(await published.arrayBuffer())) !== sha(catalog)) throw new Error("远端目录校验失败");
const job = await (await request(instancePath + "/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ description: "Credit corpus publication" }) })).json();
await writeFile(path.join(directory, "upload-report.json"), JSON.stringify({ documents: corpus.documents.length, blocks: corpus.blocks.length, originalsHashVerified: corpus.documents.length, catalogHash: sha(catalog), job: job.result }, null, 2));
console.log(JSON.stringify({ published: true, documents: corpus.documents.length, blocks: corpus.blocks.length, originalsHashVerified: corpus.documents.length, indexingJob: job.result }));
