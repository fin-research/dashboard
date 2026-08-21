const LEDGER_ENDPOINT = "/api/bond-ledger";
const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface BondLedgerArchiveResult {
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

export interface BondLedgerInventory {
  files: RemoteBondLedgerFile[];
  availableStartDate: string | null;
  availableEndDate: string | null;
}

export async function archiveBondLedgerFile(
  file: File,
  ledgerDate: string,
): Promise<BondLedgerArchiveResult> {
  const response = await fetch(LEDGER_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": file.type || XLSX_CONTENT_TYPE,
      "X-Ledger-Date": ledgerDate,
      "X-Ledger-Filename": encodeURIComponent(file.name),
      "X-Ledger-Size": String(file.size),
    },
    body: file,
  });
  const payload = (await response.json().catch(() => null)) as
    | (Partial<BondLedgerArchiveResult> & { error?: string })
    | null;
  if (!response.ok || payload?.stored !== true || !payload.key) {
    throw new Error(payload?.error || `台账上传失败（HTTP ${response.status}）`);
  }
  return {
    stored: true,
    environment: "production",
    key: payload.key,
    size: typeof payload.size === "number" ? payload.size : file.size,
    etag: typeof payload.etag === "string" ? payload.etag : null,
    uploadedAt:
      typeof payload.uploadedAt === "string"
        ? payload.uploadedAt
        : new Date().toISOString(),
  };
}

export async function listRemoteBondLedgers(): Promise<BondLedgerInventory> {
  const response = await fetch(LEDGER_ENDPOINT, { cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as
    | (Partial<BondLedgerInventory> & { error?: string })
    | null;
  if (!response.ok) {
    throw new Error(payload?.error || `台账清单读取失败（HTTP ${response.status}）`);
  }
  const files = Array.isArray(payload?.files)
    ? payload.files.filter(isRemoteBondLedgerFile).sort(compareRemoteFiles)
    : [];
  return {
    files,
    availableStartDate:
      typeof payload?.availableStartDate === "string"
        ? payload.availableStartDate
        : files.at(0)?.date ?? null,
    availableEndDate:
      typeof payload?.availableEndDate === "string"
        ? payload.availableEndDate
        : files.at(-1)?.date ?? null,
  };
}

export async function fetchRemoteBondLedgerFile(
  remote: RemoteBondLedgerFile,
): Promise<File> {
  const response = await fetch(
    `${LEDGER_ENDPOINT}?date=${encodeURIComponent(remote.date)}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(payload?.error || `${remote.date} 台账下载失败`);
  }
  const blob = await response.blob();
  return new File([blob], remote.fileName, {
    type: blob.type || XLSX_CONTENT_TYPE,
    lastModified: Date.parse(remote.uploadedAt) || Date.now(),
  });
}

export async function downloadRemoteBondLedger(
  remote: RemoteBondLedgerFile,
): Promise<void> {
  const file = await fetchRemoteBondLedgerFile(remote);
  const url = URL.createObjectURL(file);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = remote.fileName;
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function deleteRemoteBondLedger(date: string): Promise<void> {
  const response = await fetch(
    `${LEDGER_ENDPOINT}?date=${encodeURIComponent(date)}`,
    { method: "DELETE" },
  );
  const payload = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;
  if (!response.ok) {
    throw new Error(payload?.error || `${date} 台账删除失败`);
  }
}

function isRemoteBondLedgerFile(value: unknown): value is RemoteBondLedgerFile {
  if (!value || typeof value !== "object") return false;
  const file = value as Partial<RemoteBondLedgerFile>;
  return (
    typeof file.date === "string" &&
    typeof file.fileName === "string" &&
    typeof file.key === "string" &&
    typeof file.size === "number" &&
    typeof file.etag === "string" &&
    typeof file.uploadedAt === "string"
  );
}

function compareRemoteFiles(
  left: RemoteBondLedgerFile,
  right: RemoteBondLedgerFile,
): number {
  return left.date.localeCompare(right.date);
}
