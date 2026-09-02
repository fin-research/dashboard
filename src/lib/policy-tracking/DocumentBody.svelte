<script lang="ts">
  import { parseResearchContent } from "$lib/report-content";

  let { content }: { content: string } = $props();
  let blocks = $derived.by(() => parseResearchContent(content));
</script>

<article class="document-body">
  {#each blocks as block}
    {#if block.kind === "heading"}
      {#if block.level === 2}<h2>{block.text}</h2>{:else}<h3>{block.text}</h3>{/if}
    {:else if block.kind === "list"}
      {#if block.ordered}<ol>{#each block.items as item}<li>{item}</li>{/each}</ol>
      {:else}<ul>{#each block.items as item}<li>{item}</li>{/each}</ul>{/if}
    {:else}<p>{block.text}</p>{/if}
  {/each}
</article>

<style>
  .document-body { max-width: 760px; margin: 0 auto; color: #344054; font-size: 1rem; line-height: 1.9; }
  .document-body h2 { margin: 32px 0 12px; color: #172033; font-size: 1.25rem; }
  .document-body h3 { margin: 26px 0 10px; color: #172033; font-size: 1.125rem; }
  .document-body p { margin: 0 0 18px; white-space: pre-wrap; }
  .document-body ol, .document-body ul { display: grid; gap: 10px; margin: 0 0 20px; padding-left: 24px; }
  @media (max-width: 620px) { .document-body { line-height: 1.8; } }
</style>
