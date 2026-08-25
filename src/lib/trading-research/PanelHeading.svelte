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
  <div><h2 {id}>{title}</h2></div>
  {#if children}{@render children()}{/if}
</div>
