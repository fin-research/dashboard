<script lang="ts">
  import { onMount } from "svelte";

  import EconomicIndicatorCard from "./EconomicIndicatorCard.svelte";
  import SectionHeading from "./SectionHeading.svelte";
  import {
    emptyEconomicIndicatorGroups,
    fetchEconomicIndicatorGroups,
  } from "./economic-indicators";

  let groups = $state(emptyEconomicIndicatorGroups());
  let loading = $state(true);
  let error = $state("");
  let controller: AbortController | undefined;

  async function loadIndicators(): Promise<void> {
    controller?.abort();
    const requestController = new AbortController();
    controller = requestController;
    loading = true;
    error = "";
    try {
      groups = await fetchEconomicIndicatorGroups(requestController.signal);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      error = cause instanceof Error ? cause.message : "经济指标加载失败";
    } finally {
      if (!requestController.signal.aborted) loading = false;
    }
  }

  onMount(() => {
    void loadIndicators();
    return () => controller?.abort();
  });
</script>

<div class="tr-view-stack tr-economic-view">
  <section aria-labelledby="economic-indicators-title">
    <SectionHeading
      id="economic-indicators-title"
      title="经济数据走势"
      meta="36项指标 · 近18个月"
    />
    <p class="tr-economic-intro">
      覆盖国内增长、需求、价格、货币信用，以及海外基本面、利率和全球风险资产。
    </p>
  </section>

  {#if error}
    <div class="tr-economic-error" role="alert">
      <div>
        <strong>经济指标暂时无法加载</strong>
        <span>{error}</span>
      </div>
      <button type="button" onclick={loadIndicators}>重新加载</button>
    </div>
  {/if}

  {#each groups as group, groupIndex}
    <section
      class="tr-economic-group"
      style={`--tr-economic-accent: ${group.accent}`}
      aria-labelledby={`economic-group-${groupIndex}`}
    >
      <header class="tr-economic-group__header">
        <div>
          <span aria-hidden="true"></span>
          <h2 id={`economic-group-${groupIndex}`}>{group.type}</h2>
        </div>
        <span>4项指标</span>
      </header>
      <div class="tr-economic-grid">
        {#each group.indicators as indicator (indicator.key)}
          <EconomicIndicatorCard
            {indicator}
            accent={group.accent}
            {loading}
          />
        {/each}
      </div>
    </section>
  {/each}
</div>
