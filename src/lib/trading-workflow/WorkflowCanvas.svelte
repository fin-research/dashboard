<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { Archive, ArchiveRestore } from '@lucide/svelte';
  import { crossfade } from 'svelte/transition';
  import type { InquiryRow, InquiryDirectory } from './inquiries';
  import type { ShiborRate } from '../../data-contracts';
  import { SvelteFlow } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import WorkflowNodeView from './WorkflowNode.svelte';
  import WorkflowEdgeView from './WorkflowEdge.svelte';
  import { buildGraph, timelineCursor, type FlowGraph, type FlowNode } from './graph';
  import { isInquiry, products, type WorkflowNode, type WorkflowDay, type Product } from './model';
  let { nodes, day, clockMinutes, editing = false, selectedId = '', onSelect, onMove, onComplete, onBranch, onEnable, onNote, onRows, onRemember, directory, rates, now }: {
    onRows: (id: string, rows: InquiryRow[]) => void; onRemember: (row: InquiryRow) => void; directory: InquiryDirectory; rates: ShiborRate[]; now: Date;
    nodes: WorkflowNode[]; day: WorkflowDay; clockMinutes: number; editing?: boolean; selectedId?: string;
    onSelect: (id: string) => void; onMove: (id: string, offset: { x: number; y: number }) => void;
    onComplete: (ids: string[], value: boolean) => void; onBranch: (ids: string[], value: boolean) => void;
    onEnable: (product: Product, value: boolean) => void; onNote: (id: string, value: string) => void;
  } = $props();
  const nodeTypes = { workflow: WorkflowNodeView };
  const edgeTypes = { workflow: WorkflowEdgeView };
  const [send, receive] = crossfade({ duration: 240 });
  let reducedMotion = $state(false);
  const enabledProducts = $derived(products.filter(product => day.enabled[product.id]));
  let lastEnabled = '';
  let animation = 0;
  let animating = false;
  let viewportWidth = $state(1040);
  let dragging = $state(false);
  let inquiries = $state<Record<string, boolean>>({});
  let flowNodes = $state.raw<FlowNode[]>([]);
  let heights = $state<Record<string, number>>({});
  let graph = $state.raw<FlowGraph>({ nodes: [], edges: [], bases: {}, timeline: [], height: 680, width: 1040 });
  const cursor = $derived(timelineCursor(graph.timeline, clockMinutes));
  function measureHeight(id: string, height: number) { if (!animating && height > 0 && heights[id] !== height) heights = { ...heights, [id]: height }; }
  function complete(members: WorkflowNode[]) {
    onComplete(members.map(node => node.id), !members.every(node => day.completed[node.id]));
  }
  function activate(node: WorkflowNode, members: WorkflowNode[]) {
    if (editing) { onSelect(node.id); if (node.kind === 'branch' && !day.branches[node.id]) onBranch([node.id], true); }
    else if (isInquiry(node)) {
      const id = members[0]!.id;
      inquiries = { ...inquiries, [id]: !inquiries[id] };
      const { [id]: removed, ...rest } = heights; heights = rest;
    }
    else if (node.kind === 'branch') onBranch(members.map(item => item.id), !members.some(item => day.branches[item.id]));
    else complete(members);
  }
  function displayGraph(next: FlowGraph, enabled: string) {
    cancelAnimationFrame(animation);
    const animate = lastEnabled !== '' && lastEnabled !== enabled && !reducedMotion;
    lastEnabled = enabled;
    const old = new Map(flowNodes.map(node => [node.id, node]));
    graph = next;
    if (!animate) { animating = false; flowNodes = next.nodes; return; }
    animating = true;
    const start = performance.now();
    function frame(time: number) {
      const progress = Math.min(1, (time - start) / 240), eased = 1 - (1 - progress) ** 3;
      flowNodes = next.nodes.map(node => {
        const from = old.get(node.id); if (!from) return node;
        const width = from.data.width + (node.data.width - from.data.width) * eased;
        return { ...node, position: { x: from.position.x + (node.position.x - from.position.x) * eased, y: from.position.y + (node.position.y - from.position.y) * eased }, width, measured: { ...node.measured, width }, data: { ...node.data, width } };
      });
      if (progress < 1) animation = requestAnimationFrame(frame); else { animating = false; flowNodes = next.nodes; }
    }
    animation = requestAnimationFrame(frame);
  }
  $effect(() => {
    const next = buildGraph(nodes, day, { editing, selectedId, clockMinutes: 0, width: viewportWidth, activate, heights, inquiries, measureHeight,
      toggleProduct: product => onEnable(product, !day.enabled[product]), note: onNote, rows: onRows, remember: onRemember, directory, rates, now });
    const enabled = enabledProducts.map(product => product.id).join(',') || 'none';
    if (!dragging) untrack(() => displayGraph(next, enabled));
  });
  onMount(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const motion = () => reducedMotion = media.matches; motion(); media.addEventListener('change', motion);
    function locate(event: Event) { document.querySelector<HTMLElement>(`[data-workflow-node="${(event as CustomEvent<string>).detail}"]`)?.scrollIntoView({ block: 'center', behavior: 'instant' }); }
    window.addEventListener('workflow-locate', locate);
    return () => { cancelAnimationFrame(animation); media.removeEventListener('change', motion); window.removeEventListener('workflow-locate', locate); };
  });
</script>

<div class="workflow-diagram" class:editing aria-label="交易流程图">
  <div class="flow-scroll" bind:clientWidth={viewportWidth}>
    <div class="flow-canvas" style:width={`${graph.width}px`} style:height={`${graph.height}px`}>
      <div class="product-categories" style:grid-template-columns={`repeat(${Math.max(1, enabledProducts.length)}, minmax(0, 1fr))`}>
        {#each enabledProducts as product (product.id)}
          <div class="product-category" data-workflow-product={product.id} in:receive={{ key: product.id, duration: reducedMotion ? 0 : 240 }} out:send={{ key: product.id, duration: reducedMotion ? 0 : 240 }}>
            <span>{product.label}</span><button type="button" class="category-collapse" aria-label={`折叠${product.label}`} aria-expanded="true" onclick={() => onEnable(product.id, false)}><Archive size={18} /></button>
          </div>
        {/each}
      </div>
      <svg class="workflow-timeline" width={graph.width} height={graph.height} aria-label="交易时间线" role="img">
        <line class="timeline-axis" x1="88" x2="88" y1="0" y2={graph.height} stroke="#087cff" stroke-width="2" />
        {#if cursor !== null}<line class="current-time-line" x1="88" x2={graph.width - 16} y1={cursor} y2={cursor} stroke="#087cff" stroke-opacity="0.2" stroke-width="1.5" />{/if}
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
      <SvelteFlow bind:nodes={flowNodes} edges={graph.edges} {nodeTypes} {edgeTypes} viewport={{ x: 0, y: 0, zoom: 1 }}
        proOptions={{ hideAttribution: true }} minZoom={1} maxZoom={1} nodesDraggable={editing} nodesConnectable={false} elementsSelectable={false}
        panOnDrag={false} panOnScroll={false} zoomOnScroll={false} zoomOnPinch={false} zoomOnDoubleClick={false}
        deleteKey={null} nodeDragThreshold={6} preventScrolling={false} nodeExtent={[[114, 0], [graph.width - 24, 10000]]}
        onnodeclick={({ node, event }) => { if (!(event.target as Element)?.closest('.nodrag')) node.data.activate(); }}
        onnodedragstart={() => dragging = true}
        onnodedragstop={({ targetNode }) => {
          if (editing && targetNode && graph.bases[targetNode.id]) {
            const base = graph.bases[targetNode.id]!;
            onMove(targetNode.data.node?.id ?? targetNode.id, { x: Math.round(targetNode.position.x - base.x), y: Math.round(targetNode.position.y - base.y) });
          }
          dragging = false;
        }} />
    </div>
  </div>
  <aside class="archived-products" aria-label="已折叠品种">
    {#each products.filter(product => !day.enabled[product.id]) as product (product.id)}
      <button type="button" class="archived-product" aria-label={`展开${product.label}`} aria-expanded="false" onclick={() => onEnable(product.id, true)}
        in:receive={{ key: product.id, duration: reducedMotion ? 0 : 240 }} out:send={{ key: product.id, duration: reducedMotion ? 0 : 240 }}>
        <ArchiveRestore size={16} /><span>{product.label}</span>
      </button>
    {/each}
  </aside>
</div>

<style>
  .workflow-diagram { display: flex; min-width: 0; gap: 8px; position: relative; background: #fff; border-radius: 8px; }
  .product-categories { position: absolute; z-index: 5; top: 12px; left: 134px; right: 24px; display: grid; gap: 0; }
  .product-category { margin-inline: auto; width: calc(100% - 36px); max-width: 460px; min-height: 52px; border: 1px solid color-mix(in srgb, var(--category-tone) 25%, white); border-radius: 8px; --category-tone: #087cff; display: flex; align-items: center; justify-content: center; gap: 2px; font-size: 1rem; font-weight: bold; color: var(--category-tone); background: color-mix(in srgb, var(--category-tone) 9%, white); }
  .product-category[data-workflow-product="reverse"] { --category-tone: #00a773; }
  .product-category[data-workflow-product="exchange"] { --category-tone: #8090aa; }
  .category-collapse { display: inline-grid; place-items: center; flex: none; color: inherit; height: 44px; width: 44px; padding: 0; border: 0; background: transparent; box-shadow: none; cursor: pointer; border-radius: 6px; transition: opacity 150ms; }
  .category-collapse:hover { opacity: .7; }
  .category-collapse:focus-visible { outline: 2px solid currentColor; outline-offset: -4px; }
  @media (prefers-reduced-motion: reduce) { .category-collapse { transition: none; } }
  .archived-products { display: flex; flex-direction: column; gap: 8px; position: sticky; top: 12px; align-self: flex-start; padding-block: 12px; width: 32px; flex: none; }
  .archived-products:empty { display: none; }
  .archived-product { display: flex; align-items: center; flex-direction: column; gap: 8px; width: 30px; padding: 10px 4px; background: white; border: 1px solid var(--tr-border, #dbe7f7); border-radius: 6px; color: var(--tr-muted, #667085); cursor: pointer; }
  .archived-product span { writing-mode: vertical-rl; text-orientation: upright; font-size: .875rem; }
  .archived-product:hover { color: var(--brand, #2f6fd6); border-color: currentColor; }
  .archived-product:focus-visible { outline: 2px solid var(--brand, #2f6fd6); outline-offset: 2px; }
  .flow-scroll { flex: 1; min-width: 0; overflow-x: auto; }
  .flow-canvas { position: relative; }
  .workflow-timeline { position: absolute; inset: 0; pointer-events: none; overflow: visible; }
  .workflow-timeline text { font: normal 1rem var(--font-sans, sans-serif); font-variant-numeric: tabular-nums; fill: #496388; }
  .flow-canvas :global(.svelte-flow) { --xy-background-color: transparent; --xy-edge-stroke: #087cff; background: transparent; }
  .flow-canvas :global(.svelte-flow__pane) { cursor: default; }

</style>
