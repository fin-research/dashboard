import {
  getMarketHotspots,
  HotspotError,
  type HotspotRequestScope,
} from "$lib/server/hotspots";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ platform, url }) => {
  if (!platform?.env.DB || !platform.env.AI) {
    return Response.json(
      { error: "D1 或 Workers AI binding 未配置" },
      { status: 503 },
    );
  }
  try {
    const scope = requestScope(url);
    const result = await getMarketHotspots(platform.env, scope, {
      refresh: url.searchParams.get("refresh") === "1",
    });
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const status = error instanceof HotspotError ? error.status : 500;
    console.error(
      JSON.stringify({
        event: "market_hotspots_failed",
        scope: scopeForLog(url),
        status,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return Response.json(
      { error: publicErrorMessage(error, status) },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
};

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(value);
}

function requestScope(url: URL): HotspotRequestScope {
  const legacyDate = url.searchParams.get("date");
  const mode = legacyDate ? "range" : (url.searchParams.get("mode") ?? "rolling");
  if (mode === "rolling") {
    const rawCount = url.searchParams.get("count") ?? "20";
    const rollingCount = Number(rawCount);
    if (!Number.isInteger(rollingCount) || rollingCount < 8 || rollingCount > 100) {
      throw new HotspotError(400, "count 必须是 8-100 的整数");
    }
    return { mode: "rolling", rollingCount };
  }
  if (mode !== "range") {
    throw new HotspotError(400, "mode 必须是 rolling 或 range");
  }
  const startDate = legacyDate ?? url.searchParams.get("startDate") ?? "";
  const endDate = legacyDate ?? url.searchParams.get("endDate") ?? "";
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
    throw new HotspotError(400, "startDate 和 endDate 必须是有效的 YYYY-MM-DD");
  }
  if (startDate > endDate) {
    throw new HotspotError(400, "startDate 不能晚于 endDate");
  }
  return { mode: "range", startDate, endDate };
}

function scopeForLog(url: URL): string {
  return url.searchParams.toString().slice(0, 240) || "rolling:20";
}

function publicErrorMessage(error: unknown, status: number): string {
  if (error instanceof HotspotError) return error.message;
  if (status >= 500) return "市场热点生成失败，请稍后重试";
  return error instanceof Error ? error.message : String(error);
}
