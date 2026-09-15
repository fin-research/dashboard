<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteFlow } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import WorkflowNodeView from './WorkflowNode.svelte';
  import { buildGraph, timelineCursor, type FlowGraph, type FlowNode } from './graph';
  import { isInquiry, type WorkflowNode, type WorkflowDay, type Product } from './model';
  let { nodes, day, clockMinutes, editing = false, selectedId = '', onSelect, onMove, onComplete, onBranch, onEnable, onNote }: {
    nodes: WorkflowNode[]; day: WorkflowDay; clockMinutes: number; editing?: boolean; selectedId?: string;
    onSelect: (id: string) => void; onMove: (id: string, offset: { x: number; y: number }) => void;
    onComplete: (ids: string[], value: boolean) => void; onBranch: (ids: string[], value: boolean) => void;
    onEnable: (product: Product, value: boolean) => void; onNote: (id: string, value: string) => void;
  } = $props();
  const nodeTypes = { workflow: WorkflowNodeView };
  let viewportWidth = $state(1040);
  let dragging = $state(false);
  let inquiries = $state<Record<string, boolean>>({});
  let flowNodes = $state.raw<FlowNode[]>([]);
  let heights = $state<Record<string, number>>({});
  let graph = $state.raw<FlowGraph>({ nodes: [], edges: [], bases: {}, timeline: [], height: 680, width: 1040 });
  const cursor = $derived(timelineCursor(graph.timeline, clockMinutes));
  function measureHeight(id: string, height: number) { if (height > 0 && heights[id] !== height) heights = { ...heights, [id]: height }; }
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
  $effect(() => {
    const next = buildGraph(nodes, day, { editing, selectedId, clockMinutes: 0, width: viewportWidth, activate, complete, heights, inquiries, measureHeight,
      toggleProduct: product => onEnable(product, !day.enabled[product]), note: onNote });
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
      <SvelteFlow bind:nodes={flowNodes} edges={graph.edges} {nodeTypes} viewport={{ x: 0, y: 0, zoom: 1 }}
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

</div>

<style>
  .workflow-diagram { display: flex; min-width: 0; gap: 8px; position: relative; background: #fff; border-radius: 8px; }
  .flow-scroll { flex: 1; min-width: 0; overflow-x: auto; }
  .flow-canvas { position: relative; }
  .workflow-timeline { position: absolute; inset: 0; pointer-events: none; overflow: visible; }
  .workflow-timeline text { font: normal 1rem var(--font-sans, sans-serif); font-variant-numeric: tabular-nums; fill: #496388; }
  .flow-canvas :global(.svelte-flow) { --xy-background-color: transparent; --xy-edge-stroke: #087cff; background: transparent; }
  .flow-canvas :global(.svelte-flow__pane) { cursor: default; }

</style>
