import type { BondLedgerImportParams } from "$lib/bond-ledger/types";
import type { RemoteBondLedgerFile } from "$lib/server/bond-ledger-repository";

const MAX_LEDGER_BYTES = 12 * 1024 * 1024;
const LEDGER_PREFIX = "uploads/";
const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export class BondLedgerUploadError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "BondLedgerUploadError";
    this.status = status;
  }
}

export interface BondLedgerArchiveResponse {
  accepted: true;
  uploadId: string;
  workflowId: string;
  key: string;
  size: number;
  etag: string | null;
  uploadedAt: string;
}

type StoredBondLedger = Exclude<
  Awaited<ReturnType<Env["BOND_LEDGER"]["get"]>>,
  null
>;

export async function archiveBondLedgerRequest(
  request: Request,
  bucket: Env["BOND_LEDGER"] | undefined,
  workflow: Env["BOND_LEDGER_IMPORT"] | undefined,
): Promise<BondLedgerArchiveResponse> {
  const metadata = validateUploadRequest(request);
  const storage = requireBucket(bucket);
  const importer = requireWorkflow(workflow);
  if (!request.body) {
    throw new BondLedgerUploadError(400, "台账文件内容为空");
  }
  const uploadId = crypto.randomUUID();
  const uploadedAt = new Date().toISOString();
  const key = `${LEDGER_PREFIX}${uploadId}.xlsx`;
  const object = await storage.put(key, request.body, {
    httpMetadata: {
      contentType: XLSX_CONTENT_TYPE,
      contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(metadata.fileName)}`,
      cacheControl: "private, no-store",
    },
    customMetadata: {
      uploadId,
      originalName: metadata.fileName,
      uploadedAt,
      ...(metadata.expectedDate
        ? { expectedDate: metadata.expectedDate }
        : {}),
    },
  });
  if (!object) {
    throw new BondLedgerUploadError(503, "Excel 写入 R2 失败");
  }
  const params: BondLedgerImportParams = {
    uploadId,
    r2Key: object.key,
    r2Etag: object.etag || null,
    originalName: metadata.fileName,
    fileSize: object.size,
    expectedDate: metadata.expectedDate,
    uploadedAt,
  };
  try {
    const instance = await importer.create({
      id: uploadId,
      params,
      retention: {
        successRetention: "7 days",
        errorRetention: "30 days",
      },
      locationHint: "apac",
    });
    return {
      accepted: true,
      uploadId,
      workflowId: instance.id,
      key: object.key,
      size: object.size,
      etag: object.etag || null,
      uploadedAt,
    };
  } catch (error) {
    await storage.delete(object.key).catch(() => undefined);
    throw new BondLedgerUploadError(
      503,
      `启动导入工作流失败，已回滚本次 R2 文件：${errorMessage(error)}`,
    );
  }
}

export async function getBondLedgerFile(
  bucket: Env["BOND_LEDGER"] | undefined,
  file: RemoteBondLedgerFile,
): Promise<StoredBondLedger> {
  const object = await requireBucket(bucket).get(file.key);
  if (!object) {
    throw new BondLedgerUploadError(404, `${file.date} 的 R2 原始台账不存在`);
  }
  return object;
}

export function ledgerDownloadHeaders(
  object: StoredBondLedger,
  fileName: string,
): Headers {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", XLSX_CONTENT_TYPE);
  headers.set(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  );
  headers.set("Content-Length", String(object.size));
  headers.set("Cache-Control", "private, no-store");
  headers.set("ETag", object.httpEtag);
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}

export async function workflowStatus(
  workflow: Env["BOND_LEDGER_IMPORT"] | undefined,
  id: string,
): Promise<{
  workflowId: string;
  status: "processing" | "succeeded" | "failed";
  error?: string;
  result?: unknown;
}> {
  if (!isUuid(id)) {
    throw new BondLedgerUploadError(400, "Workflow ID 无效");
  }
  let instance;
  try {
    instance = await requireWorkflow(workflow).get(id);
  } catch {
    throw new BondLedgerUploadError(404, "导入工作流不存在");
  }
  const current = await instance.status();
  if (current.status === "complete") {
    return { workflowId: id, status: "succeeded", result: current.output };
  }
  if (current.status === "errored" || current.status === "terminated") {
    return {
      workflowId: id,
      status: "failed",
      error: current.error?.message || "Excel 导入失败",
    };
  }
  return { workflowId: id, status: "processing" };
}

export function validateSameOrigin(request: Request): void {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new BondLedgerUploadError(403, "仅允许从本站管理台账");
  }
  if (request.headers.get("Sec-Fetch-Site") === "cross-site") {
    throw new BondLedgerUploadError(403, "不允许跨站管理台账");
  }
}

export function validateLedgerDate(date: string): void {
  if (!isIsoDate(date)) {
    throw new BondLedgerUploadError(400, "台账日期必须是有效的 YYYY-MM-DD");
  }
}

function validateUploadRequest(request: Request): {
  fileName: string;
  size: number;
  expectedDate: string | null;
} {
  validateSameOrigin(request);
  const encodedName = request.headers.get("X-Ledger-Filename") ?? "";
  let fileName = "";
  try {
    fileName = decodeURIComponent(encodedName).trim();
  } catch {
    throw new BondLedgerUploadError(400, "台账文件名编码无效");
  }
  if (
    !fileName ||
    fileName.length > 180 ||
    !fileName.toLowerCase().endsWith(".xlsx") ||
    /[\u0000-\u001f/\\]/.test(fileName)
  ) {
    throw new BondLedgerUploadError(400, "台账文件名无效，仅支持 .xlsx");
  }
  const size = Number(request.headers.get("X-Ledger-Size"));
  if (!Number.isInteger(size) || size <= 0) {
    throw new BondLedgerUploadError(400, "台账文件大小无效");
  }
  if (size > MAX_LEDGER_BYTES) {
    throw new BondLedgerUploadError(413, "台账文件不能超过 12 MB");
  }
  const contentLengthHeader = request.headers.get("Content-Length");
  const contentLength =
    contentLengthHeader === null ? Number.NaN : Number(contentLengthHeader);
  if (
    !Number.isInteger(contentLength) ||
    contentLength <= 0 ||
    contentLength !== size
  ) {
    throw new BondLedgerUploadError(400, "台账文件大小与请求内容不一致");
  }
  const contentType = (request.headers.get("Content-Type") ?? "")
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (
    contentType !== XLSX_CONTENT_TYPE &&
    contentType !== "application/octet-stream"
  ) {
    throw new BondLedgerUploadError(415, "台账文件类型必须是 .xlsx");
  }
  const expectedDateHeader = request.headers.get("X-Ledger-Expected-Date");
  const expectedDate = expectedDateHeader?.trim() || null;
  if (expectedDate) validateLedgerDate(expectedDate);
  return { fileName, size, expectedDate };
}

function requireBucket(
  bucket: Env["BOND_LEDGER"] | undefined,
): Env["BOND_LEDGER"] {
  if (!bucket) {
    throw new BondLedgerUploadError(503, "R2 台账存储未配置");
  }
  return bucket;
}

function requireWorkflow(
  workflow: Env["BOND_LEDGER_IMPORT"] | undefined,
): Env["BOND_LEDGER_IMPORT"] {
  if (!workflow) {
    throw new BondLedgerUploadError(503, "台账导入 Workflow 未配置");
  }
  return workflow;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
