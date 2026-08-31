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

export function renderFinancingGauge(
  host: HTMLElement,
  prediction: FinancingModelSnapshot["prediction"],
): void {
  setChart(host, {
    animationDuration: 220,
    aria: {
      enabled: true,
      description: `当前预测发行利差偏离处于历史 P${prediction.historical_percentile.toFixed(0)}，窗口处于${prediction.window_zone}区间`,
    },
    tooltip: {
      ...tooltip,
      formatter: [
        `<strong>历史 P${prediction.historical_percentile.toFixed(0)}</strong>`,
        `预测偏离 ${signed(prediction.deviation_bp, 2)} bp`,
        `窗口 ${prediction.window_zone}`,
      ].join("<br>"),
    },
    series: [
      {
        type: "gauge",
        min: 0,
        max: 100,
        startAngle: 205,
        endAngle: -25,
        radius: "96%",
        center: ["50%", "57%"],
        progress: { show: false },
        axisLine: {
          lineStyle: {
            width: 16,
            color: [
              [0.25, "#16a394"],
              [0.5, "#f79009"],
              [1, "#d92d20"],
            ],
          },
        },
        pointer: {
          length: "62%",
          width: 5,
          itemStyle: { color: colors.ink },
        },
        anchor: {
          show: true,
          size: 10,
          itemStyle: { color: colors.ink },
        },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          ...forecastAxisLabel,
          distance: 24,
          formatter: (value: number) =>
            value === 0 || value === 25 || value === 50 || value === 100
              ? `${value}`
              : "",
        },
        title: { show: false },
        detail: {
          valueAnimation: true,
          offsetCenter: [0, "62%"],
          color: colors.ink,
          fontSize: 24,
          fontWeight: "bolder",
          formatter: (value: number) => `P${value.toFixed(0)}`,
        },
        data: [{ value: prediction.historical_percentile }],
      },
    ],
  });
}

export function renderFinancingDriverRadar(
  host: HTMLElement,
  rows: FinancingModelSnapshot["driver_structure"],
): void {
  if (!rows.length) {
    setEmpty(host, "驱动结构暂缺");
    return;
  }
  setChart(host, {
    animationDuration: 220,
    aria: {
      enabled: true,
      description: "融资择时六维驱动结构雷达图，五十分为中性，越高越支持发行",
    },
    color: ["#2f6fed", colors.zero],
    legend: {
      top: 0,
      right: 0,
      itemWidth: 16,
      itemHeight: 10,
      textStyle: forecastAxisLabel,
      data: ["发行支持度", "中性基准"],
    },
    tooltip: {
      ...tooltip,
      trigger: "item",
      formatter: (params: unknown) => {
        const name = (params as { name?: string }).name;
        if (name === "中性基准") return "中性基准 50";
        return rows
          .map(
            (row) =>
              `${escapeHtml(row.display_name)} ${row.support_score.toFixed(1)} · ` +
              `${signed(row.support_bp, 3)} bp · 权重 ${(row.importance_weight * 100).toFixed(1)}%`,
          )
          .join("<br>");
      },
    },
    radar: {
      center: ["50%", "55%"],
      radius: "70%",
      startAngle: 90,
      shape: "polygon",
      splitNumber: 4,
      indicator: rows.map((row) => ({ name: row.display_name, min: 0, max: 100 })),
      axisName: { ...forecastAxisLabel, color: colors.ink },
      axisLine: { lineStyle: { color: colors.line } },
      splitLine: { lineStyle: { color: colors.grid } },
      splitArea: {
        areaStyle: { color: ["rgba(47,111,237,0.02)", "rgba(47,111,237,0.05)"] },
      },
    },
    series: [
      {
        type: "radar",
        symbol: "circle",
        symbolSize: 6,
        data: [
          {
            name: "发行支持度",
            value: rows.map((row) => row.support_score),
            lineStyle: { color: "#2f6fed", width: 2.4 },
            itemStyle: { color: "#2f6fed" },
            areaStyle: { color: "rgba(47,111,237,0.16)" },
          },
          {
            name: "中性基准",
            value: rows.map(() => 50),
            symbol: "none",
            lineStyle: { color: colors.zero, width: 1.2, type: "dashed" },
            areaStyle: { color: "rgba(255,255,255,0)" },
          },
        ],
      },
    ],
  });
}

export function renderFinancingDriverContributions(
  host: HTMLElement,
  rows: FinancingModelSnapshot["market_drivers"],
): void {
  if (!rows.length) {
    setEmpty(host, "因子贡献暂缺");
    return;
  }
  const values = rows.map((row) => -row.shap);
  const maxAbs = Math.max(...values.map(Math.abs), 0.1);
  const bound = Math.ceil(maxAbs * 12) / 10;
  setChart(host, {
    animationDuration: 220,
    aria: {
      enabled: true,
      description: "本次预测的前五项 SHAP 因子贡献，正值支持发行并降低成本，负值抑制发行",
    },
    grid: { left: 12, right: 74, top: 8, bottom: 26, containLabel: true },
    tooltip: {
      ...tooltip,
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: unknown) => {
        const item = (params as Array<{ dataIndex: number }>)[0];
        const row = rows[item?.dataIndex ?? -1];
        if (!row) return "";
        const contribution = -row.shap;
        return [
          `<strong>${escapeHtml(row.display_name)}</strong>`,
          `发行贡献 ${signed(contribution, 3)} bp`,
          `因子值 ${row.value.toFixed(4)}`,
          contribution >= 0 ? "支持发行（降低成本）" : "抑制发行（推高成本）",
        ].join("<br>");
      },
    },
    xAxis: {
      type: "value",
      min: -bound,
      max: bound,
      name: "贡献 bp",
      axisLine: { lineStyle: { color: colors.line } },
      axisTick: { show: false },
      axisLabel: forecastAxisLabel,
      nameTextStyle: forecastAxisLabel,
      splitLine: { lineStyle: gridLine },
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: rows.map((row) => row.display_name),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { ...forecastAxisLabel, color: colors.ink, width: 150, overflow: "truncate" },
    },
    series: [
      {
        type: "bar",
        barMaxWidth: 22,
        showBackground: true,
        backgroundStyle: { color: "rgba(102,112,133,0.08)", borderRadius: 4 },
        label: {
          show: true,
          position: "right",
          color: colors.ink,
          fontSize: forecastAxisLabel.fontSize,
          formatter: (params: { value: number }) => signed(params.value, 3),
        },
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: colors.zero, width: 1.4 },
          label: { show: false },
          data: [{ xAxis: 0 }],
        },
        data: values.map((value) => ({
          value,
          itemStyle: {
            color: value >= 0 ? "#2f6fed" : "#f79009",
            borderRadius: value >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4],
          },
        })),
      },
    ],
  });
}

export function renderFinancingProductComparison(
  host: HTMLElement,
  recommendation: FinancingModelSnapshot["product_recommendation"],
): void {
  const rows = recommendation?.scenarios ?? [];
  if (!rows.length) {
    setEmpty(host, "品种预测暂缺");
    return;
  }
  setChart(host, {
    animationDuration: 220,
    aria: {
      enabled: true,
      description: `四种发行方案相对各自同类债中位数的预测偏离对比，模型推荐${recommendation?.recommended_product ?? ""}`,
    },
    grid: { left: 12, right: 130, top: 8, bottom: 26, containLabel: true },
    tooltip: {
      ...tooltip,
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: unknown) => {
        const item = (params as Array<{ dataIndex: number }>)[0];
        const row = rows[item?.dataIndex ?? -1];
        if (!row) return "";
        return [
          `<strong>${escapeHtml(row.display_name)}</strong>`,
          `相对同类债中位数 ${signed(row.pred_bp, 2)} bp`,
          `同类债中位数 ${row.peer_spread_median_bp.toFixed(2)} bp`,
          `历史 P${row.historical_percentile.toFixed(0)}`,
          `相对最优 +${row.cost_vs_best_bp.toFixed(2)} bp`,
          `建议 ${escapeHtml(row.recommendation_label)}`,
        ].join("<br>");
      },
    },
    xAxis: {
      type: "value",
      name: "相对同类债中位数 bp",
      axisLine: { lineStyle: { color: colors.line } },
      axisTick: { show: false },
      axisLabel: forecastAxisLabel,
      nameTextStyle: forecastAxisLabel,
      splitLine: { lineStyle: gridLine },
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: rows.map((row) => row.display_name),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { ...forecastAxisLabel, color: colors.ink },
    },
    series: [
      {
        type: "bar",
        barMaxWidth: 28,
        label: {
          show: true,
          position: "right",
          color: colors.ink,
          fontSize: forecastAxisLabel.fontSize,
          formatter: (params: { dataIndex: number; value: number }) => {
            const row = rows[params.dataIndex];
            return `${signed(params.value, 2)} bp · P${row?.historical_percentile.toFixed(0) ?? "—"}`;
          },
        },
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: colors.zero, width: 1.4 },
          label: { show: false },
          data: [{ xAxis: 0 }],
        },
        data: rows.map((row) => ({
          value: row.pred_bp,
          itemStyle: {
            color: row.is_recommended ? "#2f6fed" : "#b8c7e0",
            borderRadius: row.pred_bp >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4],
          },
        })),
      },
    ],
  });
}

function signed(value: number, digits: number): string {
  const normalized = Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value;
  return `${normalized >= 0 ? "+" : ""}${normalized.toFixed(digits)}`;
}
