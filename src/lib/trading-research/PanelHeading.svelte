<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    id,
    title,
    wrap = false,
    controlsInline = false,
    accent = "",
    children,
  }: {
    id: string;
    title: string;
    wrap?: boolean;
    controlsInline?: boolean;
    accent?: string;
    children?: Snippet;
  } = $props();
</script>

<div
  class:tr-panel-heading--wrap={wrap}
  class:tr-panel-heading--controls-inline={controlsInline}
  class="tr-panel-heading"
  style={accent ? `--panel-heading-accent: ${accent}` : ""}
>
  <div class="tr-panel-heading__title">
    <span class="tr-panel-heading__mark" aria-hidden="true"></span>
    <h2 {id}>{title}</h2>
  </div>
  {#if children}
    <div class="tr-panel-heading__controls">{@render children()}</div>
  {/if}
</div>

<style>
  .tr-panel-heading {
    --panel-heading-accent: var(--tr-primary, var(--color-primary, #2f6fd6));
    display: grid;
    align-items: start;
    justify-content: stretch;
    gap: 10px;
    margin-bottom: 16px;
  }

  .tr-panel-heading__title {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 9px;
  }

  .tr-panel-heading__mark {
    width: 4px;
    height: 18px;
    flex: 0 0 4px;
    border-radius: 3px;
    background: var(--panel-heading-accent);
  }

  .tr-panel-heading h2 {
    margin: 0;
    color: var(--tr-text, var(--text-1, #172033));
    font-size: 1.125rem;
    font-weight: bold;
    line-height: 1.3;
  }

  .tr-panel-heading__controls {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
  }

  .tr-panel-heading--wrap .tr-panel-heading__controls {
    width: 100%;
    overflow-x: auto;
  }

  .tr-panel-heading--controls-inline {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
  }

  .tr-panel-heading--controls-inline .tr-panel-heading__controls {
    justify-content: flex-end;
  }

  @media (max-width: 720px) {
    .tr-panel-heading__controls {
      flex-wrap: wrap;
    }
  }
</style>
