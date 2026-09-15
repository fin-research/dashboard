<script lang="ts">
  import { onMount } from 'svelte';
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  import { ChevronDown, ChevronRight, GitBranch, MessageSquare, FileText, Clock, Landmark, Send } from '@lucide/svelte';
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
  class:done={data.done && !data.product} class:chosen={data.selected} class:editing={data.editing}
  data-workflow-node={data.node?.id} data-workflow-product={data.product} data-scope={data.scope} style:width={`${data.width}px`}>
  <button type="button" class="node-surface" aria-label={data.product ? `${data.expanded ? '折叠' : '展开'}${data.title}` : data.title} disabled={!!data.node && !data.editing && !data.active}
    aria-pressed={data.node?.kind === 'task' ? !!data.done : undefined}
    aria-expanded={data.node?.kind === 'branch' || data.product || (data.node && isInquiry(data.node)) ? !!data.expanded : undefined}
    aria-describedby={data.node ? `workflow-state-${data.node.id}` : undefined}
    onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); data.activate(); } }}>
    <span class="node-symbol" class:numbered={!!data.product} aria-hidden="true">
      {#if data.product}{number}

      {:else if data.node && isInquiry(data.node)}<MessageSquare size={21} />
      {:else if data.node?.kind === 'branch'}<GitBranch size={20} />
      {:else if /银行|银企|划拨|调拨|中债/.test(data.title)}<Landmark size={21} />
      {:else if /等待/.test(data.title)}<Clock size={21} />
      {:else if /群|导出/.test(data.title)}<Send size={21} />
      {:else}<FileText size={21} />{/if}
    </span>
    <span class="node-copy"><span class="node-title">{data.title}</span>{#if data.node?.detail}<span class="node-detail">{data.node.detail}</span>{/if}</span>
    {#if data.product || data.node?.kind === 'branch' || (data.node && isInquiry(data.node))}<span class="node-chevron" aria-hidden="true">{#if data.expanded}<ChevronDown size={17} />{:else}<ChevronRight size={17} />{/if}</span>{/if}
  </button>
  {#if data.node}<span id={`workflow-state-${data.node.id}`} class="sr-only">{data.done ? '已完成' : '未完成'}</span>{/if}
  {#if data.node && isInquiry(data.node) && data.expanded && !data.editing}
    <div class="inquiry-editor nodrag nopan nowheel">
      <textarea class="textarea inquiry" aria-label={`${data.node.scope === 'loan' ? '拆借' : data.node.scope === 'reverse' ? '逆回购' : data.title}群价内容`}
        maxlength="4000" rows="3" value={data.note} oninput={event => data.writeNote(event.currentTarget.value)}></textarea>
      <button class="btn btn-sm btn-ghost" type="button" aria-pressed={!!data.done} onclick={() => data.complete?.()}>{data.done ? '撤销完成' : '完成'}</button>
    </div>
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
  .done .node-surface { background: color-mix(in srgb, var(--node-tone) 20%, white); border-color: color-mix(in srgb, var(--node-tone) 60%, white); }
  .decision .node-title, .product .node-title { font-weight: bold; }
  .product .node-surface { min-height: 54px; padding: 10px 14px; background: #fff; }
  .inquiry-editor { display: grid; justify-items: end; gap: 8px; padding: 12px; border: 1px solid #dbe7f7; border-top: 0; border-radius: 0 0 8px 8px; background: #fff; }
  .workflow-node:has(.inquiry-editor) .node-surface { border-radius: 8px 8px 0 0; }
  .inquiry { width: 100%; min-height: 90px; resize: vertical; font-size: 1rem; color: var(--tr-text); }
  :global(.svelte-flow__handle) { opacity: 0; pointer-events: none; }
  @media (prefers-reduced-motion: reduce) { .node-surface { transition: none; } }
</style>
