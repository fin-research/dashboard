import { calculateBusinessAnnualizedReturnTrend } from "../lib/bond-ledger/analytics";
import { formatYield } from "../lib/bond-ledger/format";
import type {
  HoldingTypeStat,
  LedgerTrendAccount,
  LedgerTrendPoint,
  LedgerOperatingTrendPoint,
  LedgerPerformanceRow,
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

const SECONDARY_POOL_BLUE_SCALE = [
  "#1e3a8a",
  "#1d4ed8",
  "#2563eb",
  "#2f6fed",
  "#3b82f6",
  "#60a5fa",
  "#93c5fd",
  "#bfdbfe",
] as const;

const ledgerAxisLabel = {
  ...axisLabel,
  fontWeight: "normal" as const,
};

const ledgerLegend = {
  textStyle: ledgerAxisLabel,
  itemWidth: 16,
  itemHeight: 10,
};

const weeklyAxisLabel = {
  ...ledgerAxisLabel,
  fontSize: 11,
};

const weeklyLegend = {
  textStyle: weeklyAxisLabel,
  itemWidth: 14,
  itemHeight: 8,
};

function monthlyAxisLabel(
  dates: string[],
  index: number,
  value: string,
): string {
  return index === 0 || value.slice(0, 7) !== dates[index - 1]?.slice(0, 7)
    ? value.slice(0, 7)
    : "";
}

export function renderWeeklyPoolScaleLeverage(
  host: HTMLElement,
  points: LedgerPerformanceRow[],
): void {
  if (!points.length) {
    setEmpty(host, "规模与杠杆走势数据暂缺");
    return;
  }
  const dates = points.map((point) => point.date);
  const firstDate = dates[0] ?? "";
  const lastDate = dates.at(-1) ?? "";
  const latest = points.at(-1);
  setChart(host, {
    animationDuration: 240,
    aria: {
      enabled: true,
      description:
        "所选区间业务本金、时间加权本金、全池持仓市值与综合杠杆率走势",
    },
    color: [...FIN_OPS_CHART_PALETTE],
    title: {
      text: `图1：二级资金池规模演变与杠杆率走势（${firstDate}—${lastDate}）`,
      top: 0,
      left: "center",
      textStyle: {
        color: "#0f3d6c",
        fontFamily,
        fontSize: 12,
        fontWeight: "bold",
      },
    },
    legend: [
      {
        ...weeklyLegend,
        data: ["业务本金", "全池持仓市值", "时间加权本金"],
        top: 24,
        left: "center",
      },
      {
        ...weeklyLegend,
        data: ["全池综合杠杆率", "平层基准（100%）"],
        top: "61%",
        left: "center",
      },
    ],
    grid: [
      { left: 10, right: 12, top: 52, height: "43%", containLabel: true },
      { left: 10, right: 12, top: "70%", bottom: 2, containLabel: true },
    ],
    tooltip: {
      ...tooltip,
      trigger: "axis",
      formatter: (params: unknown) => {
        const index = (params as Array<{ dataIndex: number }>)[0]?.dataIndex ?? -1;
        const point = points[index];
        if (!point) return "";
        return [
          `<strong>${escapeHtml(point.date)}</strong>`,
          `业务本金 ${(point.principal / 100_000_000).toFixed(2)} 亿元`,
          `时间加权本金 ${(point.timeWeightedPrincipal / 100_000_000).toFixed(2)} 亿元`,
          `全池持仓市值 ${(point.marketValue / 100_000_000).toFixed(2)} 亿元`,
          `综合杠杆率 ${(point.leverage * 100).toFixed(2)}%`,
        ].join("<br>");
      },
    },
    xAxis: [
      {
        type: "category",
        gridIndex: 0,
        boundaryGap: false,
        data: dates,
        axisLine: { lineStyle: { color: colors.line } },
        axisTick: { show: false },
        axisLabel: { show: false },
      },
      {
        type: "category",
        gridIndex: 1,
        boundaryGap: false,
        data: dates,
        axisLine: { lineStyle: { color: colors.line } },
        axisTick: { show: false },
        axisLabel: {
          ...weeklyAxisLabel,
          interval: (index: number, value: string) =>
            monthlyAxisLabel(dates, index, value) !== "",
          formatter: (value: string, index: number) =>
            monthlyAxisLabel(dates, index, value),
        },
      },
    ],
    yAxis: [
      {
        type: "value",
        gridIndex: 0,
        name: "规模（亿元）",
        scale: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: weeklyAxisLabel,
        nameTextStyle: weeklyAxisLabel,
        splitLine: { lineStyle: gridLine },
      },
      {
        type: "value",
        gridIndex: 0,
        name: "时间加权本金（亿元）",
        scale: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: weeklyAxisLabel,
        nameTextStyle: weeklyAxisLabel,
        splitLine: { show: false },
      },
      {
        type: "value",
        gridIndex: 1,
        name: "杠杆率（%）",
        scale: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { ...weeklyAxisLabel, formatter: "{value}%" },
        nameTextStyle: weeklyAxisLabel,
        splitLine: { lineStyle: gridLine },
      },
    ],
    series: [
      {
        name: "业务本金",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        step: "end",
        showSymbol: false,
        data: points.map((point) => point.principal / 100_000_000),
        lineStyle: { width: 2.2, color: "#0f3d6c" },
        itemStyle: { color: "#0f3d6c" },
      },
      {
        name: "全池持仓市值",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        showSymbol: false,
        smooth: 0.12,
        data: points.map((point) => point.marketValue / 100_000_000),
        lineStyle: { width: 2.4, color: "#0284c7" },
        itemStyle: { color: "#0284c7" },
        markPoint: latest
          ? {
              symbol: "circle",
              symbolSize: 7,
              itemStyle: { color: "#0284c7" },
              label: {
                show: true,
                position: "left",
                distance: 8,
                formatter: `最新持仓 ${(latest.marketValue / 100_000_000).toFixed(2)} 亿\n本金 ${(latest.principal / 100_000_000).toFixed(2)} 亿`,
                color: "#0f3d6c",
                fontFamily,
                fontSize: 10,
                fontWeight: "bold",
                lineHeight: 15,
                backgroundColor: "#eff6ff",
                borderColor: "#bfdbfe",
                borderWidth: 1,
                borderRadius: 3,
                padding: [3, 5],
              },
              data: [{ coord: [lastDate, latest.marketValue / 100_000_000] }],
            }
          : undefined,
      },
      {
        name: "时间加权本金",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 1,
        showSymbol: false,
        data: points.map((point) => point.timeWeightedPrincipal / 100_000_000),
        lineStyle: { width: 2, type: "dashed", color: colors.muted },
        itemStyle: { color: colors.muted },
      },
      {
        name: "全池综合杠杆率",
        type: "line",
        xAxisIndex: 1,
        yAxisIndex: 2,
        showSymbol: false,
        data: points.map((point) => point.leverage * 100),
        lineStyle: { width: 2.2, color: "#0f3d6c" },
        itemStyle: { color: "#0f3d6c" },
        markPoint: latest
          ? {
              symbol: "circle",
              symbolSize: 7,
              itemStyle: { color: "#dc2626" },
              label: {
                show: true,
                position: "left",
                formatter: `最新 ${(latest.leverage * 100).toFixed(2)}%`,
                color: "#0f3d6c",
                fontFamily,
                fontSize: 10,
                fontWeight: "bold",
                backgroundColor: "#ffffff",
                borderColor: "#cbd5e1",
                borderWidth: 1,
                borderRadius: 3,
                padding: [2, 4],
              },
              data: [{ coord: [lastDate, latest.leverage * 100] }],
            }
          : undefined,
      },
      {
        name: "平层基准（100%）",
        type: "line",
        xAxisIndex: 1,
        yAxisIndex: 2,
        showSymbol: false,
        silent: true,
        data: points.map(() => 100),
        lineStyle: { color: colors.red, type: "dotted", width: 1.4 },
        itemStyle: { color: colors.red },
      },
    ],
  });
}

export function renderWeeklyYieldProfitTrend(
  host: HTMLElement,
  points: LedgerOperatingTrendPoint[],
): void {
  if (!points.length) {
    setEmpty(host, "收益率与累计创收数据暂缺");
    return;
  }
  const dates = points.map((point) => point.date);
  const firstDate = dates[0] ?? "";
  const lastDate = dates.at(-1) ?? "";
  setChart(host, {
    animationDuration: 240,
    aria: {
      enabled: true,
      description:
        "所选区间全池含免税及不含免税年化收益率、平层静态、累计毛利与免税增厚走势",
    },
    color: [...FIN_OPS_CHART_PALETTE],
    title: {
      text: `图2：二级资金池收益率与累计创收走势（${firstDate}—${lastDate}）`,
      top: 0,
      left: "center",
      textStyle: {
        color: "#0f3d6c",
        fontFamily,
        fontSize: 12,
        fontWeight: "bold",
      },
    },
    legend: { ...weeklyLegend, top: 24, left: 8 },
    grid: [
      { left: 10, right: 12, top: 62, height: "42%", containLabel: true },
      { left: 10, right: 12, top: "72%", bottom: 2, containLabel: true },
    ],
    tooltip: {
      ...tooltip,
      trigger: "axis",
      formatter: (params: unknown) => {
        const index = (params as Array<{ dataIndex: number }>)[0]?.dataIndex ?? -1;
        const point = points[index];
        if (!point) return "";
        const percent = (value: number | null) =>
          value === null ? "—" : `${(value * 100).toFixed(3)}%`;
        return [
          `<strong>${escapeHtml(point.date)}</strong>`,
          `含免税年化收益率 ${percent(point.fullPoolYtdAnnualizedReturn)}`,
          `不含免税年化收益率 ${percent(point.fullPoolYtdExTaxAnnualizedReturn)}`,
          `平层静态 ${point.flatStatic === null ? "—" : `${point.flatStatic.toFixed(3)}%`}`,
          `累计毛利 ${(point.cumulativeProfit / 10_000).toFixed(1)} 万元`,
          `免税增厚 ${point.cumulativeTaxExemptProfit === null ? "—" : `${(point.cumulativeTaxExemptProfit / 10_000).toFixed(1)} 万元`}`,
        ].join("<br>");
      },
    },
    xAxis: [
      {
        type: "category",
        gridIndex: 0,
        boundaryGap: false,
        data: dates,
        axisLine: { lineStyle: { color: colors.line } },
        axisTick: { show: false },
        axisLabel: { show: false },
      },
      {
        type: "category",
        gridIndex: 1,
        boundaryGap: false,
        data: dates,
        axisLine: { lineStyle: { color: colors.line } },
        axisTick: { show: false },
        axisLabel: {
          ...weeklyAxisLabel,
          interval: (index: number, value: string) =>
            monthlyAxisLabel(dates, index, value) !== "",
          formatter: (value: string, index: number) =>
            monthlyAxisLabel(dates, index, value),
        },
      },
    ],
    yAxis: [
      {
        type: "value",
        gridIndex: 0,
        name: "收益率（%）",
        scale: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { ...weeklyAxisLabel, formatter: "{value}%" },
        nameTextStyle: weeklyAxisLabel,
        splitLine: { lineStyle: gridLine },
      },
      {
        type: "value",
        gridIndex: 1,
        name: "累计创收（万元）",
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: weeklyAxisLabel,
        nameTextStyle: weeklyAxisLabel,
        splitLine: { lineStyle: gridLine },
      },
    ],
    series: [
      {
        name: "含免税年化收益率",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        showSymbol: false,
        data: points.map((point) =>
          point.fullPoolYtdAnnualizedReturn === null
            ? null
            : point.fullPoolYtdAnnualizedReturn * 100,
        ),
        lineStyle: { width: 2.4, color: "#0f3d6c" },
        itemStyle: { color: "#0f3d6c" },
      },
      {
        name: "不含免税年化收益率",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        showSymbol: false,
        data: points.map((point) =>
          point.fullPoolYtdExTaxAnnualizedReturn === null
            ? null
            : point.fullPoolYtdExTaxAnnualizedReturn * 100,
        ),
        lineStyle: { width: 2, type: "dashed", color: colors.muted },
        itemStyle: { color: colors.muted },
      },
      {
        name: "平层静态",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        showSymbol: false,
        data: points.map((point) => point.flatStatic),
        lineStyle: { width: 2, type: "dotted", color: "#d97706" },
        itemStyle: { color: "#d97706" },
      },
      {
        name: "累计毛利（含免税）",
        type: "line",
        xAxisIndex: 1,
        yAxisIndex: 1,
        showSymbol: false,
        data: points.map((point) => point.cumulativeProfit / 10_000),
        lineStyle: { width: 2.2, color: "#0f3d6c" },
        itemStyle: { color: "#0f3d6c" },
        areaStyle: { color: "rgba(15,61,108,.10)" },
      },
      {
        name: "免税增厚",
        type: "line",
        xAxisIndex: 1,
        yAxisIndex: 1,
        showSymbol: false,
        data: points.map((point) =>
          point.cumulativeTaxExemptProfit === null
            ? null
            : point.cumulativeTaxExemptProfit / 10_000,
        ),
        lineStyle: { width: 2, type: "dashed", color: "#d97706" },
        itemStyle: { color: "#d97706" },
      },
    ],
  });
}

export function renderWeeklyTradingAllocation(
  host: HTMLElement,
  stats: HoldingTypeStat[],
): void {
  const valid = stats.filter((stat) => stat.marketValue > 0);
  if (!valid.length) {
    setEmpty(host, "交易户资产配置数据暂缺");
    return;
  }
  setChart(host, {
    animationDuration: 220,
    aria: { enabled: true, description: "按交易户市值统计的资产类别结构" },
    title: {
      text: `图3A：交易户资产类别结构（${(valid.reduce((sum, stat) => sum + stat.marketValue, 0) / 100_000_000).toFixed(2)}亿元）`,
      top: 0,
      left: "center",
      textStyle: {
        color: "#0f3d6c",
        fontFamily,
        fontSize: 10,
        fontWeight: "bold",
      },
    },
    grid: { left: 4, right: 12, top: 30, bottom: 2, containLabel: true },
    tooltip: {
      ...tooltip,
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: unknown) => {
        const index = (params as Array<{ dataIndex: number }>)[0]?.dataIndex ?? -1;
        const stat = valid[index];
        if (!stat) return "";
        return [
          `<strong>${escapeHtml(stat.category)}</strong>`,
          `市值 ${(stat.marketValue / 100_000_000).toFixed(2)} 亿元`,
          `占比 ${(stat.share * 100).toFixed(1)}%`,
        ].join("<br>");
      },
    },
    xAxis: {
      type: "value",
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { ...weeklyAxisLabel, fontSize: 9, formatter: "{value}亿" },
      splitLine: { lineStyle: gridLine },
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: valid.map((stat) => stat.category),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { ...weeklyAxisLabel, fontSize: 9 },
    },
    series: [
      {
        name: "交易户市值",
        type: "bar",
        barMaxWidth: 22,
        data: valid.map((stat, index) => ({
          value: stat.marketValue / 100_000_000,
          itemStyle: {
            color:
              SECONDARY_POOL_BLUE_SCALE[
                Math.min(index, SECONDARY_POOL_BLUE_SCALE.length - 1)
              ],
            borderRadius: [0, 4, 4, 0],
          },
        })),
        label: {
          show: true,
          position: "right",
          color: colors.ink,
          fontFamily,
          fontSize: 9,
          fontWeight: "bold",
          formatter: ({ dataIndex }: { dataIndex: number }) =>
            `${((valid[dataIndex]?.share ?? 0) * 100).toFixed(1)}%`,
        },
      },
    ],
  });
}

export function renderWeeklyTradingMaturity(
  host: HTMLElement,
  stats: MaturityBucketStat[],
): void {
  if (!stats.some((stat) => stat.marketValue > 0)) {
    setEmpty(host, "交易户期限分布数据暂缺");
    return;
  }
  setChart(host, {
    animationDuration: 220,
    aria: { enabled: true, description: "按交易户市值统计的八档剩余期限分布" },
    title: {
      text: "图3B：交易户期限分布",
      top: 0,
      left: "center",
      textStyle: {
        color: "#0f3d6c",
        fontFamily,
        fontSize: 10,
        fontWeight: "bold",
      },
    },
    grid: { left: 4, right: 4, top: 30, bottom: 2, containLabel: true },
    tooltip: {
      ...tooltip,
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: unknown) => {
        const index = (params as Array<{ dataIndex: number }>)[0]?.dataIndex ?? -1;
        const stat = stats[index];
        if (!stat) return "";
        return [
          `<strong>${escapeHtml(stat.bucket)}</strong>`,
          `市值 ${(stat.marketValue / 100_000_000).toFixed(2)} 亿元`,
          `占比 ${(stat.share * 100).toFixed(1)}%`,
        ].join("<br>");
      },
    },
    xAxis: {
      type: "category",
      data: stats.map((stat) => stat.bucket),
      axisLine: { lineStyle: { color: colors.line } },
      axisTick: { show: false },
      axisLabel: { ...weeklyAxisLabel, fontSize: 9, interval: 0, rotate: 28 },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { ...weeklyAxisLabel, fontSize: 9, formatter: "{value}亿" },
      splitLine: { lineStyle: gridLine },
    },
    series: [
      {
        name: "交易户市值",
        type: "bar",
        barMaxWidth: 28,
        data: stats.map((stat) => stat.marketValue / 100_000_000),
        itemStyle: { color: "#0f3d6c", borderRadius: [4, 4, 0, 0] },
        label: {
          show: true,
          position: "top",
          color: colors.ink,
          fontFamily,
          fontSize: 9,
          fontWeight: "bold",
          formatter: ({ dataIndex, value }: { dataIndex: number; value: number }) =>
            value > 0
              ? `${((stats[dataIndex]?.share ?? 0) * 100).toFixed(1)}%`
              : "",
        },
      },
    ],
  });
}

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
