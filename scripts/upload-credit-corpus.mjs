import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { corpusSchema } from "../src/lib/credit-assistant/types.ts";
import { isCreditOriginalKey } from "../src/lib/server/credit-evidence.ts";
import { cloudflareClient } from "./credit-cloudflare-client.mjs";

const option = name => process.argv.find(x => x.startsWith(name + "="))?.slice(name.length + 1);
const directory = path.resolve(option("--directory") ?? ".credit-local/corpus");
const apply = process.argv.includes("--apply");
const previousFile = option("--prune-previous");
const corpus = corpusSchema.parse(JSON.parse(await readFile(path.join(directory, "corpus.json"), "utf8")));
const report = JSON.parse(await readFile(path.join(directory, "preparation-report.json"), "utf8"));
if (report.failures.length || report.unreadableBlocks) throw new Error("材料解析有失败或未识别页，请先修复");
if (corpus.version !== "credit-document-v2" || !corpus.searchFiles?.length) throw new Error("请先按整份 Markdown 格式重新准备材料");
const objects = [...corpus.documents.map(d => ({ key: d.originalKey, sha256: d.sha256, bytes: d.bytes })), ...corpus.searchFiles];
const desiredKeys = new Set(objects.map(x => x.key));
if (desiredKeys.size !== objects.length) throw new Error("对象名称冲突");
for (const item of objects) {
  if (new TextEncoder().encode(item.key).byteLength > 1024) throw new Error("对象名称超过 1024 字节");
  if (!item.key.startsWith("search/") && !isCreditOriginalKey(item.key)) throw new Error("无效原件路径");
  if (item.key.startsWith("search/") && (!item.key.endsWith(".md") || item.bytes > 4_000_000)) throw new Error("Markdown 超出 4 MB 或扩展名错误");
  if (item.key.split("/").some(p => p === "." || p === ".." || !p) || /[\\\u0000-\u001f]/.test(item.key)) throw new Error("无效对象路径");
}
const previous = previousFile ? corpusSchema.parse(JSON.parse(await readFile(previousFile, "utf8"))) : null;
const obsolete = previous ? [...new Set([...previous.documents.map(d => d.originalKey), ...(previous.searchFiles?.map(f => f.key) ?? previous.blocks.map(b => b.searchKey))])].filter(key => !desiredKeys.has(key)) : [];
if (obsolete.some(key => !key.startsWith("search/") && !isCreditOriginalKey(key))) throw new Error("清理目录包含非授信对象");
const sha = value => createHash("sha256").update(value).digest("hex");
const objectPath = key => "/r2/buckets/credit/objects/" + key.split("/").map(encodeURIComponent).join("/");
const summary = { mode: apply ? "apply" : "dry-run", documents: corpus.documents.length, markdownFiles: corpus.searchFiles.length,
  searchBytes: corpus.searchFiles.reduce((n, f) => n + f.bytes, 0), objects: objects.length, obsoleteObjects: obsolete.length, bucket: "credit" };
console.log(JSON.stringify(summary));
await writeFile(path.join(directory, "upload-plan.json"), JSON.stringify({ ...summary, upload: objects, removeAfterVerification: obsolete }, null, 2));
if (!apply) process.exit(0);
const request = await cloudflareClient();
const instancePath = "/ai-search/namespaces/default/instances/credit";
async function jsonRequest(resource, init) {
  const data = await (await request(resource, init)).json();
  if (!data.success) throw new Error("Cloudflare operation failed: " + JSON.stringify(data.errors));
  return data.result;
}
const info = await jsonRequest(instancePath);
if (info.source !== "credit" || info.type !== "r2") throw new Error("AI Search credit 未连接 credit 存储桶");
const beforeFile = path.join(directory, "search-instance-before.json");
const before = JSON.parse(await readFile(beforeFile, "utf8").catch(() => JSON.stringify(info)));
await writeFile(beforeFile, JSON.stringify(before, null, 2));
// Pause indexing across the migration so old and new content is not embedded twice.
await jsonRequest(instancePath, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ paused: true }) });
const checkpointFile = path.join(directory, "upload-checkpoint-v3.json");
const checkpoint = JSON.parse(await readFile(checkpointFile, "utf8").catch(() => "{}"));
async function parallel(items, count, run) {
  let cursor = 0;
  const results = await Promise.allSettled(Array.from({ length: count }, async () => {
    while (cursor < items.length) await run(items[cursor++]);
  }));
  const failures = results.filter(r => r.status === "rejected");
  if (failures.length) throw failures[0].reason;
}
let uploaded = 0;
try { await parallel(objects, 6, async item => {
  const bytes = await readFile(path.join(directory, item.key));
  if (sha(bytes) !== item.sha256 || bytes.byteLength !== item.bytes) throw new Error("本地内容与清单不一致：" + item.key);
  if (checkpoint[item.key] !== item.sha256) {
    const response = await request(objectPath(item.key), { method: "PUT", body: bytes,
      headers: { "content-type": item.key.endsWith(".md") ? "text/markdown; charset=utf-8" : item.key.endsWith(".pdf") ? "application/pdf" : "application/octet-stream" } });
    await response.body?.cancel();
    checkpoint[item.key] = item.sha256;
  }
  if (++uploaded % 10 === 0) console.log(JSON.stringify({ uploaded, total: objects.length }));
}); } finally { await writeFile(checkpointFile, JSON.stringify(checkpoint)); }
let verified = 0;
await parallel(objects, 4, async item => {
  const response = await request(objectPath(item.key));
  if (sha(Buffer.from(await response.arrayBuffer())) !== item.sha256) throw new Error("远端内容校验失败：" + item.key);
  if (++verified % 10 === 0) console.log(JSON.stringify({ hashVerified: verified, total: objects.length }));
});
const catalog = await readFile(path.join(directory, "corpus.json"));
await (await request(objectPath("catalog/corpus.json"), { method: "PUT", body: catalog, headers: { "content-type": "application/json" } })).body?.cancel();
const published = await request(objectPath("catalog/corpus.json"));
if (sha(Buffer.from(await published.arrayBuffer())) !== sha(catalog)) throw new Error("远端目录校验失败");
console.log(JSON.stringify({ catalogPublished: true, hashVerified: verified }));
// Explicit previous manifest, exact keys only. New originals and Markdown are all verified first.
const deletedFile = path.join(directory, "pruned-objects.json");
const deleted = new Set(JSON.parse(await readFile(deletedFile, "utf8").catch(() => "[]")));
let pruned = deleted.size;
try { await parallel(obsolete.filter(key => !deleted.has(key)), 6, async key => {
  await (await request(objectPath(key), { method: "DELETE" })).body?.cancel();
  deleted.add(key);
  if (++pruned % 100 === 0) { console.log(JSON.stringify({ pruned, total: obsolete.length })); await writeFile(deletedFile, JSON.stringify([...deleted])); }
}); } finally { await writeFile(deletedFile, JSON.stringify([...deleted])); }
await jsonRequest(instancePath, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ paused: before.paused,
  source_params: { ...info.source_params, include_items: ["search/**", "/search/**"], exclude_items: ["originals/**", "/originals/**", "catalog/**", "/catalog/**"] }, chunk: true }) });
const job = before.paused ? null : await jsonRequest(instancePath + "/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ description: "Credit whole-document Markdown migration" }) });
const result = { ...summary, published: true, objectsHashVerified: verified, catalogHash: sha(catalog), pruned, job };
await writeFile(path.join(directory, "upload-report.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
