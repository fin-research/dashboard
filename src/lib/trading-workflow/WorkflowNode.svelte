<script lang="ts">
  import { onMount } from 'svelte';
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  import { Check, ChevronDown, ChevronRight, GitBranch, MessageSquare, Circle, Clock } from '@lucide/svelte';
  import { isInquiry, minutes } from './model';
  import type { FlowNode } from './graph';
  let { data }: NodeProps<FlowNode> = $props();
  let body: HTMLDivElement;
  onMount(() => {
    const measure = () => data.measureHeight?.(body.offsetHeight);
    const observer = new ResizeObserver(measure); observer.observe(body); measure();
    return () => observer.disconnect();
  });
  const overdue = $derived(data.node?.startTime && !data.done && data.clockMinutes >= minutes(data.node.endTime ?? data.node.startTime));
</script>

<Handle type="target" position={Position.Top} style="left: 150px" isConnectable={false} />
<Handle type="target" id="bypass" position={Position.Left} isConnectable={false} />
<div bind:this={body} class="workflow-node" class:has-inquiry={!!data.node && isInquiry(data.node)} class:decision={data.node?.kind === 'branch'} class:product={!!data.product}
  class:done={data.done && data.node?.kind === 'task'} class:chosen={data.selected} class:editing={data.editing}
  data-workflow-node={data.node?.id} data-workflow-product={data.product} data-scope={data.scope}>
  <button type="button" class="node-surface" aria-label={data.title} disabled={!!data.node && !data.editing && !data.active}
    aria-pressed={data.node?.kind === 'task' ? !!data.done : undefined}
    aria-expanded={data.node?.kind === 'branch' ? !!data.expanded : data.product ? true : undefined}
    onkeydown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); data.activate(); }
    }}>
    <span class="node-symbol" aria-hidden="true">
      {#if data.node?.kind === 'branch'}<GitBranch size={20} />
      {:else if data.done}<Check size={20} />
      {:else if data.node && isInquiry(data.node)}<MessageSquare size={20} />
      {:else}<Circle size={18} />{/if}
    </span>
    <span class="node-copy">
      <span class="node-title">{data.title}</span>
      {#if data.node?.startTime}
        <span class="node-time"><Clock size={14} /><time>{data.node.startTime}</time>{#if data.node.endTime}<span>—</span><time>{data.node.endTime}</time>{/if}{#if overdue}<span class="pending">待办</span>{/if}</span>
      {/if}
      {#if data.node?.detail}<span class="node-detail">{data.node.detail}</span>{/if}
      {#if data.done && data.node?.kind === 'task'}<span class="node-status">已完成</span>{/if}
    </span>
    {#if data.product || data.node?.kind === 'branch'}<span aria-hidden="true">{#if data.product || data.expanded}<ChevronDown size={18} />{:else}<ChevronRight size={18} />{/if}</span>{/if}
  </button>
  {#if data.node && isInquiry(data.node)}
    <label class="inquiry nodrag nopan nowheel">
      <span>询价内容</span>
      <textarea class="textarea" aria-label={`${data.scope === 'loan' ? '拆借' : data.scope === 'reverse' ? '逆回购' : data.title}询价内容`}
        maxlength="4000" rows="3" value={data.note} oninput={event => data.writeNote(event.currentTarget.value)}></textarea>
    </label>
  {/if}
</div>
<Handle type="source" position={Position.Bottom} style="left: 150px" isConnectable={false} />
{#if data.node?.kind === 'branch'}<Handle type="source" id="bypass" position={Position.Left} isConnectable={false} />{/if}

<style>
  .workflow-node { position: relative; width: 300px; --node-tone: var(--tr-primary); }
  .has-inquiry { min-height: 108px; }
  .workflow-node[data-scope="reverse"] { --node-tone: var(--color-success); }
  .workflow-node[data-scope="exchange"] { --node-tone: var(--color-warning); }
  .node-surface { width: 100%; min-height: 64px; display: flex; align-items: center; gap: 12px; padding: 14px 16px; text-align: left; background: var(--tr-surface); color: var(--tr-text); border: 1px solid color-mix(in srgb, var(--node-tone) 25%, var(--tr-border)); border-radius: 8px; cursor: pointer; box-shadow: 0 2px 5px rgb(23 32 51 / 4%); font: inherit; transition: border-color .15s, background .15s; }
  .node-surface:hover, .chosen .node-surface { border-color: var(--node-tone); background: color-mix(in srgb, var(--node-tone) 5%, var(--tr-surface)); }
  .node-surface:disabled { opacity: .55; cursor: default; }
  .node-surface:focus-visible { outline: 3px solid var(--tr-primary); outline-offset: 3px; }
  .editing .node-surface { cursor: grab; touch-action: none; }
  .editing .node-surface:active { cursor: grabbing; }
  .node-symbol { color: var(--node-tone); flex: none; display: flex; }
  .node-copy { display: grid; gap: 6px; flex: 1; min-width: 0; }
  .node-title { font-size: 1rem; line-height: 1.5; overflow-wrap: anywhere; }
  .node-detail { white-space: pre-line; overflow-wrap: anywhere; color: var(--tr-muted); font-size: .875rem; line-height: 1.55; }
  .node-time { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; color: var(--tr-muted); font-size: .875rem; font-variant-numeric: tabular-nums; }
  .node-status { color: var(--color-success); font-size: .875rem; }
  .pending { color: var(--color-warning-content); background: color-mix(in srgb, var(--color-warning) 20%, var(--tr-surface)); padding: 0 4px; border-radius: 4px; }
  .done .node-symbol { color: var(--color-success); }
  .done .node-surface { border-color: color-mix(in srgb, var(--color-success) 40%, var(--tr-border)); }
  .decision .node-surface { border-radius: 24px 8px 24px 8px; background: color-mix(in srgb, var(--node-tone) 7%, var(--tr-surface)); }
  .decision .node-title, .product .node-title { font-weight: bold; }
  .product .node-surface { background: color-mix(in srgb, var(--node-tone) 10%, var(--tr-surface)); }
  .inquiry { position: absolute; left: calc(100% + 24px); top: 0; width: 210px; display: grid; gap: 6px; font-size: .875rem; color: var(--tr-muted); }
  .inquiry::before { content: ''; width: 24px; border-top: 1px solid var(--node-tone); position: absolute; right: 100%; top: 32px; }
  .inquiry textarea { width: 100%; height: 80px; min-height: 80px; max-height: 80px; resize: none; font-size: 1rem; color: var(--tr-text); }
  :global(.svelte-flow__handle) { opacity: 0; pointer-events: none; }
  @media (prefers-reduced-motion: reduce) { .node-surface { transition: none; } }
</style>
