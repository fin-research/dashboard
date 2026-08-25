<script lang="ts">
  let {
    id,
    title,
    meta = "",
  }: { id: string; title: string; meta?: string } = $props();
</script>

<div class="tr-section-heading">
  <div>
    <span class="tr-section-mark" aria-hidden="true"></span>
    <h2 {id}>{title}</h2>
  </div>
  {#if meta}<span>{meta}</span>{/if}
</div>
