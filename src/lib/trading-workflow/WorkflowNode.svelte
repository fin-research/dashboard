<script lang="ts">
  import { onMount } from 'svelte';
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  import { Check, ChevronDown, ChevronRight, GitBranch, MessageSquare, FileText, Clock, Landmark, Send } from '@lucide/svelte';
  import { isInquiry } from './model';
  import type { FlowNode } from './graph';
  let { data }: NodeProps<FlowNode> = $props();
  let body: HTMLDivElement;
  onMount(() => {
    const measure = () => data.measureHeight?.(body.offsetHeight);
    const observer = new ResizeObserver(measure); observer.observe(body); measure();
    return () => observer.disconnect();
  });
  const number = $derived(data.scope === 'loan' ? 1 : data.scope === 'reverse' ? 2 : 3);
</script>

<Handle type="target" position={Position.Top} isConnectable={false} aria-hidden="true" tabindex={-1} />
<div bind:this={body} class="workflow-node" class:decision={data.node?.kind === 'branch'} class:product={!!data.product}
  class:done={data.done && data.node?.kind === 'task'} class:chosen={data.selected} class:editing={data.editing}
  data-workflow-node={data.node?.id} data-workflow-product={data.product} data-scope={data.scope} style:width={`${data.width}px`}>
  <button type="button" class="node-surface" aria-label={data.title} disabled={!!data.node && !data.editing && !data.active}
    aria-pressed={data.node?.kind === 'task' ? !!data.done : undefined}
    aria-expanded={data.node?.kind === 'branch' ? !!data.expanded : data.product ? true : undefined}
    onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); data.activate(); } }}>
    <span class="node-symbol" class:numbered={!!data.product} aria-hidden="true">
      {#if data.product}{number}
      {:else if data.done}<Check size={21} />
      {:else if data.node && isInquiry(data.node)}<MessageSquare size={21} />
      {:else if data.node?.kind === 'branch'}<GitBranch size={20} />
      {:else if /银行|银企|划拨|调拨|中债/.test(data.title)}<Landmark size={21} />
      {:else if /等待/.test(data.title)}<Clock size={21} />
      {:else if /群|导出/.test(data.title)}<Send size={21} />
      {:else}<FileText size={21} />{/if}
    </span>
    <span class="node-copy"><span class="node-title">{data.title}</span>{#if data.node?.detail}<span class="node-detail">{data.node.detail}</span>{/if}</span>
    {#if data.product || data.node?.kind === 'branch'}<span class="node-chevron" aria-hidden="true">{#if data.product || data.expanded}<ChevronDown size={17} />{:else}<ChevronRight size={17} />{/if}</span>{/if}
  </button>
  {#if data.node && isInquiry(data.node)}
    <textarea class="textarea inquiry nodrag nopan nowheel" aria-label={`${data.scope === 'loan' ? '拆借' : data.scope === 'reverse' ? '逆回购' : data.title}询价内容`}
      style:width={`${data.noteWidth ?? 160}px`} maxlength="4000" rows="2" value={data.note} oninput={event => data.writeNote(event.currentTarget.value)}></textarea>
    <span class="inquiry-link" aria-hidden="true"></span>
  {/if}
</div>
<Handle type="source" position={Position.Bottom} isConnectable={false} aria-hidden="true" tabindex={-1} />

<style>
  .workflow-node { position: relative; --node-tone: #087cff; }
  .workflow-node[data-scope="reverse"] { --node-tone: #00a773; }
  .workflow-node[data-scope="exchange"] { --node-tone: #8090aa; }
  .node-surface { width: 100%; min-height: 52px; display: flex; align-items: center; gap: 12px; padding: 12px 16px; text-align: left; background: #fff; color: var(--tr-text); border: 1px solid #dbe7f7; border-radius: 8px; cursor: pointer; box-shadow: 0 3px 10px rgb(32 91 153 / 5%); font: inherit; transition: border-color .15s, box-shadow .15s; }
  .node-surface:hover { border-color: var(--node-tone); box-shadow: 0 3px 12px rgb(32 91 153 / 10%); }
  .chosen .node-surface { border-color: #087cff; box-shadow: 0 0 0 1px #087cff, 0 3px 12px rgb(8 124 255 / 12%); }
  .node-surface:disabled { opacity: .5; cursor: default; }
  .node-surface:focus-visible { outline: 3px solid var(--node-tone); outline-offset: 3px; }
  .editing .node-surface { cursor: grab; touch-action: none; }
  .editing .node-surface:active { cursor: grabbing; }
  .node-symbol { color: var(--node-tone); flex: none; display: flex; align-items: center; justify-content: center; }
  .numbered { width: 32px; height: 32px; border-radius: 50%; background: var(--node-tone); color: #fff; font-size: 1.125rem; }
  .node-copy { display: grid; gap: 2px; flex: 1; min-width: 0; }
  .node-title, .node-detail { font-size: 1rem; line-height: 1.4; overflow-wrap: anywhere; }
  .node-detail { white-space: pre-line; }
  .node-chevron { color: var(--node-tone); display: flex; }
  .done .node-symbol { color: #00a773; }
  .done .node-surface { border-color: #b9e5d7; }
  .decision .node-surface { background: color-mix(in srgb, var(--node-tone) 4%, white); }
  .decision .node-title, .product .node-title { font-weight: bold; }
  .product .node-surface { min-height: 54px; padding: 10px 14px; background: color-mix(in srgb, var(--node-tone) 7%, white); border-color: color-mix(in srgb, var(--node-tone) 18%, white); }
  .inquiry { position: absolute; left: calc(100% + 22px); top: 0; width: clamp(120px, 13vw, 190px); height: 52px; min-height: 52px; max-height: 52px; resize: none; font-size: .875rem; background: #fff; color: var(--tr-text); }
  .inquiry-link { position: absolute; left: 100%; top: 26px; width: 22px; border-top: 1px solid #96bdea; }
  :global(.svelte-flow__handle) { opacity: 0; pointer-events: none; }
  @media (prefers-reduced-motion: reduce) { .node-surface { transition: none; } }
</style>
