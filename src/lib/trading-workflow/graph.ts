import type { ShiborRate } from '../../data-contracts.ts';
import type { InquiryRow, InquiryDirectory } from './inquiries.ts';
import type { Node, Edge } from '@xyflow/svelte';
import { childrenOf, descendants, isInquiry, minutes, products, type Scope, type Product, type WorkflowNode, type WorkflowDay } from './model.ts';

export const NODE_WIDTH = 460;
export const VERTICAL_GAP = 76;
export type FlowEdge = Edge<{ joinY: number; side?: boolean }, 'workflow'>;
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
export type FlowGraph = { nodes: FlowNode[]; edges: FlowEdge[]; bases: Record<string, { x: number; y: number }>; timeline: TimelineMark[]; height: number; width: number; lanes: Partial<Record<Product, { x: number; width: number }>> };

/** Product ownership is explicit; identical labels never merge distinct nodes. */
export function workflowGroups(config: WorkflowNode[]): WorkflowNode[][] {
  return config.map(node => [node]);
}

function workflowPaths(config: WorkflowNode[]): string[][] {
  const flatten = (items: WorkflowNode[]): string[] => items.map(node => node.id);
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
  const depth = (node: WorkflowNode): number => node.parentId ? 1 + depth(config.find(item => item.id === node.parentId)!) : 0;
  const parentsActive = (node: WorkflowNode): boolean => !node.parentId || (!!day.branches[node.parentId] && parentsActive(config.find(item => item.id === node.parentId)!));
  const visibleConfig = config.filter(node => parentsActive(node) && (node.scope === 'shared' || day.enabled[node.scope]));
  const columns = new Map<Scope, number>([...enabled.map(product => [product.id, 1 + Math.max(0, ...visibleConfig.filter(node => node.scope === product.id).map(depth))] as [Scope, number]),
    ['shared', Math.max(0, ...visibleConfig.filter(node => node.scope === 'shared').map(depth))]]);
  const slots = Math.max(1, [...columns.values()].reduce((sum, value) => sum + value, enabled.length ? 0 : 1));
  const width = Math.max(170 + slots * 360, options.width ?? 1040);
  const graph: FlowGraph = { nodes: [], edges: [], bases: {}, timeline: [], height: 0, width, lanes: {} };
  const areaLeft = 134, column = (width - areaLeft - 24) / slots;
  const nodeWidth = Math.min(NODE_WIDTH, column - 36);
  let slot = enabled.length ? 0 : 1;
  for (const product of enabled) {
    graph.lanes[product.id] = { x: areaLeft + slot * column + (column - nodeWidth) / 2, width: nodeWidth };
    slot += columns.get(product.id)!;
  }
  const laneX = (scope: Scope) => scope === 'shared' ? center : graph.lanes[scope]?.x ?? areaLeft;
  const centers = enabled.map(product => graph.lanes[product.id]!.x);
  const center = centers.length ? (centers[0]! + centers.at(-1)!) / 2 : areaLeft + (column - nodeWidth) / 2;
  const sideX = (node: WorkflowNode) => node.scope === 'shared' && node.parentId
    ? areaLeft + (slot + depth(node) - 1) * column + (column - nodeWidth) / 2
    : laneX(node.scope) + depth(node) * column;
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
    if (!day.enabled[product.id]) return;
    let previous = '';
    for (const sourceId of paths[index]!) {
      const target = visible.get(sourceId);
      if (!target) continue;
      if (previous && previous !== target) incoming.get(target)!.add(previous);
      previous = target;
    }
  });
  if (!enabled.length) {
    const shared = childrenOf(config, 'shared');
    for (let i = 1; i < shared.length; i++) incoming.get(shared[i]!.id)?.add(shared[i - 1]!.id);
  }
  // Conditional children run on their own right-hand rail. The next root step
  // follows the branch trigger, never the expanded child chain.
  const sideEdges = new Set<string>();
  for (const node of visibleConfig.filter(node => node.kind === 'branch')) {
    let previous = node.id;
    for (const child of childrenOf(config, node.scope, node.id).filter(child => visible.has(child.id))) {
      incoming.get(child.id)!.add(previous);
      if (previous === node.id) sideEdges.add(`${previous}:${child.id}`);
      previous = child.id;
    }
  }
  // An empty lane must not add a shortcut across populated product paths.
  function reaches(from: string, target: string, seen = new Set<string>()): boolean {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return [...incoming.get(from) ?? []].some(id => reaches(id, target, seen));
  }
  for (const [target, sources] of incoming) {
    if (config.find(node => node.id === target)?.scope !== 'shared') continue;
    for (const source of [...sources]) if (config.find(node => node.id === source)?.scope === 'shared' &&
      [...sources].some(other => other !== source && reaches(other, source))) sources.delete(source);
  }
  const railBottom = new Map<number, number>();
  function connect(source: string, target: string, joinY: number) {
    const from = graph.nodes.find(node => node.id === source)!, to = graph.nodes.find(node => node.id === target)!;
    const scope = to.data.scope === 'shared' ? from.data.scope : to.data.scope;
    const color = scope === 'reverse' ? '#00a773' : scope === 'exchange' ? '#8090aa' : '#087cff';
    graph.edges.push({ id: `${source}:${target}`, source, target, type: 'workflow', sourceHandle: sideEdges.has(`${source}:${target}`) ? 'side' : undefined, targetHandle: sideEdges.has(`${source}:${target}`) ? 'side' : undefined, data: { joinY, side: sideEdges.has(`${source}:${target}`) },
      markerEnd: { type: 'arrowclosed' as import('@xyflow/svelte').MarkerType, width: 16, height: 16, color }, style: `stroke: ${color}; stroke-width: 1.8;` });
  }
  const pending = [...groups];
  while (pending.length) {
    const index = pending.findIndex(group => [...incoming.get(group[0]!.id)!].every(id => graph.nodes.some(node => node.id === id)));
    if (index < 0) throw new Error('交易流程存在循环连线');
    const members = pending.splice(index, 1)[0]!, node = members.find(item => item.id === options.selectedId) ?? members[0]!;
    const id = members[0]!.id, scope = members.length > 1 ? 'shared' : node.scope;
    const x = sideX(node);
    const predecessors = [...incoming.get(id)!].map(id => graph.nodes.find(node => node.id === id)!);
    const y = Math.max(104, node.parentId ? railBottom.get(x) ?? 0 : 0, ...predecessors.map(previous => (graph.bases[previous.id]?.y ?? previous.position.y) + (sideEdges.has(`${previous.id}:${id}`) ? 0 : previous.measured!.height! + VERTICAL_GAP)));
    graph.bases[id] = { x, y };
    const offset = members[0]!.offset;
    const position = { x: x + (offset?.x ?? 0), y: y + (offset?.y ?? 0) };
    const open = isInquiry(node) ? !!options.inquiries?.[id] : expanded(members);
    const estimate = 52 + (node.detail ? Math.ceil(node.detail.length / Math.max(12, (nodeWidth - 65) / 15)) * 23 : 0) + (isInquiry(node) && open ? 56 + (day.quotes[node.id]?.length ?? 0) * 39 : 0);
    const height = options.heights?.[id] ?? estimate;
    if (node.parentId) railBottom.set(x, y + height + VERTICAL_GAP);
    const done = members.every(item => nodeComplete(item, config, day));
    graph.nodes.push({ id, type: 'workflow', position, width: nodeWidth, measured: { width: nodeWidth, height }, focusable: false, draggable: options.editing, connectable: false,
      data: { node, members, rows: day.quotes[node.id] ?? [], directory: options.directory ?? { counterparties: [], traders: [] }, rates: options.rates ?? [], date: day.date, now: options.now ?? new Date(),
        writeRows: rows => options.rows?.(node.id, rows), remember: row => options.remember?.(row), title: isInquiry(node) ? '询价' : node.title, width: nodeWidth, scope, active: true, done, expanded: open,
        editing: options.editing, selected: members.some(item => item.id === options.selectedId),
        measureHeight: height => options.measureHeight?.(id, height), note: day.notes[node.id] ?? '',
        activate: () => options.activate(node, members), complete: () => options.complete?.(members), writeNote: value => options.note(node.id, value) } });
    const joinY = position.y - VERTICAL_GAP / 2;
    for (const predecessor of predecessors) connect(predecessor.id, id, joinY);
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
