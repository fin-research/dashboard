<script lang="ts">
  import { afterUpdate, onDestroy } from "svelte";
  import { disposeChart } from "../charts/charting";

  type ChartRenderer = (host: HTMLElement, ...args: any[]) => void;

  export let renderer: ChartRenderer;
  export let args: any[];
  export let ariaLabel: string;
  export let className = "chart-host";
  export let id: string | undefined = undefined;

  let host: HTMLElement;

  afterUpdate(() => {
    if (host) renderer(host, ...args);
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
></div>
