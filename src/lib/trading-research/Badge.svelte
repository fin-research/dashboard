<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    tone = "neutral",
    children,
  }: {
    tone?: "info" | "success" | "warning" | "neutral";
    children: Snippet;
  } = $props();
</script>

<span class={`tr-badge tr-badge--${tone}`}>{@render children()}</span>
