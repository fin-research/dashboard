<script lang="ts">
  import type { ReportData } from "../types";
  import { coreMetricCards } from "../view-model";
  import MetricIcon from "./MetricIcon.svelte";

  export let data: ReportData;

  $: cards = coreMetricCards(data);
</script>

{#each cards as item (item.label)}
  <article
    class={`card card--segmented core-card card--${item.valueTone}${item.lines ? " card--list" : ""}`}
  >
    <MetricIcon icon={item.icon} />
    <div class="card__content">
      <span class="card__label">{item.label}</span>
      {#if item.lines}
        {#each item.lines as line}
          <span class="card__list-value">{line}</span>
        {/each}
      {:else}
        <strong class="card__value">{item.value ?? "—"}</strong>
        <small class="card__detail">{item.detail ?? ""}</small>
      {/if}
    </div>
    <span class="card__balance" aria-hidden="true"></span>
  </article>
{/each}
