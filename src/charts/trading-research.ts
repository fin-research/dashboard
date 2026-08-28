import { setChart, type ChartOption } from "./charting";
import {
  axisLabel,
  chartTextSize,
  colors,
  fontFamily,
  gridLine,
  tooltip,
} from "./common";
import { formatEconomicIndicatorTooltip } from "../lib/trading-research/economic-indicators";

export const WORKBENCH_CHART_PALETTE = [
  "#2f6fed",
  "#16a394",
  "#6941c6",
  "#f79009",
  "#d92d20",
  "#0ba5ec",
  "#6172f3",
  "#12b76a",
] as const;

export type WorkbenchBarDatum = {
  label: string;
  value: number;
  color?: string;
};

export type WorkbenchCurvePoint = {
  tenor: string;
  value: number;
};

export type EconomicIndicatorTrendPoint = {
  date: string;
  value: number;
};

type WorkbenchHistory = {
  dates: readonly string[];
  series: Array<{ name: string; values: readonly number[] }>;
};

export function renderWorkbenchBarChart(
  host: HTMLElement,
  data: readonly WorkbenchBarDatum[],
  description: string,
  unit: string,
  max?: number,
  thresholds: readonly number[] = [],
): void {
  const option: ChartOption = {
    animationDuration: 240,
    aria: { enabled: true, description },
    color: [...WORKBENCH_CHART_PALETTE],
    tooltip: {
      ...tooltip,
      trigger: "axis",
      axisPointer: { type: "shadow" },
      valueFormatter: (value: unknown) => `${Number(value).toFixed(1)}${unit}`,
    },
    grid: { left: 8, right: 76, top: 10, bottom: 24, containLabel: true },
    xAxis: {
      type: "value",
      min: 0,
      max,
      axisLabel: {
        ...axisLabel,
        formatter: (value: number) => `${value}${unit}`,
      },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: gridLine },
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: data.map((item) => item.label),
      axisLabel: { ...axisLabel, color: colors.ink },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series: [
      {
        name: unit === "%" ? "占比" : "数值",
        type: "bar",
        barMaxWidth: 18,
        showBackground: true,
        backgroundStyle: { color: colors.brandSoft, borderRadius: 5 },
        data: data.map((item, index) => ({
          value: item.value,
          itemStyle: {
            color: item.color ?? WORKBENCH_CHART_PALETTE[index % WORKBENCH_CHART_PALETTE.length],
            borderRadius: [0, 5, 5, 0],
          },
        })),
        label: {
          show: true,
          position: "right",
          color: colors.ink,
          fontFamily,
          fontSize: chartTextSize,
          fontWeight: "normal",
          formatter: ({ value }: { value: unknown }) =>
            `${Number(value).toFixed(1)}${unit}`,
        },
        markLine: thresholds.length
          ? {
              silent: true,
              symbol: "none",
              data: thresholds.map((value) => ({ xAxis: value })),
              label: {
                color: colors.muted,
                fontFamily,
                fontSize: Math.max(chartTextSize - 2, 12),
                formatter: ({ value }: { value: unknown }) => `${value}%`,
              },
              lineStyle: { color: colors.zero, type: "dashed", width: 1 },
            }
          : undefined,
      },
    ],
  };
  setChart(host, option);
}

export function renderWorkbenchHistoryChart(
  host: HTMLElement,
  history: WorkbenchHistory,
  description: string,
): void {
  const option: ChartOption = {
    animationDuration: 240,
    aria: { enabled: true, description },
    color: [...WORKBENCH_CHART_PALETTE],
    tooltip: {
      ...tooltip,
      trigger: "axis",
      valueFormatter: (value: unknown) => `${Number(value).toFixed(4)}%`,
    },
    legend: {
      top: 0,
      textStyle: {
        color: colors.ink,
        fontFamily,
        fontSize: chartTextSize,
        fontWeight: "normal",
      },
    },
    grid: { left: 18, right: 22, top: 48, bottom: 32, containLabel: true },
    xAxis: {
      type: "category",
      data: [...history.dates],
      boundaryGap: false,
      axisLabel,
      axisLine: { lineStyle: { color: colors.line } },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      name: "%",
      nameTextStyle: axisLabel,
      axisLabel,
      splitLine: { lineStyle: gridLine },
    },
    series: history.series.map((series) => ({
      name: series.name,
      type: "line",
      smooth: true,
      showSymbol: false,
      symbolSize: 7,
      lineStyle: { width: 2.5 },
      data: [...series.values],
    })),
  };
  setChart(host, option);
}

export function renderWorkbenchCurveChart(
  host: HTMLElement,
  name: string,
  points: readonly WorkbenchCurvePoint[],
  description: string,
): void {
  const option: ChartOption = {
    animationDuration: 240,
    aria: { enabled: true, description },
    color: [WORKBENCH_CHART_PALETTE[0]],
    tooltip: {
      ...tooltip,
      trigger: "axis",
      valueFormatter: (value: unknown) => `${Number(value).toFixed(4)}%`,
    },
    grid: { left: 16, right: 20, top: 24, bottom: 28, containLabel: true },
    xAxis: {
      type: "category",
      data: points.map((point) => point.tenor),
      boundaryGap: false,
      axisLabel,
      axisLine: { lineStyle: { color: colors.line } },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      scale: true,
      name: "%",
      nameTextStyle: axisLabel,
      axisLabel,
      splitLine: { lineStyle: gridLine },
    },
    series: [
      {
        name,
        type: "line",
        smooth: true,
        symbolSize: 7,
        lineStyle: { width: 2.5 },
        areaStyle: { color: "rgba(47, 111, 237, 0.08)" },
        data: points.map((point) => point.value),
      },
    ],
  };
  setChart(host, option);
}

export function renderEconomicIndicatorTrend(
  host: HTMLElement,
  points: readonly EconomicIndicatorTrendPoint[],
  description: string,
  unit: string,
  decimals: number,
  color: string,
): void {
  const values = points.map((point) => point.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const crossesZero = minimum < 0 && maximum > 0;
  const option: ChartOption = {
    animationDuration: 220,
    aria: { enabled: true, description },
    color: [color],
    tooltip: {
      ...tooltip,
      trigger: "axis",
      formatter: (params: unknown) =>
        formatEconomicIndicatorTooltip(params, unit, decimals),
    },
    grid: { left: 2, right: 2, top: 8, bottom: 2 },
    xAxis: {
      type: "category",
      data: points.map((point) => point.date),
      boundaryGap: false,
      show: false,
    },
    yAxis: {
      type: "value",
      scale: true,
      show: false,
    },
    series: [
      {
        name: description,
        type: "line",
        smooth: 0.3,
        showSymbol: false,
        lineStyle: { width: 2.25, cap: "round" },
        areaStyle: { color: `${color}18` },
        data: values,
        markLine: crossesZero
          ? {
              silent: true,
              symbol: "none",
              data: [{ yAxis: 0 }],
              label: { show: false },
              lineStyle: { color: colors.zero, type: "dashed", width: 1 },
            }
          : undefined,
      },
    ],
  };
  setChart(host, option);
}
