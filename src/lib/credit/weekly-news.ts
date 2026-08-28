import type { CreditWeeklyNewsItem } from "./types.ts";

const eventLabels = {
  new: "新增授信",
  increase: "扩额",
  renewal: "续签",
} as const;

export function formatCreditWeeklyNews(news: CreditWeeklyNewsItem): string {
  const details: string[] = [];
  if (news.eventTypes.includes("new") || news.eventTypes.includes("increase")) {
    details.push(`较上期增加 ${formatAmount(news.deltaAmount)} 亿元`);
  }
  if (news.eventTypes.includes("renewal") && news.currentExpiryDate) {
    details.push(
      news.previousExpiryDate
        ? `到期日由 ${formatChineseDate(news.previousExpiryDate)} 更新至 ${formatChineseDate(news.currentExpiryDate)}`
        : `到期日更新至 ${formatChineseDate(news.currentExpiryDate)}`,
    );
  }
  return `${news.institutionName} ${news.eventTypes.map((type) => eventLabels[type]).join("、")}，总额 ${formatAmount(news.currentAmount)} 亿元；${details.join("；")}`;
}

function formatAmount(value: number): string {
  return value.toFixed(2);
}

function formatChineseDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}
