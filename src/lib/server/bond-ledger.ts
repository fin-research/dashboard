const MAX_LEDGER_BYTES = 12 * 1024 * 1024;
const LEDGER_PREFIX = "daily/";
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
  stored: true;
  environment: "production";
  key: string;
  size: number;
  etag: string | null;
  uploadedAt: string;
}

export interface RemoteBondLedgerFile {
  date: string;
  fileName: string;
  key: string;
  size: number;
  etag: string;
  uploadedAt: string;
}

export interface BondLedgerInventoryResponse {
  files: RemoteBondLedgerFile[];
  availableStartDate: string | null;
  availableEndDate: string | null;
}

interface LedgerR2Object {
  key: string;
  size: number;
  etag: string;
  uploaded: Date;
  customMetadata?: Record<string, string>;
}

type StoredBondLedger = Exclude<
  Awaited<ReturnType<Env["BOND_LEDGER"]["get"]>>,
  null
>;

export async function archiveBondLedgerRequest(
  request: Request,
  bucket: Env["BOND_LEDGER"] | undefined,
): Promise<BondLedgerArchiveResponse> {
  const metadata = validateUploadRequest(request);
  const storage = requireBucket(bucket);
  if (!request.body) {
    throw new BondLedgerUploadError(400, "台账文件内容为空");
  }
  const uploadedAt = new Date().toISOString();
  const key = ledgerKey(metadata.date);
  const object = await storage.put(
    key,
    request.body.pipeThrough(
      sizeLimitedStream(MAX_LEDGER_BYTES, metadata.size),
    ),
    {
      httpMetadata: {
        contentType: XLSX_CONTENT_TYPE,
        contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(metadata.fileName)}`,
        cacheControl: "private, no-store",
      },
      customMetadata: {
        ledgerDate: metadata.date,
        originalName: metadata.fileName,
        uploadedAt,
      },
    },
  );
  return {
    stored: true,
    environment: "production",
    key: object.key,
    size: object.size,
    etag: object.etag,
    uploadedAt,
  };
}

export async function listBondLedgerFiles(
  bucket: Env["BOND_LEDGER"] | undefined,
): Promise<BondLedgerInventoryResponse> {
  const storage = requireBucket(bucket);
  const files: RemoteBondLedgerFile[] = [];
  let cursor: string | undefined;
  do {
    const result = await storage.list({
      prefix: LEDGER_PREFIX,
      cursor,
      include: ["customMetadata"],
    });
    for (const object of result.objects) {
      const date = ledgerDateFromObject(object);
      if (!date) continue;
      files.push({
        date,
        fileName:
          object.customMetadata?.originalName ||
          `二级资金池台账${date.replaceAll("-", "")}.xlsx`,
        key: object.key,
        size: object.size,
        etag: object.etag,
        uploadedAt:
          object.customMetadata?.uploadedAt || object.uploaded.toISOString(),
      });
    }
    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);
  files.sort((left, right) => left.date.localeCompare(right.date));
  return {
    files,
    availableStartDate: files.at(0)?.date ?? null,
    availableEndDate: files.at(-1)?.date ?? null,
  };
}

export async function getBondLedgerFile(
  bucket: Env["BOND_LEDGER"] | undefined,
  date: string,
): Promise<StoredBondLedger> {
  validateLedgerDate(date);
  const object = await requireBucket(bucket).get(ledgerKey(date));
  if (!object) {
    throw new BondLedgerUploadError(404, `${date} 台账不存在`);
  }
  return object;
}

export async function deleteBondLedgerFile(
  request: Request,
  bucket: Env["BOND_LEDGER"] | undefined,
  date: string,
): Promise<void> {
  validateSameOrigin(request);
  validateLedgerDate(date);
  const storage = requireBucket(bucket);
  const existing = await storage.head(ledgerKey(date));
  if (!existing) {
    throw new BondLedgerUploadError(404, `${date} 台账不存在`);
  }
  await storage.delete(ledgerKey(date));
}

export function ledgerDownloadHeaders(object: StoredBondLedger): Headers {
  const headers = new Headers();
  const fileName =
    object.customMetadata?.originalName ||
    `二级资金池台账${object.customMetadata?.ledgerDate?.replaceAll("-", "") ?? ""}.xlsx`;
  headers.set("Content-Type", XLSX_CONTENT_TYPE);
  headers.set(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  );
  headers.set("Content-Length", String(object.size));
  if (object.httpMetadata?.contentLanguage) {
    headers.set("Content-Language", object.httpMetadata.contentLanguage);
  }
  headers.set("Cache-Control", object.httpMetadata?.cacheControl || "private, no-store");
  headers.set("ETag", object.httpEtag);
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}

function validateUploadRequest(request: Request): {
  date: string;
  fileName: string;
  size: number;
} {
  validateSameOrigin(request);
  const date = request.headers.get("X-Ledger-Date") ?? "";
  validateLedgerDate(date);
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
  const contentLength = Number(request.headers.get("Content-Length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > 0 &&
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
  return { date, fileName, size };
}

function validateSameOrigin(request: Request): void {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new BondLedgerUploadError(403, "仅允许从本站管理台账");
  }
  if (request.headers.get("Sec-Fetch-Site") === "cross-site") {
    throw new BondLedgerUploadError(403, "不允许跨站管理台账");
  }
}

function requireBucket(
  bucket: Env["BOND_LEDGER"] | undefined,
): Env["BOND_LEDGER"] {
  if (!bucket) {
    throw new BondLedgerUploadError(503, "R2 台账存储未配置");
  }
  return bucket;
}

function validateLedgerDate(date: string): void {
  if (!isIsoDate(date)) {
    throw new BondLedgerUploadError(400, "台账日期必须是有效的 YYYY-MM-DD");
  }
}

function ledgerKey(date: string): string {
  return `${LEDGER_PREFIX}${date}.xlsx`;
}

function ledgerDateFromObject(object: LedgerR2Object): string | null {
  const metadataDate = object.customMetadata?.ledgerDate ?? "";
  if (isIsoDate(metadataDate)) return metadataDate;
  const match = object.key.match(/^daily\/(\d{4}-\d{2}-\d{2})\.xlsx$/);
  return match && isIsoDate(match[1] ?? "") ? (match[1] as string) : null;
}

function sizeLimitedStream(
  maxBytes: number,
  expectedBytes: number,
): TransformStream<Uint8Array, Uint8Array> {
  let received = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > maxBytes) {
        controller.error(new BondLedgerUploadError(413, "台账文件不能超过 12 MB"));
        return;
      }
      controller.enqueue(chunk);
    },
    flush(controller) {
      if (received !== expectedBytes) {
        controller.error(
          new BondLedgerUploadError(400, "台账文件大小与请求内容不一致"),
        );
      }
    },
  });
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(value);
}
