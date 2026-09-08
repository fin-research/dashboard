<script lang="ts">
  import { ChevronDown } from '@lucide/svelte';
  let { label, options, values = $bindable([]), allLabel = '全部', optionLabels = {} }: {
    label: string; options: string[]; values: string[]; allLabel?: string; optionLabels?: Record<string, string>;
  } = $props();
  let details: HTMLDetailsElement;
  const summary = $derived(values.length === 0 ? allLabel : values.length === 1 ? optionLabels[values[0]!] ?? values[0] : `已选 ${values.length} 项`);
  function toggle(option: string) { values = values.includes(option) ? values.filter(value => value !== option) : [...values, option]; }
</script>

<svelte:window onkeydown={(event) => { if (event.key === 'Escape' && details?.open) { details.open = false; details.querySelector('summary')?.focus(); } }} onpointerdown={(event) => { if (details?.open && event.target instanceof Node && !details.contains(event.target)) details.open = false; }} />
<div class="multi-filter">
  <span class="filter-label">{label}</span>
  <details class="dropdown" bind:this={details}>
    <summary class="btn btn-outline filter-trigger" aria-label={`${label}：${summary}`}><span>{summary}</span><ChevronDown size={16} aria-hidden="true" /></summary>
    <div class="dropdown-content card card-border bg-base-100 filter-popover">
      <button type="button" class="btn btn-ghost" class:btn-active={values.length === 0} aria-pressed={values.length === 0} onclick={() => values = []}>{allLabel}</button>
      {#each options as option}
        <label class="filter-option"><input class="checkbox checkbox-primary checkbox-sm" type="checkbox" checked={values.includes(option)} onchange={() => toggle(option)} /><span>{optionLabels[option] ?? option}</span></label>
      {/each}
    </div>
  </details>
</div>

<style>
  .multi-filter { position: relative; display: flex; align-items: center; gap: .5rem; min-width: 0; }
  .filter-label { font-size: .875rem; color: var(--muted); white-space: nowrap; }
  .filter-trigger { min-width: 7rem; width: 100%; justify-content: space-between; list-style: none; }
  summary::-webkit-details-marker { display: none; }
  .filter-popover { z-index: 45; display: grid; gap: .25rem; width: max(100%, 14rem); max-width: calc(100vw - 3rem); max-height: min(24rem, 60dvh); overflow-y: auto; margin-top: .5rem; padding: .5rem; box-shadow: var(--shadow-card); }
  .filter-popover > button { justify-content: flex-start; }
  .filter-option { display: flex; gap: .75rem; align-items: center; min-height: 44px; padding: .5rem; border-radius: var(--radius-control); cursor: pointer; }
  .filter-option:hover { background: var(--brand-soft); }
  @media (max-width: 820px) { .multi-filter { flex-direction: column; align-items: stretch; gap: .375rem; } }
</style>
