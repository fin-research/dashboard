import type {
  ComparablePoint,
  MarketMetric,
  ReportData,
} from "./types";

export interface TextReportEntry {
  text: string;
  strong?: boolean;
}

export interface TextReportGroup {
  label: string;
  entries: TextReportEntry[];
}

export interface TextReportSection {
  title: string;
  paragraphs: string[];
  groups: TextReportGroup[];
}

export interface TextReportView {
  title: string;
  sections: TextReportSection[];
}

const PRIMARY_CATEGORY_ORDER = [
  "短融",
  "公募短债",
  "小公募",
  "公募次级债",
  "私募债",
];

export function buildTextReport(
  data: ReportData,
  focusText: string,
): TextReportView {
  const primaryGroups = primaryIssueGroups(data);
  const comparableEntries = comparableTextEntries(data.comparable);
  const inventoryEntries = data.inventory.map((point) => {
    const tradeText = Number.isFinite(point.trade_yield)
      ? `-成交${reportNumber(point.trade_yield!, 4)}%`
      : "";
    const quoteText = Number.isFinite(point.trade_yield)
      ? ""
      : [
          Number.isFinite(point.bid_yield)
            ? `Bid${reportNumber(point.bid_yield!, 4)}%`
            : "",
          Number.isFinite(point.ofr_yield)
            ? `Ofr${reportNumber(point.ofr_yield!, 4)}%`
            : "",
        ]
          .filter(Boolean)
          .join("-");
    return {
      text: `${tenorLabel(point.tenor_years)}-${point.bond_name}-估值${reportNumber(point.valuation, 4)}%${tradeText}${quoteText ? `-${quoteText}` : ""}`,
      strong: Number.isFinite(point.trade_yield),
    };
  });

  return {
    title: `${data.report_date.replaceAll("-", "")} 境内市场点评`,
    sections: [
      {
        title: "央行",
        paragraphs: [omoParagraph(data)],
        groups: [],
      },
      {
        title: "利率",
        paragraphs: [
          metricParagraph("资金利率方面", data.funds),
          metricParagraph("国债收益率方面", data.government_bonds),
        ],
        groups: [],
      },
      {
        title: "股市",
        paragraphs: equityParagraphs(data),
        groups: [],
      },
      {
        title: "一级发行",
        paragraphs: [],
        groups: [
          {
            label: "可比证券公司发行情况：",
            entries: primaryGroups.length
              ? []
              : [{ text: "今日暂无。" }],
          },
          ...primaryGroups,
        ],
      },
      {
        title: "二级行情",
        paragraphs: [],
        groups: [
          {
            label: "可比证券公司债券成交：（公募债）",
            entries: comparableEntries.length
              ? comparableEntries
              : [{ text: "今日暂无。" }],
          },
          {
            label: "东财存量债券：",
            entries: inventoryEntries.length
              ? inventoryEntries
              : [{ text: "今日暂无。" }],
          },
        ],
      },
      {
        title: "今日聚焦",
        paragraphs: [focusText || "尚未填写今日聚焦。"],
        groups: [],
      },
    ],
  };
}

function omoParagraph(data: ReportData): string {
  const point = [...data.omo_history]
    .filter((item) => item.day <= data.report_date)
    .sort((left, right) => left.day.localeCompare(right.day))
    .at(-1);
  if (!point || point.day !== data.report_date) {
    return "中国央行今日公开市场操作净额暂缺。";
  }
  if (point.net_amount > 0) {
    return `中国央行今日公开市场操作净投放${reportNumber(point.net_amount)}亿元。`;
  }
  if (point.net_amount < 0) {
    return `中国央行今日公开市场操作净回笼${reportNumber(Math.abs(point.net_amount))}亿元。`;
  }
  return "中国央行今日公开市场操作净投放为零。";
}

function metricParagraph(lead: string, metrics: MarketMetric[]): string {
  const entries = metrics
    .filter((metric) => Number.isFinite(metric.value))
    .map((metric) => {
      const change = Number.isFinite(metric.change)
        ? `，较前日${metric.change! > 0 ? "上行" : metric.change! < 0 ? "下行" : "持平"}${metric.change === 0 ? "" : `${reportNumber(Math.abs(metric.change!), 2)}bp`}`
        : "";
      return `${metric.label}为${reportNumber(metric.value!, 4)}${metric.unit}${change}`;
    });
  return entries.length ? `${lead}，${entries.join("；")}。` : `${lead}数据暂缺。`;
}

function equityParagraphs(data: ReportData): string[] {
  const paragraphs: string[] = [];
  const indexEntries = data.equities
    .filter(
      (point) =>
        Number.isFinite(point.close) && Number.isFinite(point.change_pct),
    )
    .map((point) => {
      const movement =
        point.change_pct > 0 ? "上涨" : point.change_pct < 0 ? "下跌" : "持平";
      const change = point.change_pct === 0
        ? ""
        : `${reportNumber(Math.abs(point.change_pct), 2)}%`;
      return `${point.name}收于${reportNumber(point.close, 2)}点，${movement}${change}`;
    });
  paragraphs.push(
    indexEntries.length
      ? `主要股指方面，${indexEntries.join("；")}。`
      : "主要股指数据暂缺。",
  );

  if (Number.isFinite(data.turnover_yi)) {
    paragraphs.push(
      `沪深京三市成交额${reportNumber(data.turnover_yi!)}亿元${amountChange(data.turnover_change_yi)}。`,
    );
  }

  if (Number.isFinite(data.margin.total)) {
    const dateText = data.margin.data_date
      ? `${Number(data.margin.data_date.slice(5, 7))}月${Number(data.margin.data_date.slice(8, 10))}日`
      : data.report_date;
    paragraphs.push(
      `截至${dateText}，沪深京三市融资融券余额合计${reportNumber(data.margin.total!)}亿元${amountChange(data.margin.total_change)}。`,
    );
  }
  return paragraphs;
}

function amountChange(value: number | null): string {
  if (!Number.isFinite(value)) return "，较前一交易日变动暂缺";
  if (value === 0) return "，较前一交易日持平";
  return `，较前一交易日${value! > 0 ? "增加" : "减少"}${reportNumber(Math.abs(value!), 2)}亿元`;
}

function primaryIssueGroups(data: ReportData): TextReportGroup[] {
  return PRIMARY_CATEGORY_ORDER.flatMap((category) => {
    const points = data.primary
      .filter((point) => point.category === category)
      .sort(
        (left, right) =>
          left.issuer.localeCompare(right.issuer, "zh-CN") ||
          left.tenor_years - right.tenor_years,
      );
    if (!points.length) return [];
    return [
      {
        label: `${category}：`,
        entries: points.map((point) => ({
          text: `${point.issue_date}-${point.issuer}-${tenorLabel(point.tenor_years)}-${reportNumber(point.amount)}亿-${reportNumber(point.coupon, 4)}%`,
        })),
      },
    ];
  });
}

function comparableTextEntries(points: ComparablePoint[]): TextReportEntry[] {
  const candidates = points.filter(
    (point) =>
      Number.isFinite(point.tenor_years) &&
      Number.isFinite(point.trade_yield) &&
      point.tenor_years <= 5,
  );
  const used = new Set<ComparablePoint>();
  return [3, 2, 1].flatMap((target) => {
    const point = candidates
      .filter((candidate) => !used.has(candidate))
      .sort(
        (left, right) =>
          Math.abs(left.tenor_years - target) -
            Math.abs(right.tenor_years - target) ||
          left.tenor_years - right.tenor_years,
      )[0];
    if (!point) return [];
    used.add(point);
    return [
      {
        text: `${tenorLabel(point.tenor_years)}-${point.issuer}(${point.bond_name})-成交${reportNumber(point.trade_yield, 4)}%`,
      },
    ];
  });
}

function tenorLabel(value: number): string {
  if (value < 1) return `${Math.round(value * 365)}天`;
  return `${reportNumber(value, 3)}年`;
}

function reportNumber(value: number, maximumFractionDigits = 2): string {
  return value.toLocaleString("zh-CN", { maximumFractionDigits });
}
