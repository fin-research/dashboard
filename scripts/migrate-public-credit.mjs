import { createHash } from "node:crypto";
import { corpusSchema } from "../src/lib/credit-assistant/types.ts";
import { isPublicCreditDocument } from "../src/lib/server/credit-evidence.ts";
import { cloudflareClient } from "./credit-cloudflare-client.mjs";

const apply = process.argv.includes("--apply");
const removeSource = process.argv.includes("--remove-source");
const indexOnly = process.argv.includes("--index-only");
if (removeSource && !apply) throw new Error("--remove-source 需要 --apply");
if (indexOnly && (!apply || removeSource)) throw new Error("--index-only 仅可与 --apply 同用");
const request = await cloudflareClient();
const sourcePath = key => `/r2/buckets/credit/objects/${key.split("/").map(encodeURIComponent).join("/")}`;
const targetPath = key => `/r2/buckets/eastmoney/objects/credit/${key.split("/").map(encodeURIComponent).join("/")}`;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = async (path, init) => {
  const result = await (await request(path, init)).json();
  if (!result.success) throw new Error(`Cloudflare API failed at ${path}`);
  return result.result;
};
const raw = Buffer.from(await (await request(sourcePath("catalog/corpus.json"))).arrayBuffer());
const source = corpusSchema.parse(JSON.parse(raw.toString("utf8")));
const documents = source.documents.filter(isPublicCreditDocument);
if (!documents.length) throw new Error("源目录没有公开材料");
const ids = new Set(documents.map(doc => doc.id));
const publicCorpus = { ...source, documents, blocks: source.blocks.filter(block => ids.has(block.documentId)),
  searchFiles: source.searchFiles?.filter(file => ids.has(file.documentId)) };
if (!publicCorpus.searchFiles?.length || publicCorpus.searchFiles.some(file => !file.key.startsWith("search/定期报告/"))) {
  throw new Error("公开检索目录无效");
}
const objects = [...documents.map(doc => ({ key: doc.originalKey, sha256: doc.sha256, bytes: doc.bytes })), ...publicCorpus.searchFiles];
const instancePath = "/ai-search/namespaces/default/instances/credit";
const instance = await json(instancePath);
console.log(JSON.stringify({ mode: apply ? removeSource ? "remove-source" : indexOnly ? "index-only" : "migrate" : "dry-run",
  publicDocuments: documents.length, searchFiles: publicCorpus.searchFiles.length, objects: objects.length,
  sourceBucket: instance.source, paused: instance.paused }));
if (!apply) process.exit(0);

if (!removeSource) {
  if (instance.source !== "credit" && instance.source !== "eastmoney") throw new Error("授信索引数据源不符合预期");
  if (!indexOnly) await json(instancePath, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ paused: true }) });
  for (const object of objects) {
    if (!indexOnly) {
      const bytes = Buffer.from(await (await request(sourcePath(object.key))).arrayBuffer());
      if (bytes.length !== object.bytes || hash(bytes) !== object.sha256) throw new Error(`源对象摘要不符：${object.key}`);
      await (await request(targetPath(object.key), { method: "PUT", body: bytes,
        headers: { "content-type": object.key.endsWith(".md") ? "text/markdown; charset=utf-8"
          : object.key.endsWith(".pdf") ? "application/pdf" : "application/octet-stream" } })).body?.cancel();
    }
    const copied = Buffer.from(await (await request(targetPath(object.key))).arrayBuffer());
    if (hash(copied) !== object.sha256) throw new Error(`目标对象摘要不符：${object.key}`);
  }
  const catalog = Buffer.from(JSON.stringify(publicCorpus));
  if (!indexOnly) await (await request(targetPath("catalog/corpus.json"), { method: "PUT", body: catalog,
    headers: { "content-type": "application/json" } })).body?.cancel();
  const published = Buffer.from(await (await request(targetPath("catalog/corpus.json"))).arrayBuffer());
  if (hash(published) !== hash(catalog)) throw new Error("目标目录摘要不符");
  await json(instancePath, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({
    source: "eastmoney", paused: false, chunk: true,
    source_params: { ...instance.source_params,
      include_items: ["credit/search/**", "/credit/search/**"],
      exclude_items: ["credit/originals/**", "/credit/originals/**", "credit/catalog/**", "/credit/catalog/**"] },
  }) });
  const job = await json(instancePath + "/jobs", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ description: "Index public credit reports from eastmoney/credit" }) });
  console.log(JSON.stringify({ copied: objects.length, catalogSha256: hash(catalog), jobId: job?.id ?? null }));
} else {
  if (instance.source !== "eastmoney") throw new Error("授信索引尚未切换到 eastmoney");
  const target = corpusSchema.parse(await (await request(targetPath("catalog/corpus.json"))).json());
  if (target.documents.length !== documents.length || target.searchFiles?.length !== publicCorpus.searchFiles.length) {
    throw new Error("目标公开目录尚未验证");
  }
  for (const object of objects) {
    const copied = Buffer.from(await (await request(targetPath(object.key))).arrayBuffer());
    if (hash(copied) !== object.sha256) throw new Error(`目标对象摘要不符：${object.key}`);
  }
  const privateIds = new Set(source.documents.filter(doc => !ids.has(doc.id)).map(doc => doc.id));
  const privateCorpus = { ...source, documents: source.documents.filter(doc => privateIds.has(doc.id)),
    blocks: source.blocks.filter(block => privateIds.has(block.documentId)),
    searchFiles: source.searchFiles?.filter(file => privateIds.has(file.documentId)) };
  for (const object of objects) await (await request(sourcePath(object.key), { method: "DELETE" })).body?.cancel();
  await (await request(sourcePath("catalog/corpus.json"), { method: "PUT", body: Buffer.from(JSON.stringify(privateCorpus)),
    headers: { "content-type": "application/json" } })).body?.cancel();
  console.log(JSON.stringify({ moved: objects.length, sourceCatalogDocuments: privateCorpus.documents.length }));
}
