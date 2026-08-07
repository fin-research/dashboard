import { number, signed } from "../formatters";
import type { InventoryPoint } from "../types";
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

export function renderInventory(
  host: HTMLElement,
  points: InventoryPoint[],
): void {
  const valid = points.filter(
    (point) =>
      Number.isFinite(point.tenor_years) && Number.isFinite(point.valuation),
  );
  if (!valid.length) {
    setEmpty(host, "存量债估值数据暂缺");
    return;
  }
  const sorted = [...valid].sort((a, b) => a.tenor_years - b.tenor_years);
  const trades = sorted.filter((point) => Number.isFinite(point.trade_yield));

  setChart(host, {
    animationDuration: 500,
    aria: { enabled: true, description: "东财存量债中债估值期限结构" },
    grid: {
      left: 0,
      right: 0,
      top: 12,
      bottom: 24,
      containLabel: true,
    },
    legend: {
      top: 0,
      right: 0,
      data: ["中债估值", "当日成交"],
      itemWidth: 18,
      itemHeight: 9,
      textStyle: axisLabel,
    },
    tooltip: {
      ...tooltip,
      trigger: "item",
      formatter: (params: unknown) => {
        const item = params as {
          data:
            | [number, number, string, number | null]
            | { value: [number, number, string, number | null] };
          seriesName: string;
        };
        const data = Array.isArray(item.data) ? item.data : item.data.value;
        const [tenor, value, bondName, tradeYield] = data;
        const trade =
          item.seriesName === "中债估值" && Number.isFinite(tradeYield)
            ? `<br>成交 ${number(tradeYield, 2)}%`
            : "";
        const digits = item.seriesName === "当日成交" ? 2 : 4;
        return `<strong>${escapeHtml(bondName)}</strong><br>剩余期限 ${number(tenor, 2)} 年<br>${escapeHtml(item.seriesName)} ${number(value, digits)}%${trade}`;
      },
    },
    xAxis: {
      type: "value",
      name: "剩余期限（年）",
      nameLocation: "middle",
      nameGap: 28,
      nameTextStyle: axisLabel,
      axisLabel,
      splitLine: { lineStyle: gridLine },
    },
    yAxis: {
      type: "value",
      scale: true,
      axisLabel: { ...axisLabel, formatter: "{value}%" },
      splitLine: { lineStyle: gridLine },
    },
    series: [
      {
        name: "中债估值",
        type: "line",
        smooth: false,
        symbol: "circle",
        symbolSize: 6,
        data: sorted.map((point) => [
          point.tenor_years,
          point.valuation,
          point.bond_name,
          point.trade_yield,
        ]),
        lineStyle: { color: colors.blue, width: 2.5 },
        itemStyle: {
          color: colors.blue,
          borderColor: colors.blue,
          borderWidth: 1,
        },
      },
      {
        name: "当日成交",
        type: "scatter",
        symbolSize: 13,
        data: trades.map((point) => ({
          value: [
            point.tenor_years,
            point.trade_yield,
            point.bond_name,
            point.trade_yield,
          ],
          label: {
            position:
              (point.trade_yield as number) >= point.valuation
                ? ("top" as const)
                : ("bottom" as const),
          },
        })),
        itemStyle: {
          color: colors.red,
          borderColor: colors.paper,
          borderWidth: 2,
          shadowBlur: 10,
          shadowColor: "rgba(210, 85, 73, 0.35)",
        },
        label: {
          show: true,
          position: "top",
          distance: 8,
          color: colors.red,
          backgroundColor: "rgba(255,255,255,.9)",
          borderRadius: 3,
          padding: [2, 4],
          fontFamily,
          fontSize: chartTextSize,
          fontWeight: 650,
          formatter: ({ value }: { value: [number, number] }) =>
            number(value[1], 2),
        },
        labelLayout: { moveOverlap: "shiftY", hideOverlap: true },
      },
    ],
  });
}
