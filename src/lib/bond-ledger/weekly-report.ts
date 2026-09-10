// 临时业务配置：台账尚无质押/卖出回购字段，按业务确认固定为 40 亿元。
// 待源台账结构确定后，替换为最新报表日的源字段。
export const WEEKLY_PLEDGED_AMOUNT = 4_000_000_000;

export function yearToLatestLedgerRange(today: string, databaseDates: string[]) {
  const startDate = `${today.slice(0, 4)}-01-01`;
  const latest = databaseDates
    .filter((date) => date >= startDate && date <= today)
    .sort()
    .at(-1);
  return { startDate, endDate: latest ?? today };
}
