import { expectedPreviousTradingDate } from "./market-calendar.ts";
import { currentReportDate, isBeforeReportCutoff, previousReportTradingDate } from "../../report-date.ts";
import { industrySnapshotSchema } from "../../data-contracts.ts";
import { fetchDataJson } from "./market-briefing.ts";
import { MarketReportStoreError } from "./market-report.ts";

export async function defaultReportDate(env: Env | undefined, now = new Date()): Promise<string> {
  const today = currentReportDate(now);
  // After the cutoff an absent report must be a visible error, never a fallback to an older report.
  if (!isBeforeReportCutoff(now)) return today;
  try {
    // Archived reports must remain readable when live quotes are unavailable.
    // Use the published exchange calendar wherever its coverage is verified.
    const expected = expectedPreviousTradingDate(today);
    if (expected) return expected;
    if (!env?.DATA) throw new Error("交易日数据服务未配置");
    const calendar = await fetchDataJson(env,
      `https://data.internal/data/industry?date=${today}&fields=dataDate,tradingDates`,
      industrySnapshotSchema.pick({ dataDate: true, tradingDates: true }));
    return previousReportTradingDate(calendar.tradingDates, today);
  } catch {
    throw new MarketReportStoreError(503, "无法确定上一交易日，请稍后重试", "TRADING_CALENDAR_UNAVAILABLE", "report_date", "Dashboard Calendar");
  }
}
