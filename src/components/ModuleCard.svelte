<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    labelledBy,
    class: className = "",
    style = "",
    children,
  }: {
    labelledBy?: string;
    class?: string;
    style?: string;
    children: Snippet;
  } = $props();
</script>

<section
  class={`module-card tr-panel ${className}`.trim()}
  aria-labelledby={labelledBy}
  {style}
>
  {@render children()}
</section>

<style>
  .module-card {
    min-width: 0;
    padding: 18px;
    border: 1px solid var(--tr-border, var(--border, #d8e2f0));
    border-radius: var(--tr-radius-card, var(--radius-card, 10px));
    color: var(--tr-text, var(--text-1, #172033));
    background: var(--tr-surface, var(--surface, #ffffff));
    box-shadow: var(
      --tr-shadow,
      var(--shadow-card, 0 2px 8px rgba(23, 32, 51, 0.06))
    );
  }

  @media (max-width: 720px) {
    .module-card {
      padding: 15px;
    }
  }
</style>
