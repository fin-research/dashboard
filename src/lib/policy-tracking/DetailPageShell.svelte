<script lang="ts">
  import { onMount, type Snippet } from "svelte";

  let {
    eyebrow,
    title,
    backHref,
    backLabel,
    children,
  }: {
    eyebrow: string;
    title: string;
    backHref: string;
    backLabel: string;
    children: Snippet;
  } = $props();

  let mainElement: HTMLElement;
  onMount(() => mainElement.focus({ preventScroll: true }));
</script>

<div class="detail-page">
  <header class="detail-header">
    <div class="header-title">
      <a href={backHref} aria-label={backLabel}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
      </a>
      <div><span>{eyebrow}</span><h1>{title}</h1></div>
    </div>
  </header>
  <main class="detail-main" tabindex="-1" bind:this={mainElement}>
    {@render children()}
  </main>
</div>

<style>
  .detail-page { min-height: 100dvh; color: #172033; background: #f6f8fb; }
  .detail-header { position: sticky; z-index: 20; top: 0; display: flex; min-height: 82px; align-items: center; padding: 14px max(24px, calc((100vw - 1600px) / 2)); border-bottom: 1px solid #d8e2f0; background: rgba(246, 248, 251, .96); backdrop-filter: blur(14px); }
  .header-title { display: flex; align-items: center; gap: 14px; min-width: 0; }
  .header-title a { display: grid; width: 44px; height: 44px; flex: 0 0 auto; place-items: center; border: 1px solid #cbd5e1; border-radius: 8px; color: #344054; background: #fff; transition: border-color 180ms ease, color 180ms ease, background 180ms ease; }
  .header-title a:hover { border-color: #2f6fd6; color: #2f6fd6; background: #f5f9ff; }
  .header-title a:focus-visible { outline: 3px solid rgba(47, 111, 214, .28); outline-offset: 2px; }
  .header-title svg { width: 22px; fill: none; stroke: currentColor; stroke-width: 2; }
  .header-title span { display: block; margin-bottom: 2px; color: #2f6fd6; font-size: .75rem; font-weight: bold; letter-spacing: .08em; }
  .header-title h1 { margin: 0; font-size: 1.5rem; font-weight: bolder; }
  .detail-main { width: min(1180px, calc(100% - 48px)); margin: 0 auto; padding: 32px 0 56px; outline: none; }
  @media (max-width: 620px) {
    .detail-header { position: static; min-height: 74px; padding: 12px 14px; }
    .header-title { gap: 10px; }
    .header-title h1 { font-size: 1.25rem; }
    .detail-main { width: min(100% - 28px, 1180px); padding: 20px 0 40px; }
  }
  @media (prefers-reduced-motion: reduce) { .header-title a { transition: none; } }
</style>
