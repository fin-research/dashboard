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

<span class={`badge badge-${tone === "neutral" ? "ghost" : tone} tr-badge tr-badge--${tone}`}>{@render children()}</span>
