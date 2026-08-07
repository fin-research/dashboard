<script lang="ts">
  import type { SummaryItemView } from "../view-model";

  export let items: SummaryItemView[];
</script>

{#each items as item (item.label)}
  <div class={`summary-strip__item summary-strip__item--${item.tone}`}>
    <span>{item.label}</span>
    <strong>{item.value}</strong>
  </div>
{/each}

