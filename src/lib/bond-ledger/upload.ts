import type { BondLedgerReport } from "./types";

const LEDGER_ENDPOINT = "/api/bond-ledger";
const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface BondLedgerArchiveResult {
  accepted: true;
  uploadId: string;
  workflowId: string;
  key: string;
  size: number;
  etag: string | null;
  uploadedAt: string;
}

export interface BondLedgerImportResult {
  reportDate: string;
  statisticsCount: number;
  positionCount: number;
  transactionCount: number;
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
  databaseDates: string[];
  availableStartDate: string | null;
  availableEndDate: string | null;
}

interface WorkflowStatusPayload {
  workflowId: string;
  status: "processing" | "succeeded" | "failed";
  error?: string;
  result?: unknown;
}

export async function archiveBondLedgerFile(
  file: File,
  expectedDate?: string,
): Promise<BondLedgerArchiveResult> {
  const headers: Record<string, string> = {
    "Content-Type": XLSX_CONTENT_TYPE,
    "X-Ledger-Filename": encodeURIComponent(file.name),
    "X-Ledger-Size": String(file.size),
  };
  if (expectedDate) headers["X-Ledger-Expected-Date"] = expectedDate;
  const response = await fetch(LEDGER_ENDPOINT, {
    method: "POST",
    headers,
    body: file,
  });
  const payload = await jsonPayload(response);
  if (!response.ok || !isArchiveResult(payload)) {
    throw new Error(errorFromPayload(payload, `台账上传失败（HTTP ${response.status}）`));
  }
  return payload;
}

export async function waitForBondLedgerImport(
  workflowId: string,
  onProcessing?: () => void,
): Promise<BondLedgerImportResult> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const response = await fetch(
      `${LEDGER_ENDPOINT}?workflow=${encodeURIComponent(workflowId)}`,
      { cache: "no-store" },
    );
    const payload = await jsonPayload(response);
    if (!response.ok || !isWorkflowStatus(payload)) {
      throw new Error(
        errorFromPayload(payload, `导入状态读取失败（HTTP ${response.status}）`),
      );
    }
    if (payload.status === "failed") {
      throw new Error(payload.error || "Excel 导入失败");
    }
    if (payload.status === "succeeded") {
      if (!isImportResult(payload.result)) {
        throw new Error("导入工作流已完成，但返回结果无效");
      }
      return payload.result;
    }
    onProcessing?.();
    await delay(750);
  }
  throw new Error("Excel 仍在后台导入，请稍后刷新台账清单");
}

export async function loadBondLedgerReport(
  startDate: string,
  endDate: string,
): Promise<BondLedgerReport> {
  const response = await fetch(
    `${LEDGER_ENDPOINT}?start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}`,
    { cache: "no-store" },
  );
  const payload = await jsonPayload(response);
  if (!response.ok || !isBondLedgerReport(payload)) {
    throw new Error(
      errorFromPayload(payload, `周报数据读取失败（HTTP ${response.status}）`),
    );
  }
  return payload;
}

export async function listRemoteBondLedgers(): Promise<BondLedgerInventory> {
  const response = await fetch(LEDGER_ENDPOINT, { cache: "no-store" });
  const payload = await jsonPayload(response);
  if (!response.ok) {
    throw new Error(
      errorFromPayload(payload, `台账清单读取失败（HTTP ${response.status}）`),
    );
  }
  const inventory = isRecord(payload) ? payload : {};
  const files = Array.isArray(inventory.files)
    ? inventory.files.filter(isRemoteBondLedgerFile).sort(compareRemoteFiles)
    : [];
  const databaseDates = Array.isArray(inventory.databaseDates)
    ? [
        ...new Set(
          inventory.databaseDates.filter(
            (value): value is string =>
              typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value),
          ),
        ),
      ].sort()
    : files.map((file) => file.date);
  return {
    files,
    databaseDates,
    availableStartDate:
      typeof inventory.availableStartDate === "string"
        ? inventory.availableStartDate
        : databaseDates.at(0) ?? null,
    availableEndDate:
      typeof inventory.availableEndDate === "string"
        ? inventory.availableEndDate
        : databaseDates.at(-1) ?? null,
  };
}

export async function downloadRemoteBondLedger(
  remote: RemoteBondLedgerFile,
): Promise<void> {
  const response = await fetch(
    `${LEDGER_ENDPOINT}?date=${encodeURIComponent(remote.date)}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    const payload = await jsonPayload(response);
    throw new Error(errorFromPayload(payload, `${remote.date} 台账下载失败`));
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
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
  const payload = await jsonPayload(response);
  if (!response.ok) {
    throw new Error(errorFromPayload(payload, `${date} 台账删除失败`));
  }
}

function isArchiveResult(value: unknown): value is BondLedgerArchiveResult {
  if (!isRecord(value)) return false;
  return (
    value.accepted === true &&
    typeof value.uploadId === "string" &&
    typeof value.workflowId === "string" &&
    typeof value.key === "string" &&
    typeof value.size === "number" &&
    (typeof value.etag === "string" || value.etag === null) &&
    typeof value.uploadedAt === "string"
  );
}

function isWorkflowStatus(value: unknown): value is WorkflowStatusPayload {
  if (!isRecord(value)) return false;
  return (
    typeof value.workflowId === "string" &&
    (value.status === "processing" ||
      value.status === "succeeded" ||
      value.status === "failed")
  );
}

function isImportResult(value: unknown): value is BondLedgerImportResult {
  if (!isRecord(value)) return false;
  return (
    typeof value.reportDate === "string" &&
    typeof value.statisticsCount === "number" &&
    typeof value.positionCount === "number" &&
    typeof value.transactionCount === "number"
  );
}

function isBondLedgerReport(value: unknown): value is BondLedgerReport {
  if (!isRecord(value)) return false;
  return (
    typeof value.hasData === "boolean" &&
    Array.isArray(value.performanceTrend) &&
    Array.isArray(value.holdingTypes) &&
    Array.isArray(value.maturityBuckets) &&
    Array.isArray(value.transactions) &&
    isRecord(value.transactionTotals) &&
    isRecord(value.returnRiskMetrics) &&
    isRecord(value.metricDeltas)
  );
}

function isRemoteBondLedgerFile(value: unknown): value is RemoteBondLedgerFile {
  if (!isRecord(value)) return false;
  return (
    typeof value.date === "string" &&
    typeof value.fileName === "string" &&
    typeof value.key === "string" &&
    typeof value.size === "number" &&
    typeof value.etag === "string" &&
    typeof value.uploadedAt === "string"
  );
}

function compareRemoteFiles(
  left: RemoteBondLedgerFile,
  right: RemoteBondLedgerFile,
): number {
  return left.date.localeCompare(right.date);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorFromPayload(value: unknown, fallback: string): string {
  return isRecord(value) && typeof value.error === "string"
    ? value.error
    : fallback;
}

async function jsonPayload(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
