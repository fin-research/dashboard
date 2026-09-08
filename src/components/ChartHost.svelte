<script lang="ts">
  import { afterUpdate, onDestroy } from "svelte";
  import { disposeChart, setChart, type ChartOption } from "../charts/charting";

  type ChartRenderer = (host: HTMLElement, ...args: any[]) => void;

  export let renderer: ChartRenderer = setChart;
  export let args: any[] = [];
  export let option: ChartOption | undefined = undefined;
  export let height: number | undefined = undefined;
  export let ariaLabel: string;
  export let className = "chart-host";
  export let id: string | undefined = undefined;

  let host: HTMLElement;

  afterUpdate(() => {
    if (host) renderer(host, ...(option ? [option] : args));
  });

  onDestroy(() => {
    if (host) disposeChart(host);
  });
</script>

<div
  bind:this={host}
  {id}
  class={className}
  role="img"
  aria-label={ariaLabel}
  style:height={height === undefined ? undefined : `${height}rem`}
></div>
