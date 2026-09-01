import { calculateBusinessAnnualizedReturnTrend } from "../lib/bond-ledger/analytics";
import { formatYield } from "../lib/bond-ledger/format";
import type {
  HoldingTypeStat,
  LedgerTrendAccount,
  LedgerTrendPoint,
  MaturityBucketStat,
} from "../lib/bond-ledger/types";
import {
  axisLabel,
  chartTextSize,
  colors,
  escapeHtml,
  fontFamily,
  gridLine,
  tooltip,
} from "./common";
import { setChart, setEmpty } from "./charting";

export const FIN_OPS_CHART_PALETTE = [
  "#2f6fed",
  "#16a394",
  "#6941c6",
  "#f79009",
  "#d92d20",
  "#0ba5ec",
  "#6172f3",
  "#12b76a",
] as const;

const ledgerAxisLabel = {
  ...axisLabel,
  fontWeight: "normal" as const,
};

export function renderBondScaleReturnTrend(
  host: HTMLElement,
  points: LedgerTrendPoint[],
  startDate: string,
  endDate: string,
  account: LedgerTrendAccount,
): void {
  if (!points.length) {
    setEmpty(host, "规模与收益率走势数据暂缺");
    return;
  }
  const dates = points.map((point) => point.date);
  const annualizedReturnTrend = calculateBusinessAnnualizedReturnTrend(points);
  const returns = annualizedReturnTrend.map(({ value }) =>
    value === null ? null : value * 100,
  );
  const selectedReturns = points.map((point, index) =>
    point.date >= startDate && point.date <= endDate
      ? returns[index]
      : null,
  );
  const returnLabel = account === "all" ? "年化收益率" : "年化收益贡献";
  const validReturns = returns.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );
  const returnAxisMin =
    account === "all" || !validReturns.length
      ? 0
      : Math.min(0, Math.floor(Math.min(...validReturns)));
  const returnAxisMax =
    account === "all" || !validReturns.length
      ? 4
      : Math.max(4, Math.ceil(Math.max(...validReturns)));
  setChart(host, {
    animationDuration: 240,
    aria: {
      enabled: true,
      description: `二级资金池规模面积图与业务口径${returnLabel}双轴折线图，所选日期范围使用强调色`,
    },
    color: [...FIN_OPS_CHART_PALETTE],
    grid: { left: 18, right: 18, top: 28, bottom: 4, containLabel: true },
    tooltip: {
      ...tooltip,
      trigger: "axis",
      formatter: (params: unknown) => {
        const items = params as Array<{ dataIndex: number }>;
        const dataIndex = items[0]?.dataIndex ?? -1;
        const point = points[dataIndex];
        if (!point) return "";
        const annualizedReturn = annualizedReturnTrend[dataIndex]?.value ?? null;
        return [
          `<strong>${escapeHtml(point.date)}</strong>`,
          `规模 ${(point.marketValue / 100_000_000).toFixed(2)} 亿元`,
          `${returnLabel} ${annualizedReturn === null ? "—" : `${(annualizedReturn * 100).toFixed(3)}%`}`,
          `当日损益 ${(point.dailyRevenue / 10_000).toFixed(1)} 万元`,
        ].join("<br>");
      },
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: dates,
      axisLine: { lineStyle: { color: colors.line } },
      axisTick: { show: false },
      axisLabel: {
        ...ledgerAxisLabel,
        hideOverlap: true,
        formatter: (value: string) => value.slice(5).replace("-", "/"),
      },
    },
    yAxis: [
      {
        type: "value",
        name: "规模（亿元）",
        scale: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: ledgerAxisLabel,
        nameTextStyle: { ...ledgerAxisLabel, align: "left" },
        splitLine: { lineStyle: gridLine },
      },
      {
        type: "value",
        name: returnLabel,
        min: returnAxisMin,
        max: returnAxisMax,
        interval: 1,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { ...ledgerAxisLabel, formatter: "{value}%" },
        nameTextStyle: { ...ledgerAxisLabel, align: "right" },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: "规模",
        type: "line",
        yAxisIndex: 0,
        data: points.map((point) => point.marketValue / 100_000_000),
        showSymbol: false,
        smooth: 0.12,
        lineStyle: { color: FIN_OPS_CHART_PALETTE[0], width: 2 },
        itemStyle: { color: FIN_OPS_CHART_PALETTE[0] },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(47,111,237,.34)" },
              { offset: 1, color: "rgba(47,111,237,.04)" },
            ],
          },
        },
      },
      {
        name: returnLabel,
        type: "line",
        yAxisIndex: 1,
        data: returns,
        connectNulls: false,
        showSymbol: false,
        smooth: 0.12,
        lineStyle: { color: FIN_OPS_CHART_PALETTE[2], width: 2.2 },
        itemStyle: { color: FIN_OPS_CHART_PALETTE[2] },
      },
      {
        name: "所选区间",
        type: "line",
        yAxisIndex: 1,
        data: selectedReturns,
        connectNulls: false,
        showSymbol: true,
        symbol: "circle",
        symbolSize: 7,
        lineStyle: { color: FIN_OPS_CHART_PALETTE[3], width: 3.2 },
        itemStyle: {
          color: colors.paper,
          borderColor: FIN_OPS_CHART_PALETTE[3],
          borderWidth: 2,
        },
      },
    ],
  });
}

export function renderHoldingDistribution(
  host: HTMLElement,
  stats: HoldingTypeStat[],
): void {
  const valid = stats.filter((stat) => stat.marketValue > 0);
  if (!valid.length) {
    setEmpty(host, "持仓分布数据暂缺");
    return;
  }
  setChart(host, {
    animationDuration: 220,
    aria: {
      enabled: true,
      description: "按债券类型统计全价市值的持仓分布饼图",
    },
    color: [...FIN_OPS_CHART_PALETTE],
    legend: {
      type: "scroll",
      orient: "vertical",
      right: 8,
      top: "middle",
      itemWidth: 12,
      itemHeight: 12,
      textStyle: ledgerAxisLabel,
    },
    tooltip: {
      ...tooltip,
      trigger: "item",
      formatter: (param: unknown) => {
        const item = param as { dataIndex: number };
        const stat = valid[item.dataIndex];
        if (!stat) return "";
        return [
          `<strong>${escapeHtml(stat.category)}</strong>`,
          `规模 ${(stat.marketValue / 100_000_000).toFixed(2)} 亿元`,
          `占比 ${(stat.share * 100).toFixed(1)}%`,
          `券数 ${stat.positionCount} 只`,
          `市值加权收益率 ${escapeHtml(formatYield(stat.weightedYield))}`,
        ].join("<br>");
      },
    },
    series: [
      {
        name: "持仓分布",
        type: "pie",
        radius: ["38%", "68%"],
        center: ["38%", "52%"],
        avoidLabelOverlap: true,
        minAngle: 2,
        itemStyle: {
          borderColor: colors.paper,
          borderWidth: 2,
          borderRadius: 3,
        },
        label: {
          show: true,
          color: colors.ink,
          fontFamily,
          fontSize: chartTextSize,
          formatter: ({ name, percent }: { name: string; percent: number }) =>
            `${name} ${percent.toFixed(1)}%`,
        },
        labelLine: { length: 12, length2: 8 },
        data: valid.map((stat) => ({
          name: stat.category,
          value: stat.marketValue,
        })),
      },
    ],
  });
}

export function renderMaturityDistribution(
  host: HTMLElement,
  stats: MaturityBucketStat[],
): void {
  if (!stats.some((stat) => stat.marketValue > 0)) {
    setEmpty(host, "期限分布数据暂缺");
    return;
  }
  setChart(host, {
    animationDuration: 220,
    aria: {
      enabled: true,
      description: "按八个剩余期限区间统计持仓全价市值的直方图",
    },
    color: [...FIN_OPS_CHART_PALETTE],
    grid: { left: 8, right: 8, top: 28, bottom: 4, containLabel: true },
    tooltip: {
      ...tooltip,
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: unknown) => {
        const item = (params as Array<{ dataIndex: number }>)[0];
        const stat = stats[item?.dataIndex ?? -1];
        if (!stat) return "";
        return [
          `<strong>${escapeHtml(stat.bucket)}</strong>`,
          `规模 ${(stat.marketValue / 100_000_000).toFixed(2)} 亿元`,
          `占比 ${(stat.share * 100).toFixed(1)}%`,
          `券数 ${stat.positionCount} 只`,
          `市值加权收益率 ${escapeHtml(formatYield(stat.weightedYield))}`,
        ].join("<br>");
      },
    },
    xAxis: {
      type: "category",
      data: stats.map((stat) => stat.bucket),
      axisLine: { lineStyle: { color: colors.line } },
      axisTick: { show: false },
      axisLabel: { ...ledgerAxisLabel, interval: 0 },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { ...ledgerAxisLabel, formatter: "{value}亿" },
      splitLine: { lineStyle: gridLine },
    },
    series: [
      {
        name: "规模",
        type: "bar",
        barCategoryGap: "18%",
        data: stats.map((stat, index) => ({
          value: stat.marketValue / 100_000_000,
          itemStyle: {
            color:
              FIN_OPS_CHART_PALETTE[index % FIN_OPS_CHART_PALETTE.length],
            borderRadius: [3, 3, 0, 0],
          },
        })),
        label: {
          show: true,
          position: "top",
          color: colors.ink,
          fontFamily,
          fontSize: chartTextSize,
          fontWeight: "bold",
          formatter: ({ value }: { value: number }) =>
            value > 0 ? value.toFixed(1) : "",
        },
      },
    ],
  });
}
