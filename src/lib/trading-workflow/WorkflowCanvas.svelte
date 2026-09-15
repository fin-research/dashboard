<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteFlow } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import WorkflowNodeView from './WorkflowNode.svelte';
  import { buildGraph, timelineCursor, type FlowGraph, type FlowNode } from './graph';
  import { isActive, products, type WorkflowNode, type WorkflowDay, type Product } from './model';
  let { nodes, day, clockMinutes, editing = false, selectedId = '', onSelect, onMove, onComplete, onBranch, onEnable, onNote }: {
    nodes: WorkflowNode[]; day: WorkflowDay; clockMinutes: number; editing?: boolean; selectedId?: string;
    onSelect: (id: string) => void; onMove: (id: string, offset: { x: number; y: number }) => void;
    onComplete: (id: string, value: boolean) => void; onBranch: (id: string, value: boolean) => void;
    onEnable: (product: Product, value: boolean) => void; onNote: (id: string, value: string) => void;
  } = $props();
  const nodeTypes = { workflow: WorkflowNodeView };
  let viewportWidth = $state(1040);
  let dragging = $state(false);
  let flowNodes = $state.raw<FlowNode[]>([]);
  let heights = $state<Record<string, number>>({});
  let graph = $state.raw<FlowGraph>({ nodes: [], edges: [], bases: {}, timeline: [], height: 680, width: 1040 });
  const cursor = $derived(timelineCursor(graph.timeline, clockMinutes));
  function measureHeight(id: string, height: number) { if (height > 0 && heights[id] !== height) heights = { ...heights, [id]: height }; }
  function activate(node: WorkflowNode) {
    if (editing) { onSelect(node.id); if (node.kind === 'branch' && !day.branches[node.id]) onBranch(node.id, true); }
    else if (!isActive(node, nodes, day)) return;
    else if (node.kind === 'branch') onBranch(node.id, !day.branches[node.id]);
    else onComplete(node.id, !day.completed[node.id]);
  }
  $effect(() => {
    const next = buildGraph(nodes, day, { editing, selectedId, clockMinutes, width: viewportWidth, activate, heights, measureHeight,
      toggleProduct: product => onEnable(product, false), note: onNote });
    if (!dragging) { graph = next; flowNodes = next.nodes; }
  });
  onMount(() => {
    function locate(event: Event) { document.querySelector<HTMLElement>(`[data-workflow-node="${(event as CustomEvent<string>).detail}"]`)?.scrollIntoView({ block: 'center', behavior: 'instant' }); }
    window.addEventListener('workflow-locate', locate);
    return () => window.removeEventListener('workflow-locate', locate);
  });
</script>

<div class="workflow-diagram" class:editing aria-label="交易流程图">
  <div class="flow-scroll" bind:clientWidth={viewportWidth}>
    <div class="flow-canvas" style:width={`${graph.width}px`} style:height={`${graph.height}px`}>
      <svg class="workflow-timeline" width={graph.width} height={graph.height} aria-label="交易时间线" role="img">
        <line x1="88" x2="88" y1="0" y2={graph.height} stroke="#c8ddf7" stroke-width="1.5" stroke-dasharray="4 5" />
        {#if graph.timeline.length && cursor !== null}<line x1="88" x2="88" y1={graph.timeline[0]!.y} y2={cursor} stroke="#087cff" stroke-width="2" />{/if}
        {#each graph.timeline as mark (mark.time)}
          <g data-timeline-time={mark.time}>
            <line x1="99" x2={Math.max(100, mark.endX)} y1={mark.y} y2={mark.y} stroke="#c8ddf7" stroke-dasharray="3 5" />
            <text x="61" y={mark.y + 5} text-anchor="end">{mark.time}</text>
            <circle cx="88" cy={mark.y} r="9" fill="white" stroke="#087cff" stroke-width="2" />
            <circle cx="88" cy={mark.y} r="5" fill={clockMinutes >= mark.minute ? '#087cff' : 'white'} />
          </g>
        {/each}
        {#if cursor !== null}<circle class="clock-cursor" cx="88" cy={cursor} r="4" fill="#087cff" />{/if}
      </svg>
      <SvelteFlow bind:nodes={flowNodes} edges={graph.edges} {nodeTypes} viewport={{ x: 0, y: 0, zoom: 1 }}
        minZoom={1} maxZoom={1} nodesDraggable={editing} nodesConnectable={false} elementsSelectable={false}
        panOnDrag={false} panOnScroll={false} zoomOnScroll={false} zoomOnPinch={false} zoomOnDoubleClick={false}
        deleteKey={null} nodeDragThreshold={6} preventScrolling={false} nodeExtent={[[114, 0], [graph.width - 24, 10000]]}
        onnodeclick={({ node, event }) => { if (!(event.target as Element)?.closest('.nodrag')) node.data.activate(); }}
        onnodedragstart={() => dragging = true}
        onnodedragstop={({ targetNode }) => {
          if (editing && targetNode && graph.bases[targetNode.id]) {
            const base = graph.bases[targetNode.id]!;
            onMove(targetNode.id, { x: Math.round(targetNode.position.x - base.x), y: Math.round(targetNode.position.y - base.y) });
          }
          dragging = false;
        }} />
    </div>
  </div>
  {#if products.some(product => !day.enabled[product.id])}
    <aside class="collapsed-products" aria-label="未启用流程">
      {#each products.filter(product => !day.enabled[product.id]) as product}
        <button type="button" class="collapsed-product" aria-label={`展开${product.label}`} aria-expanded="false" onclick={() => onEnable(product.id, true)}>
          <span class="product-number" aria-hidden="true">{products.indexOf(product) + 1}</span><span class="vertical-label">{product.label}</span><span aria-hidden="true">›</span>
        </button>
      {/each}
    </aside>
  {/if}
</div>

<style>
  .workflow-diagram { display: flex; min-width: 0; gap: 8px; position: relative; background: #fff; border-radius: 8px; }
  .flow-scroll { flex: 1; min-width: 0; overflow-x: auto; }
  .flow-canvas { position: relative; }
  .workflow-timeline { position: absolute; inset: 0; pointer-events: none; overflow: visible; }
  .workflow-timeline text { font: normal 1rem var(--font-sans, sans-serif); font-variant-numeric: tabular-nums; fill: #496388; }
  .collapsed-products { display: flex; align-items: flex-start; gap: 6px; padding: 244px 16px 24px 0; }
  .collapsed-product { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; width: 44px; min-height: 210px; padding: 12px 6px; border: 1px solid #d8e4f3; border-radius: 8px; color: #496388; background: #f4f7fc; cursor: pointer; }
  .vertical-label { writing-mode: vertical-rl; text-orientation: upright; letter-spacing: .16em; font-size: 1rem; }
  .product-number { width: 30px; height: 30px; border-radius: 50%; color: white; background: #8799b4; display: grid; place-items: center; font-size: 1rem; }
  .collapsed-product:hover { color: #087cff; border-color: #087cff; }
  .collapsed-product:focus-visible { outline: 3px solid #087cff; outline-offset: 2px; }
  .flow-canvas :global(.svelte-flow) { --xy-background-color: transparent; --xy-edge-stroke: #087cff; background: transparent; }
  .flow-canvas :global(.svelte-flow__pane) { cursor: default; }
  @media (max-width: 720px) { .workflow-diagram { gap: 0; } .collapsed-products { padding-right: 6px; } }
</style>
