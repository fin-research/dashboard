<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    id,
    title,
    wrap = false,
    children,
  }: { id: string; title: string; wrap?: boolean; children?: Snippet } =
    $props();
</script>

<div class:tr-panel-heading--wrap={wrap} class="tr-panel-heading">
  <div class="tr-panel-heading__title"><h2 {id}>{title}</h2></div>
  {#if children}
    <div class="tr-panel-heading__controls">{@render children()}</div>
  {/if}
</div>
