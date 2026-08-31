import {
  marketReportObjectKey,
  marketReportSnapshotSchema,
  reportDataSchema,
  type MarketReportSnapshotContract,
  type ReportDataContract,
} from "../../market-report.ts";

export class MarketReportStoreError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "MarketReportStoreError";
    this.status = status;
  }
}

type EastmoneyBucket = Env["EASTMONEY"];

export async function readMarketReport(
  bucket: EastmoneyBucket | undefined,
  reportDate: string,
): Promise<MarketReportSnapshotContract> {
  const storage = requireBucket(bucket);
  const snapshot = await readSnapshot(storage, marketReportObjectKey(reportDate));
  if (!snapshot) {
    throw new MarketReportStoreError(404, "该日期尚无市场点评定稿");
  }
  return snapshot;
}

export async function saveMarketReport(
  bucket: EastmoneyBucket | undefined,
  reportDate: string,
  report: unknown,
  focusText: unknown,
): Promise<MarketReportSnapshotContract> {
  const storage = requireBucket(bucket);
  let parsedReport: ReportDataContract;
  try {
    parsedReport = reportDataSchema.parse(report);
  } catch {
    throw new MarketReportStoreError(400, "市场点评定稿数据不符合规范契约");
  }
  if (parsedReport.report_date !== reportDate) {
    throw new MarketReportStoreError(400, "报告日期与保存日期不一致");
  }
  if (typeof focusText !== "string") {
    throw new MarketReportStoreError(400, "今日聚焦内容无效");
  }
  const now = new Date().toISOString();
  const snapshot = marketReportSnapshotSchema.parse({
    ...parsedReport,
    focus_text: focusText,
    cached_at: now,
    finalized_at: now,
  });
  await writeSnapshot(storage, marketReportObjectKey(reportDate), snapshot);
  return snapshot;
}

async function readSnapshot(
  bucket: EastmoneyBucket,
  key: string,
): Promise<MarketReportSnapshotContract | null> {
  const object = await bucket.get(key);
  if (!object) return null;
  try {
    return marketReportSnapshotSchema.parse(await object.json());
  } catch (error) {
    console.error(JSON.stringify({ event: "market_report_cache_invalid", key }));
    return null;
  }
}

async function writeSnapshot(
  bucket: EastmoneyBucket,
  key: string,
  snapshot: MarketReportSnapshotContract,
): Promise<void> {
  const object = await bucket.put(key, JSON.stringify(snapshot), {
    httpMetadata: {
      contentType: "application/json; charset=utf-8",
      cacheControl: "private, no-store",
    },
    customMetadata: {
      reportDate: snapshot.report_date,
      cachedAt: snapshot.cached_at,
      ...(snapshot.finalized_at ? { finalizedAt: snapshot.finalized_at } : {}),
    },
  });
  if (!object) throw new MarketReportStoreError(503, "市场点评写入 R2 失败");
}

function requireBucket(bucket: EastmoneyBucket | undefined): EastmoneyBucket {
  if (!bucket) throw new MarketReportStoreError(503, "East Money R2 未配置");
  return bucket;
}
