import { number, signed } from "../formatters";
import {
  chooseBestLabelPlacement,
  type LabelRect,
} from "../label-placement";
import type { InventoryPoint } from "../types";
import {
  axisLabel,
  chartTextSize,
  colors,
  escapeHtml,
  fontFamily,
  gridLine,
  rem,
  tooltip,
} from "./common";
import { seriesLineSegments, setChart, setEmpty } from "./charting";

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
  const labelLayout = createInventoryLabelLayout(host, trades, sorted);

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
          fontFamily,
          fontSize: chartTextSize,
          fontWeight: 650,
          formatter: ({ value }: { value: [number, number] }) =>
            number(value[1], 2),
        },
        labelLayout,
      },
    ],
  });
}

function createInventoryLabelLayout(
  host: HTMLElement,
  trades: InventoryPoint[],
  curve: InventoryPoint[],
): (params: {
  dataIndex?: number;
  rect: LabelRect;
  labelRect: LabelRect;
}) => {
  x: number;
  y: number;
  align: "left";
  verticalAlign: "top";
  hideOverlap: false;
} {
  const placed: LabelRect[] = [];
  const seen = new Set<number>();
  let lineObstacles: ReturnType<typeof inventoryLineSegments> | null = null;

  function inventoryLineSegments() {
    return seriesLineSegments(
      host,
      0,
      curve.map((point) => [point.tenor_years, point.valuation]),
    );
  }

  return (params) => {
    const index = params.dataIndex ?? 0;
    if (seen.has(index)) {
      seen.clear();
      placed.length = 0;
      lineObstacles = null;
    }
    seen.add(index);
    lineObstacles ??= inventoryLineSegments();

    const width = host.clientWidth;
    const height = host.clientHeight;
    const point = {
      x: params.rect.x + params.rect.width / 2,
      y: params.rect.y + params.rect.height / 2,
    };
    const bounds = {
      x: 8,
      y: 8,
      width: Math.max(0, width - 16),
      height: Math.max(0, height - 16),
    };
    const legendWidth = Math.min(width, rem(21.5));
    const reserved: LabelRect[] = [
      {
        x: Math.max(0, width - legendWidth),
        y: 0,
        width: legendWidth,
        height: rem(2.5),
      },
      {
        x: 0,
        y: Math.max(0, height - rem(3.45)),
        width,
        height: rem(3.45),
      },
      { x: 0, y: 0, width: rem(3.25), height },
    ];
    const trade = trades[index];
    const preferred =
      trade && (trade.trade_yield as number) >= trade.valuation
        ? ("top" as const)
        : ("bottom" as const);
    const placement = chooseBestLabelPlacement({
      point,
      label: {
        width: params.labelRect.width,
        height: params.labelRect.height,
      },
      bounds,
      obstacles: [...reserved, ...placed],
      preferred,
      gap: 8,
      collisionPadding: 5,
      lineObstacles,
      linePadding: 5,
    });
    placed.push(placement);
    return {
      x: placement.x,
      y: placement.y,
      align: "left",
      verticalAlign: "top",
      hideOverlap: false,
    };
  };
}
