<script lang="ts">
  import { onMount } from "svelte";

  import { portal } from "../portal";
  import EconomicIndicatorCard from "./EconomicIndicatorCard.svelte";
  import SectionHeading from "./SectionHeading.svelte";
  import WorkbenchIcon from "./WorkbenchIcon.svelte";
  import {
    emptyEconomicIndicatorGroups,
    fetchEconomicIndicatorSnapshot,
    formatEconomicDataRefresh,
  } from "./economic-indicators";

  let groups = $state(emptyEconomicIndicatorGroups());
  let syncedAt = $state("");
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
      const snapshot = await fetchEconomicIndicatorSnapshot(
        requestController.signal,
      );
      groups = snapshot.groups;
      syncedAt = snapshot.syncedAt;
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

{#if syncedAt}
  <span class="tr-as-of" use:portal={"#tr-topbar-actions"}>
    <WorkbenchIcon name="calendar" />
    <span>数据更新</span>
    <strong>{formatEconomicDataRefresh(syncedAt)}</strong>
  </span>
{/if}

<div class="tr-view-stack tr-economic-view">
  <section aria-labelledby="economic-indicators-title">
    <SectionHeading id="economic-indicators-title" title="经济数据走势" />
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
