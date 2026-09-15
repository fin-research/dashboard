import type { Node, BuiltInEdge } from '@xyflow/svelte';
import { childrenOf, isActive, isInquiry, minutes, products, type Scope, type Product, type WorkflowNode, type WorkflowDay } from './model.ts';

export const NODE_WIDTH = 300;
export type FlowData = {
  title: string; scope: Scope; node?: WorkflowNode; product?: Product; width: number; noteWidth?: number;
  done?: boolean; active?: boolean; expanded?: boolean; editing: boolean; selected?: boolean;
  note?: string; clockMinutes: number; measureHeight?: (height: number) => void;
  activate: () => void; writeNote: (value: string) => void;
};
export type FlowNode = Node<FlowData, 'workflow'>;
export type TimelineMark = { time: string; minute: number; y: number; endX: number };
export type FlowGraph = { nodes: FlowNode[]; edges: BuiltInEdge[]; bases: Record<string, { x: number; y: number }>; timeline: TimelineMark[]; height: number; width: number };
export function buildGraph(config: WorkflowNode[], day: WorkflowDay, options: {
  editing: boolean; selectedId: string; clockMinutes: number; width?: number; heights?: Record<string, number>;
  measureHeight?: (id: string, height: number) => void;
  activate: (node: WorkflowNode) => void; toggleProduct: (product: Product) => void;
  note: (id: string, value: string) => void;
}): FlowGraph {
  const width = Math.max(740, options.width ?? 1040);
  const graph: FlowGraph = { nodes: [], edges: [], bases: {}, timeline: [], height: 0, width };
  const enabled = products.filter(product => day.enabled[product.id]);
  const count = Math.max(enabled.length, 1);
  const areaLeft = 134, areaRight = width - 36;
  const column = (areaRight - areaLeft) / count;
  const nodeWidth = Math.min(NODE_WIDTH, column - 48);
  const center = (areaLeft + areaRight - nodeWidth) / 2;
  const candidates: TimelineMark[] = [];
  function connect(source: string, target: string) {
    const from = graph.nodes.find(node => node.id === source), to = graph.nodes.find(node => node.id === target);
    const scope = from?.data.node && isInquiry(from.data.node) ? 'shared' : to?.data.scope === 'shared' ? from?.data.scope : to?.data.scope;
    const color = scope === 'reverse' ? '#00a773' : scope === 'exchange' ? '#8a96ab' : '#087cff';
    graph.edges.push({ id: `${source}:${target}`, source, target, type: 'smoothstep', pathOptions: { borderRadius: 10, offset: 24, stepPosition: target === 'shared-done' ? 1 : 0.5 },
      markerEnd: { type: 'arrowclosed' as import('@xyflow/svelte').MarkerType, width: 16, height: 16, color },
      style: `stroke: ${color}; stroke-width: 1.8;`,
    });
  }
  function place(node: WorkflowNode, x: number, y: number, prelude = false) {
    graph.bases[node.id] = { x, y };
    const position = { x: x + (node.offset?.x ?? 0), y: y + (node.offset?.y ?? 0) };
    const height = options.heights?.[node.id] ?? 52 + (node.detail ? Math.ceil(node.detail.length / Math.max(12, (nodeWidth - 65) / 15)) * 23 : 0);
    const title = prelude && isInquiry(node) ? `${products.find(product => product.id === node.scope)?.label ?? ''}询价` : node.title;
    graph.nodes.push({ id: node.id, type: 'workflow', position,
      width: nodeWidth, measured: { width: nodeWidth, height }, focusable: false, draggable: options.editing, connectable: false,
      data: { node, title, width: nodeWidth, noteWidth: Math.max(100, Math.min(190, width - position.x - nodeWidth - 34)), scope: node.scope, active: isActive(node, config, day), done: !!day.completed[node.id], expanded: !!day.branches[node.id],
        editing: options.editing, selected: options.selectedId === node.id, clockMinutes: options.clockMinutes,
        measureHeight: height => options.measureHeight?.(node.id, height), note: day.notes[node.id] ?? '',
        activate: () => options.activate(node), writeNote: value => options.note(node.id, value) },
    });
    if (node.startTime) candidates.push({ time: node.startTime, minute: minutes(node.startTime), y: position.y + height / 2, endX: position.x - 8 });
    return y + height + 28;
  }
  function sequence(items: WorkflowNode[], x: number, y: number, incoming: string[], prelude = false): { y: number; tails: string[] } {
    let tails = incoming;
    for (const node of items) {
      y = place(node, x, y, prelude);
      for (const tail of tails) connect(tail, node.id);
      tails = [node.id];
      if (node.kind === 'branch' && day.branches[node.id]) {
        const child = sequence(childrenOf(config, node.scope, node.id), x, y, tails);
        tails = child.tails; y = child.y;
      }
    }
    return { y, tails };
  }
  const shared = childrenOf(config, 'shared');
  const closingIndex = shared.findIndex(node => node.id === 'shared-done');
  const opening = closingIndex < 0 ? shared : shared.slice(0, closingIndex);
  const closing = closingIndex < 0 ? [] : shared.slice(closingIndex);
  const firstCommonTime = opening.find(node => node.startTime)?.startTime;
  // Lift only the timed prefix of each product before the first common step.
  // Later steps and untimed prerequisites retain their original business order.
  const prelude: WorkflowNode[] = [];
  for (const product of enabled) {
    for (const node of childrenOf(config, product.id)) {
      if (node.kind !== 'task' || !node.startTime || !firstCommonTime || node.startTime >= firstCommonTime) break;
      prelude.push(node);
    }
  }
  prelude.sort((a, b) => a.startTime!.localeCompare(b.startTime!));
  // Two independent inquiry records remain two nodes; neither progress nor notes are merged.
  const start = sequence(prelude, center, 24, [], true);
  const common = sequence(opening, center, start.y + (prelude.length ? 4 : 0), start.tails);
  const preludeIds = new Set(prelude.map(node => node.id));
  let bottom = common.y;
  const ends: string[] = [];
  enabled.forEach((product, index) => {
    const id = `product-${product.id}`, x = areaLeft + index * column + (column - nodeWidth) / 2, y = common.y + 20;
    graph.nodes.push({ id, type: 'workflow', position: { x, y }, width: nodeWidth, measured: { width: nodeWidth, height: 54 }, draggable: false, focusable: false, connectable: false,
      data: { product: product.id, title: product.label, width: nodeWidth, scope: product.id, editing: options.editing, clockMinutes: options.clockMinutes,
        activate: () => options.toggleProduct(product.id), writeNote: () => {} },
    });
    for (const tail of common.tails) connect(tail, id);
    const lane = sequence(childrenOf(config, product.id).filter(node => !preludeIds.has(node.id)), x, y + 78, [id]);
    bottom = Math.max(bottom, lane.y); ends.push(...lane.tails);
  });
  const finish = sequence(closing, center, bottom + 24, ends.length ? ends : common.tails);
  // Only increasing, explicitly configured times become axis anchors.
  for (const mark of candidates.sort((a, b) => a.y - b.y)) {
    if (!graph.timeline.length || mark.minute > graph.timeline.at(-1)!.minute) graph.timeline.push(mark);
  }
  graph.height = Math.max(680, finish.y + 24, ...graph.nodes.map(node => node.position.y + (options.heights?.[node.id] ?? 80) + 48));
  return graph;
}

export function timelineCursor(marks: TimelineMark[], minute: number): number | null {
  if (!marks.length) return null;
  if (minute <= marks[0]!.minute) return marks[0]!.y;
  const next = marks.findIndex(mark => mark.minute > minute);
  if (next < 0) return marks.at(-1)!.y;
  const a = marks[next - 1]!, b = marks[next]!;
  return a.y + (b.y - a.y) * (minute - a.minute) / (b.minute - a.minute);
}
