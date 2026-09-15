import type { ShiborRate } from '../../data-contracts.ts';
import type { InquiryRow, InquiryDirectory } from './inquiries.ts';
import type { Node, BuiltInEdge } from '@xyflow/svelte';
import { childrenOf, descendants, isInquiry, minutes, products, type Scope, type Product, type WorkflowNode, type WorkflowDay } from './model.ts';

export const NODE_WIDTH = 300;
export type FlowData = {
  title: string; scope: Scope; node?: WorkflowNode; members?: WorkflowNode[]; width: number;
  rows: InquiryRow[]; directory: InquiryDirectory; rates: ShiborRate[]; date: string; now: Date;
  writeRows: (rows: InquiryRow[]) => void; remember: (row: InquiryRow) => void;
  done?: boolean; active?: boolean; expanded?: boolean; editing: boolean; selected?: boolean;
  note?: string; measureHeight?: (height: number) => void;
  activate: () => void; writeNote: (value: string) => void; complete?: () => void;
};
export type FlowNode = Node<FlowData, 'workflow'>;
export type TimelineMark = { time: string; minute: number; y: number; endX: number };
export type FlowGraph = { nodes: FlowNode[]; edges: BuiltInEdge[]; bases: Record<string, { x: number; y: number }>; timeline: TimelineMark[]; height: number; width: number };

/** Visual groups retain every source ID, so edits and daily records remain reversible. */
export function workflowGroups(config: WorkflowNode[]): WorkflowNode[][] {
  const groups = config.map(node => [node]);
  const signature = (node: WorkflowNode): string => JSON.stringify([
    node.kind, node.title.trim(), node.detail.trim(), node.startTime, node.endTime,
    isInquiry(node) ? node.id : null,
    childrenOf(config, node.scope, node.id).map(signature),
  ]);
  // Match occurrences within equivalent conditional contexts, never just a task label.
  const keys = new Map<string, string>();
  function visit(scope: Scope, parent: string | null, context: string) {
    const occurrences = new Map<string, number>();
    for (const node of childrenOf(config, scope, parent)) {
      const sig = signature(node), occurrence = occurrences.get(sig) ?? 0;
      occurrences.set(sig, occurrence + 1);
      const key = JSON.stringify([context, sig, occurrence]); keys.set(node.id, key);
      visit(scope, node.id, key);
    }
  }
  for (const scope of ['shared', ...products.map(product => product.id)] as Scope[]) visit(scope, null, 'root');
  const paths = workflowPaths(config);
  function acyclic(candidate: WorkflowNode[][]) {
    const ids = new Map(candidate.flatMap((group, index) => group.map(node => [node.id, index] as const)));
    const edges = candidate.map(() => new Set<number>()), indegree = candidate.map(() => 0);
    for (const path of paths) for (let i = 1; i < path.length; i++) {
      const a = ids.get(path[i - 1]!)!, b = ids.get(path[i]!)!;
      if (a === b) return false;
      if (!edges[a]!.has(b)) { edges[a]!.add(b); indegree[b]!++; }
    }
    const ready = indegree.flatMap((degree, index) => degree === 0 ? [index] : []);
    let visited = 0;
    while (ready.length) { const id = ready.shift()!; visited++; for (const next of edges[id]!) if (--indegree[next]! === 0) ready.push(next); }
    return visited === candidate.length;
  }
  for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
    const a = groups[i]!, b = groups[j]!;
    if (a.some(node => node.scope === 'shared') || b.some(node => node.scope === 'shared') ||
      a.some(node => b.some(other => other.scope === node.scope)) || keys.get(a[0]!.id) !== keys.get(b[0]!.id)) continue;
    const candidate = groups.map((group, index) => index === i ? [...a, ...b] : group).filter((_, index) => index !== j);
    if (acyclic(candidate)) { groups[i] = [...a, ...b]; groups.splice(j--, 1); }
  }
  return groups;
}

function workflowPaths(config: WorkflowNode[]): string[][] {
  const flatten = (items: WorkflowNode[]): string[] => items.flatMap(node => [node.id, ...flatten(childrenOf(config, node.scope, node.id))]);
  const shared = childrenOf(config, 'shared');
  const closingIndex = shared.findIndex(node => node.id === 'shared-done');
  const opening = closingIndex < 0 ? shared : shared.slice(0, closingIndex);
  const closing = closingIndex < 0 ? [] : shared.slice(closingIndex);
  const firstTime = opening.find(node => node.startTime)?.startTime;
  return products.map(product => {
    const lane = childrenOf(config, product.id);
    let prefix = 0;
    while (prefix < lane.length && lane[prefix]!.kind === 'task' && lane[prefix]!.startTime && firstTime && lane[prefix]!.startTime! < firstTime) prefix++;
    return [...flatten(lane.slice(0, prefix)), ...flatten(opening), ...flatten(lane.slice(prefix)), ...flatten(closing)];
  });
}

export function nodeComplete(node: WorkflowNode, config: WorkflowNode[], day: WorkflowDay): boolean {
  if (isInquiry(node)) return false;
  if (node.kind === 'task') return !!day.completed[node.id];
  const ids = descendants(config, node.id);
  const tasks = config.filter(item => ids.has(item.id) && item.kind === 'task' && !isInquiry(item));
  return tasks.length > 0 && tasks.every(item => day.completed[item.id]);
}

export function buildGraph(config: WorkflowNode[], day: WorkflowDay, options: {
  editing: boolean; selectedId: string; clockMinutes: number; width?: number; heights?: Record<string, number>;
  inquiries?: Record<string, boolean>; measureHeight?: (id: string, height: number) => void;
  activate: (node: WorkflowNode, members: WorkflowNode[]) => void; toggleProduct: (product: Product) => void;
  rows?: (id: string, rows: InquiryRow[]) => void; directory?: InquiryDirectory; rates?: ShiborRate[]; now?: Date; remember?: (row: InquiryRow) => void;
  note: (id: string, value: string) => void; complete?: (members: WorkflowNode[]) => void;
}): FlowGraph {
  const enabled = products.filter(product => day.enabled[product.id]);
  const count = Math.max(1, enabled.length);
  const width = Math.max(170 + count * 440, options.width ?? 1040);
  const graph: FlowGraph = { nodes: [], edges: [], bases: {}, timeline: [], height: 0, width };
  const areaLeft = 134, areaRight = width - 24, column = (areaRight - areaLeft) / count;
  const nodeWidth = column - 36, center = (areaLeft + areaRight - nodeWidth) / 2;
  const laneX = (scope: Scope) => areaLeft + Math.max(0, enabled.findIndex(product => product.id === scope)) * column + 18;
  const allGroups = workflowGroups(config);
  const byId = new Map(allGroups.flatMap(group => group.map(node => [node.id, group] as const)));
  const expanded = (group: WorkflowNode[]) => group.some(node => day.branches[node.id]);
  function parentsOpen(node: WorkflowNode): boolean {
    if (!node.parentId) return true;
    const parent = byId.get(node.parentId);
    return !!parent && expanded(parent) && parentsOpen(parent[0]!);
  }
  // Shared steps survive product folding; only their own conditional parent can hide them.
  const groups = allGroups.filter(group => parentsOpen(group[0]!) && (group.length > 1 || group[0]!.scope === 'shared' || day.enabled[group[0]!.scope]));
  const visible = new Map(groups.flatMap(group => group.map(node => [node.id, group[0]!.id] as const)));
  const incoming = new Map<string, Set<string>>(groups.map(group => [group[0]!.id, new Set()]));
  const paths = workflowPaths(config);
  products.forEach((product, index) => {
    let previous = '';
    for (const sourceId of paths[index]!) {
      const target = visible.get(sourceId);
      if (!target) continue;
      if (previous && previous !== target) incoming.get(target)!.add(previous);
      previous = target;
    }
  });
  function connect(source: string, target: string) {
    const from = graph.nodes.find(node => node.id === source)!, to = graph.nodes.find(node => node.id === target)!;
    const scope = to.data.scope === 'shared' ? from.data.scope : to.data.scope;
    const color = scope === 'reverse' ? '#00a773' : scope === 'exchange' ? '#8090aa' : '#087cff';
    graph.edges.push({ id: `${source}:${target}`, source, target, type: 'smoothstep', pathOptions: { borderRadius: 10, offset: 24 },
      markerEnd: { type: 'arrowclosed' as import('@xyflow/svelte').MarkerType, width: 16, height: 16, color }, style: `stroke: ${color}; stroke-width: 1.8;` });
  }
  const pending = [...groups];
  while (pending.length) {
    const index = pending.findIndex(group => [...incoming.get(group[0]!.id)!].every(id => graph.nodes.some(node => node.id === id)));
    if (index < 0) throw new Error('交易流程存在循环连线');
    const members = pending.splice(index, 1)[0]!, node = members.find(item => item.id === options.selectedId) ?? members[0]!;
    const id = members[0]!.id, scope = members.length > 1 ? 'shared' : node.scope;
    const x = scope === 'shared' ? center : laneX(scope);
    const predecessors = [...incoming.get(id)!].map(id => graph.nodes.find(node => node.id === id)!);
    const y = Math.max(80, ...predecessors.map(node => (graph.bases[node.id]?.y ?? node.position.y) + node.measured!.height! + 28));
    graph.bases[id] = { x, y };
    const offset = members[0]!.offset;
    const position = { x: x + (offset?.x ?? 0), y: y + (offset?.y ?? 0) };
    const open = isInquiry(node) ? !!options.inquiries?.[id] : expanded(members);
    const estimate = 52 + (node.detail ? Math.ceil(node.detail.length / Math.max(12, (nodeWidth - 65) / 15)) * 23 : 0) + (isInquiry(node) && open ? 56 + (day.quotes[node.id]?.length ?? 0) * 39 : 0);
    const height = options.heights?.[id] ?? estimate;
    const done = members.every(item => nodeComplete(item, config, day));
    graph.nodes.push({ id, type: 'workflow', position, width: nodeWidth, measured: { width: nodeWidth, height }, focusable: false, draggable: options.editing, connectable: false,
      data: { node, members, rows: day.quotes[node.id] ?? [], directory: options.directory ?? { counterparties: [], traders: [] }, rates: options.rates ?? [], date: day.date, now: options.now ?? new Date(),
        writeRows: rows => options.rows?.(node.id, rows), remember: row => options.remember?.(row), title: isInquiry(node) ? '询价' : node.title, width: nodeWidth, scope, active: true, done, expanded: open,
        editing: options.editing, selected: members.some(item => item.id === options.selectedId),
        measureHeight: height => options.measureHeight?.(id, height), note: day.notes[node.id] ?? '',
        activate: () => options.activate(node, members), complete: () => options.complete?.(members), writeNote: value => options.note(node.id, value) } });
    for (const predecessor of predecessors) connect(predecessor.id, id);
  }
  const candidates = graph.nodes.filter(node => node.data.node?.startTime).map(node => ({
    time: node.data.node!.startTime!, minute: minutes(node.data.node!.startTime!), y: node.position.y + node.measured!.height! / 2, endX: node.position.x - 8,
  }));
  for (const mark of candidates.sort((a, b) => a.y - b.y)) if (!graph.timeline.length || mark.minute > graph.timeline.at(-1)!.minute) graph.timeline.push(mark);
  graph.height = Math.max(680, ...graph.nodes.map(node => node.position.y + node.measured!.height! + 48));
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
