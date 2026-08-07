import * as echarts from "echarts/core";
import {
  BarChart,
  GaugeChart,
  LineChart,
  ScatterChart,
  TreemapChart,
} from "echarts/charts";
import {
  AriaComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";

echarts.use([
  AriaComponent,
  BarChart,
  GaugeChart,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  LineChart,
  ScatterChart,
  TooltipComponent,
  TreemapChart,
  SVGRenderer,
]);

type ChartInstance = ReturnType<typeof echarts.init>;
export type ChartOption = Parameters<ChartInstance["setOption"]>[0];

const instances = new Map<HTMLElement, ChartInstance>();
const resizeObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const host = entry.target as HTMLElement;
    const chart = instances.get(host);
    if (!chart) continue;
    chart.resize();
    setChartBounds(host, chart);
  }
});

export function setChart(host: HTMLElement, option: ChartOption): void {
  let chart = instances.get(host);
  if (!chart) {
    host.replaceChildren();
    chart = echarts.init(host, undefined, { renderer: "svg" });
    instances.set(host, chart);
    resizeObserver.observe(host);
  }
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const boundedOption = {
    ...option,
    backgroundColor: "rgba(255,255,255,0)",
  };
  const resolvedOption = reduceMotion
    ? {
        ...boundedOption,
        animation: false,
        animationDuration: 0,
        animationDurationUpdate: 0,
      }
    : boundedOption;
  chart.setOption(resolvedOption, { notMerge: true });
  setChartBounds(host, chart);
}

function setChartBounds(host: HTMLElement, chart: ChartInstance): void {
  chart.setOption({
    graphic: [
      {
        id: "__chart-bounds__",
        type: "rect",
        shape: {
          x: 0,
          y: 0,
          width: host.clientWidth,
          height: host.clientHeight,
        },
        style: { fill: "rgba(255,255,255,0)" },
        silent: true,
        z: -10_000,
      },
    ],
  });
}

export function setEmpty(host: HTMLElement, message: string): void {
  disposeChart(host);
  const empty = document.createElement("div");
  empty.className = "empty-chart";
  empty.textContent = message;
  host.replaceChildren(empty);
}

export function disposeChart(host: HTMLElement): void {
  const chart = instances.get(host);
  if (!chart) return;
  resizeObserver.unobserve(host);
  chart.dispose();
  instances.delete(host);
}
