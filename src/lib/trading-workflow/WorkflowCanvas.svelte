<script lang="ts">
  import { SvelteFlow, Controls, type Edge } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import WorkflowViewport from './WorkflowViewport.svelte';
  import WorkflowNodeView from './WorkflowNode.svelte';
  import { buildGraph, type FlowNode } from './graph';
  import { isActive, products, type WorkflowNode, type WorkflowDay, type Product } from './model';
  let { nodes, day, clockMinutes, editing = false, selectedId = '', onSelect, onMove, onComplete, onBranch, onEnable, onNote }: {
    nodes: WorkflowNode[]; day: WorkflowDay; clockMinutes: number; editing?: boolean; selectedId?: string;
    onSelect: (id: string) => void; onMove: (id: string, offset: { x: number; y: number }) => void;
    onComplete: (id: string, value: boolean) => void; onBranch: (id: string, value: boolean) => void;
    onEnable: (product: Product, value: boolean) => void; onNote: (id: string, value: string) => void;
  } = $props();
  const nodeTypes = { workflow: WorkflowNodeView };
  let flowNodes = $state.raw<FlowNode[]>([]);
  let edges = $state.raw<Edge[]>([]);
  let dragging = $state(false);
  let heights = $state<Record<string, number>>({});
  function measureHeight(id: string, height: number) {
    if (height > 0 && heights[id] !== height) heights = { ...heights, [id]: height };
  }
  let bases: Record<string, { x: number; y: number }> = {};
  function activate(node: WorkflowNode) {
    if (editing) { onSelect(node.id); if (node.kind === 'branch' && !day.branches[node.id]) onBranch(node.id, true); }
    else if (!isActive(node, nodes, day)) return;
    else if (node.kind === 'branch') onBranch(node.id, !day.branches[node.id]);
    else onComplete(node.id, !day.completed[node.id]);
  }
  $effect(() => {
    const graph = buildGraph(nodes, day, { editing, selectedId, clockMinutes, activate, heights, measureHeight,
      toggleProduct: product => onEnable(product, false), note: onNote });
    if (!dragging) { flowNodes = graph.nodes; edges = graph.edges; bases = graph.bases; }
  });
</script>

<div class="workflow-diagram" class:editing aria-label="交易流程图">
  <div class="flow-canvas">
    <SvelteFlow bind:nodes={flowNodes} {edges} {nodeTypes} fitView fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
      minZoom={0.25} maxZoom={1.5} nodesDraggable={editing} nodesConnectable={false} elementsSelectable={false}
      deleteKey={null} nodeDragThreshold={6} zoomOnDoubleClick={false} preventScrolling={false}
      onnodeclick={({ node, event }) => { if (!(event.target as Element)?.closest('.nodrag')) node.data.activate(); }}
      onnodedragstart={() => dragging = true}
      onnodedragstop={({ targetNode }) => {
        if (editing && targetNode && bases[targetNode.id]) {
          const base = bases[targetNode.id]!;
          onMove(targetNode.id, { x: Math.max(-10000, Math.min(10000, Math.round(targetNode.position.x - base.x))), y: Math.max(-10000, Math.min(10000, Math.round(targetNode.position.y - base.y))) });
        }
        dragging = false;
      }}>
      <WorkflowViewport />
      <Controls showLock={false} orientation="horizontal" position="bottom-left" fitViewOptions={{ padding: 0.15, maxZoom: 1 }} />
    </SvelteFlow>
  </div>
  {#if products.some(product => !day.enabled[product.id])}
    <aside class="collapsed-products" aria-label="未启用流程">
      {#each products.filter(product => !day.enabled[product.id]) as product}
        <button type="button" class="collapsed-product" aria-label={`展开${product.label}`} aria-expanded="false" onclick={() => onEnable(product.id, true)}>
          <span>{product.label}</span><span aria-hidden="true">‹</span>
        </button>
      {/each}
    </aside>
  {/if}
</div>

<style>
  .workflow-diagram { display: flex; min-width: 0; gap: 12px; position: relative; }
  .flow-canvas { height: clamp(640px, 76dvh, 1000px); flex: 1; min-width: 0; }
  .collapsed-products { display: flex; align-items: flex-start; gap: 6px; padding-top: 160px; }
  .collapsed-product { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; width: 44px; min-height: 180px; padding: 16px 8px; border: 1px solid var(--tr-border); border-radius: 8px; color: var(--tr-muted); background: var(--tr-surface); cursor: pointer; }
  .collapsed-product span:first-child { writing-mode: vertical-rl; text-orientation: upright; letter-spacing: .2em; font-size: 1rem; }
  .collapsed-product:hover { color: var(--tr-primary); border-color: var(--tr-primary); }
  .collapsed-product:focus-visible { outline: 3px solid var(--tr-primary); outline-offset: 2px; }
  .flow-canvas :global(.svelte-flow) { --xy-background-color: transparent; --xy-edge-stroke: var(--tr-primary); }
  .flow-canvas :global(.svelte-flow__controls) { box-shadow: none; border: 1px solid var(--tr-border); border-radius: 8px; overflow: hidden; }
  .flow-canvas :global(.svelte-flow__controls-button) { width: 44px; height: 44px; background: var(--tr-surface); color: var(--tr-text); }
  @media (max-width: 720px) { .workflow-diagram { gap: 4px; } .flow-canvas { height: 70dvh; min-height: 480px; } .collapsed-products { padding-top: 80px; } }
</style>
