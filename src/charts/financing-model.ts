import type { FinancingModelSnapshot } from "../lib/financing-model";
import {
  axisLabel,
  colors,
  escapeHtml,
  gridLine,
  tooltip,
} from "./common";
import { setChart, setEmpty } from "./charting";

const forecastAxisLabel = {
  ...axisLabel,
  fontWeight: "normal" as const,
};

export function renderFinancingForecast(
  host: HTMLElement,
  rows: FinancingModelSnapshot["forecast_window"],
): void {
  if (!rows.length) {
    setEmpty(host, "未来窗口预测暂缺");
    return;
  }
  setChart(host, {
    animationDuration: 220,
    aria: {
      enabled: true,
      description:
        "未来发行窗口预测图，折线表示相对可比债中位数的预测偏离，柱形表示相对窗口中位数的成本变化",
    },
    color: ["#2f6fed", "#16a394"],
    legend: {
      top: 0,
      right: 0,
      itemWidth: 16,
      itemHeight: 10,
      textStyle: forecastAxisLabel,
      data: ["预测偏离", "相对窗口中位数"],
    },
    grid: { left: 12, right: 16, top: 38, bottom: 6, containLabel: true },
    tooltip: {
      ...tooltip,
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: unknown) => {
        const item = (params as Array<{ dataIndex: number }>)[0];
        const row = rows[item?.dataIndex ?? -1];
        if (!row) return "";
        return [
          `<strong>${escapeHtml(row.date)} ${escapeHtml(row.weekday)}</strong>`,
          `预测偏离 ${signed(row.pred_bp, 2)} bp`,
          `历史分位 P${row.percentile.toFixed(1)}`,
          `窗口变化 ${signed(row.savings_bp_vs_window_median, 2)} bp`,
          `年化金额 ${signed(row["savings_万元/年"], 1)} 万元`,
          `建议 ${escapeHtml(row.label)}`,
        ].join("<br>");
      },
    },
    xAxis: {
      type: "category",
      data: rows.map((row) => row.date),
      axisLine: { lineStyle: { color: colors.line } },
      axisTick: { show: false },
      axisLabel: {
        ...forecastAxisLabel,
        interval: 0,
        formatter: (value: string) => value.slice(5).replace("-", "/"),
      },
    },
    yAxis: {
      type: "value",
      name: "bp",
      scale: true,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: forecastAxisLabel,
      nameTextStyle: { ...forecastAxisLabel, align: "left" },
      splitLine: { lineStyle: gridLine },
    },
    series: [
      {
        name: "相对窗口中位数",
        type: "bar",
        barMaxWidth: 28,
        data: rows.map((row) => ({
          value: row.savings_bp_vs_window_median,
          itemStyle: {
            color:
              row.savings_bp_vs_window_median <= 0 ? "#16a394" : "#d92d20",
            borderRadius:
              row.savings_bp_vs_window_median <= 0 ? [0, 0, 3, 3] : [3, 3, 0, 0],
          },
        })),
      },
      {
        name: "预测偏离",
        type: "line",
        data: rows.map((row) => row.pred_bp),
        symbol: "circle",
        symbolSize: 7,
        smooth: 0.12,
        lineStyle: { color: "#2f6fed", width: 2.4 },
        itemStyle: {
          color: colors.paper,
          borderColor: "#2f6fed",
          borderWidth: 2,
        },
      },
    ],
  });
}

function signed(value: number, digits: number): string {
  const normalized = Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value;
  return `${normalized >= 0 ? "+" : ""}${normalized.toFixed(digits)}`;
}
