import { currentReportDate, isBeforeReportCutoff } from "../../report-date.ts";

/** Report selection uses Monday-Friday for every year, without live market dependencies. */
export function defaultReportDate(now = new Date()): string {
  const cursor = new Date(`${currentReportDate(now)}T00:00:00Z`);
  if (isBeforeReportCutoff(now)) cursor.setUTCDate(cursor.getUTCDate() - 1);
  while (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return cursor.toISOString().slice(0, 10);
}
