<script lang="ts">
  import ChartHost from "../../components/ChartHost.svelte";
  import { renderEconomicIndicatorTrend } from "../../charts/trading-research";
  import type { EconomicIndicatorSeries } from "./economic-indicators";

  let {
    indicator,
    accent,
    loading = false,
  }: {
    indicator: EconomicIndicatorSeries;
    accent: string;
    loading?: boolean;
  } = $props();

  const latest = $derived(indicator.points.at(-1));
  const displayValue = $derived(
    latest
      ? latest.value.toLocaleString("zh-CN", {
          minimumFractionDigits: indicator.decimals,
          maximumFractionDigits: indicator.decimals,
        })
      : "—",
  );
  const chartLabel = $derived(
    `${indicator.name}近18个月走势${indicator.unit ? `，单位${indicator.unit}` : ""}`,
  );
</script>

<article
  class:tr-economic-card--loading={loading}
  class="tr-economic-card"
  style={`--tr-economic-accent: ${accent}`}
>
  <header class="tr-economic-card__header">
    <h3>{indicator.name}</h3>
    <span aria-hidden="true"></span>
  </header>

  <div class="tr-economic-card__value" aria-live="polite">
    {#if loading}
      <span class="tr-economic-skeleton tr-economic-skeleton--value"></span>
    {:else}
      <strong>{displayValue}</strong>
      {#if indicator.unit}<span>{indicator.unit}</span>{/if}
    {/if}
  </div>

  <div class="tr-economic-card__trend">
    {#if loading}
      <span class="tr-economic-skeleton tr-economic-skeleton--chart"></span>
    {:else if indicator.points.length > 0}
      <ChartHost
        renderer={renderEconomicIndicatorTrend}
        args={[
          indicator.points,
          chartLabel,
          indicator.unit,
          indicator.decimals,
          accent,
        ]}
        ariaLabel={chartLabel}
        className="tr-economic-chart"
      />
    {:else}
      <div class="tr-economic-card__empty">暂无可用数据</div>
    {/if}
  </div>

  <footer>
    <span>{loading ? "数据加载中" : latest?.date ?? "日期待更新"}</span>
    <span>近18个月</span>
  </footer>
</article>
