import type { Node, Edge } from '@xyflow/svelte';
import { childrenOf, isActive, isInquiry, products, type Scope, type Product, type WorkflowNode, type WorkflowDay } from './model.ts';

export const NODE_WIDTH = 300;
const COLUMN_GAP = 580;
export type FlowData = {
  title: string; scope: Scope; node?: WorkflowNode; product?: Product;
  done?: boolean; active?: boolean; expanded?: boolean; editing: boolean; selected?: boolean;
  note?: string; clockMinutes: number;
  measureHeight?: (height: number) => void;
  activate: () => void; writeNote: (value: string) => void;
};
export type FlowNode = Node<FlowData, 'workflow'>;
export type FlowGraph = { nodes: FlowNode[]; edges: Edge[]; bases: Record<string, { x: number; y: number }> };
export function buildGraph(config: WorkflowNode[], day: WorkflowDay, options: {
  editing: boolean; selectedId: string; clockMinutes: number; heights?: Record<string, number>;
  measureHeight?: (id: string, height: number) => void;
  activate: (node: WorkflowNode) => void; toggleProduct: (product: Product) => void;
  note: (id: string, value: string) => void;
}): FlowGraph {
  const graph: FlowGraph = { nodes: [], edges: [], bases: {} };
  const enabled = products.filter(product => day.enabled[product.id]);
  const center = Math.max(0, enabled.length - 1) * COLUMN_GAP / 2;
  function connect(source: string, target: string, label?: string) {
    const bypass = config.some(node => node.id === source && node.kind === 'branch' && day.branches[node.id]) && label !== '是';
    graph.edges.push({ sourceHandle: bypass ? 'bypass' : undefined, targetHandle: bypass ? 'bypass' : undefined, id: `${source}:${target}`, source, target, type: 'smoothstep', label: bypass ? '否' : label,
      markerEnd: { type: 'arrowclosed' as import('@xyflow/svelte').MarkerType, width: 16, height: 16 },
      style: 'stroke: var(--tr-primary); stroke-width: 1.5;',
      labelStyle: 'fill: var(--tr-muted); font-size: 14px;',
    });
  }
  function place(node: WorkflowNode, x: number, y: number) {
    graph.bases[node.id] = { x, y };
    const height = 64 + (node.startTime ? 24 : 0) + (node.detail ? Math.ceil(node.detail.length / 22) * 22 + 8 : 0)
      + Math.max(0, Math.ceil(node.title.length / 16) - 1) * 24;
    graph.nodes.push({ id: node.id, type: 'workflow', position: { x: x + (node.offset?.x ?? 0), y: y + (node.offset?.y ?? 0) },
      width: isInquiry(node) ? 534 : NODE_WIDTH, focusable: false, draggable: options.editing, connectable: false,
      data: { node, title: node.title, scope: node.scope, active: isActive(node, config, day), done: !!day.completed[node.id], expanded: !!day.branches[node.id],
        editing: options.editing, selected: options.selectedId === node.id, clockMinutes: options.clockMinutes,
        measureHeight: height => options.measureHeight?.(node.id, height),
        note: day.notes[node.id] ?? '', activate: () => options.activate(node), writeNote: value => options.note(node.id, value) },
    });
    return y + Math.max(options.heights?.[node.id] ?? height, isInquiry(node) ? 108 : 0) + 42;
  }
  // A condition has an explicit bypass and a separately revealed child path.
  function sequence(items: WorkflowNode[], x: number, y: number, incoming: string[]): { y: number; tails: string[] } {
    let tails = incoming;
    for (const node of items) {
      for (const tail of tails) connect(tail, node.id);
      y = place(node, x, y);
      tails = [node.id];
      if (node.kind === 'branch' && day.branches[node.id]) {
        const children = childrenOf(config, node.scope, node.id);
        if (children.length) {
          const child = sequence(children, x, y, []);
          connect(node.id, children[0]!.id, '是');
          // Both the condition's bypass and its child path rejoin the next step.
          tails = [node.id, ...child.tails]; y = child.y;
        }
      }
    }
    return { y, tails };
  }
  const shared = childrenOf(config, 'shared');
  const closingIndex = shared.findIndex(node => node.id === 'shared-done');
  const opening = closingIndex < 0 ? shared : shared.slice(0, closingIndex);
  const closing = closingIndex < 0 ? [] : shared.slice(closingIndex);
  const common = sequence(opening, center, 32, []);
  let bottom = common.y;
  const ends: string[] = [];
  enabled.forEach((product, index) => {
    const id = `product-${product.id}`, x = index * COLUMN_GAP, y = common.y + 24;
    graph.nodes.push({ id, type: 'workflow', position: { x, y }, width: NODE_WIDTH, draggable: false, focusable: false, connectable: false,
      data: { product: product.id, title: product.label, scope: product.id, editing: options.editing, clockMinutes: options.clockMinutes,
        activate: () => options.toggleProduct(product.id), writeNote: () => {} },
    });
    for (const tail of common.tails) connect(tail, id);
    const lane = sequence(childrenOf(config, product.id), x, y + 100, [id]);
    bottom = Math.max(bottom, lane.y); ends.push(...lane.tails);
  });
  sequence(closing, center, bottom + 24, ends.length ? ends : common.tails);
  return graph;
}
