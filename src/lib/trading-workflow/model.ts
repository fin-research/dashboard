import { z } from 'zod';

export const products = [
  { id: 'loan', label: '拆借', enabled: true, tone: 'info' },
  { id: 'reverse', label: '逆回购', enabled: true, tone: 'success' },
  { id: 'exchange', label: '交易所逆回购', enabled: false, tone: 'warning' },
] as const;
export type Product = typeof products[number]['id'];
export type Scope = Product | 'shared';
const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).refine(id => !Object.prototype.hasOwnProperty.call(Object.prototype, id), '节点编号为保留名称');
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const nodeSchema = z.object({
  id: idSchema,
  scope: z.enum(['loan', 'reverse', 'exchange', 'shared']),
  parentId: idSchema.nullable(),
  kind: z.enum(['task', 'branch']),
  title: z.string().trim().min(1).max(160),
  detail: z.string().trim().max(1200),
  startTime: timeSchema.nullable(),
  endTime: timeSchema.nullable(),
  offset: z.object({ x: z.number().finite().min(-10000).max(10000), y: z.number().finite().min(-10000).max(10000) }).strict().optional(),
  inquiry: z.boolean().optional(),
}).strict();
export type WorkflowNode = z.infer<typeof nodeSchema>;
export const nodesSchema = z.array(nodeSchema).max(150).superRefine((nodes, ctx) => {
  const ids = new Set<string>();
  const byId = new Map(nodes.map(node => [node.id, node]));
  for (const [index, node] of nodes.entries()) {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', path: [index], message });
    if (ids.has(node.id)) fail('节点编号重复');
    ids.add(node.id);
    if (node.endTime && (!node.startTime || node.endTime <= node.startTime)) fail('结束时间须晚于开始时间');
    if (node.kind === 'branch' && (node.startTime || node.endTime)) fail('条件分支不设置提醒时间');
    let parent = node.parentId;
    const ancestors = new Set([node.id]);
    let branchDepth = node.kind === 'branch' ? 1 : 0;
    while (parent) {
      const target = byId.get(parent);
      if (!target || target.kind !== 'branch' || target.scope !== node.scope) { fail('上级须为同品种条件分支'); break; }
      if (ancestors.has(parent) || ++branchDepth > 4) { fail('分支循环或超过四层'); break; }
      ancestors.add(parent);
      parent = target.parentId;
    }
  }
});
export const configSchema = z.object({ version: z.number().int().positive(), nodes: nodesSchema }).strict();
export type WorkflowConfig = z.infer<typeof configSchema>;
export const saveSchema = z.object({ expectedVersion: z.number().int().positive(), nodes: nodesSchema }).strict();
export const configResponseSchema = configSchema.extend({ actorKey: z.string().min(1), canEdit: z.boolean() });

export function shanghaiClock(now = new Date()) {
  const shifted = new Date(now.getTime() + 8 * 3600_000).toISOString();
  return { date: shifted.slice(0, 10), time: shifted.slice(11, 19), minutes: Number(shifted.slice(11, 13)) * 60 + Number(shifted.slice(14, 16)) + Number(shifted.slice(17, 19)) / 60 };
}
export function minutes(time: string) { const [h, m] = time.split(':').map(Number); return h! * 60 + m!; }
export function childrenOf(nodes: WorkflowNode[], scope: Scope, parentId: string | null = null) {
  return nodes.filter(node => node.scope === scope && node.parentId === parentId);
}
export function descendants(nodes: WorkflowNode[], id: string): Set<string> {
  const result = new Set([id]);
  for (let depth = 0; depth < 5; depth++) for (const node of nodes) if (node.parentId && result.has(node.parentId)) result.add(node.id);
  return result;
}
export function moveNode(nodes: WorkflowNode[], id: string, direction: -1 | 1): WorkflowNode[] {
  const current = nodes.find(node => node.id === id);
  if (!current) return nodes;
  const siblings = childrenOf(nodes, current.scope, current.parentId);
  const other = siblings[siblings.findIndex(node => node.id === id) + direction];
  if (!other) return nodes;
  const next = [...nodes];
  const a = next.indexOf(current), b = next.indexOf(other);
  [next[a], next[b]] = [other, current];
  return next;
}

const flags = z.record(z.string(), z.boolean());
export const daySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  enabled: z.object({ loan: z.boolean(), reverse: z.boolean(), exchange: z.boolean() }),
  completed: flags, branches: flags, notified: flags,
  notes: z.record(z.string(), z.string().max(4000)).default({}),
}).strict();
export type WorkflowDay = z.infer<typeof daySchema>;
export function emptyDay(date: string): WorkflowDay {
  return { date, enabled: { loan: true, reverse: true, exchange: false }, completed: {}, branches: {}, notified: {}, notes: {} };
}
export function isActive(node: WorkflowNode, nodes: WorkflowNode[], day: WorkflowDay): boolean {
  if (node.scope === 'shared' ? !Object.values(day.enabled).some(Boolean) : !day.enabled[node.scope]) return false;
  let parent = node.parentId;
  for (let depth = 0; parent && depth < 5; depth++) {
    if (!day.branches[parent]) return false;
    const ancestor = nodes.find(candidate => candidate.id === parent);
    if (!ancestor) return false;
    parent = ancestor.parentId;
  }
  return !parent;
}
export function activeTasks(nodes: WorkflowNode[], day: WorkflowDay, scope?: Scope) {
  return nodes.filter(node => node.kind === 'task' && (!scope || node.scope === scope) && isActive(node, nodes, day));
}
export function dueReminders(nodes: WorkflowNode[], day: WorkflowDay, now: Date, channel: string) {
  const clock = shanghaiClock(now);
  if (clock.date !== day.date) return [];
  return activeTasks(nodes, day).flatMap(node => {
    if (day.completed[node.id]) return [];
    // An overdue time window produces one closing reminder, not two stale alerts.
    const time = node.endTime && minutes(node.endTime) <= clock.minutes ? node.endTime : node.startTime;
    if (!time || minutes(time) > clock.minutes) return [];
    const key = `${channel}:${node.id}:${time}`;
    return day.notified[key] ? [] : [{ node, time, key }];
  });
}

export function dayKey(actorKey: string, date: string) { return `eastmoney:trading-workflow:v1:${encodeURIComponent(actorKey)}:${date}`; }
export function readDay(storage: Pick<Storage, 'getItem'>, key: string, date: string): WorkflowDay {
  const raw = storage.getItem(key);
  if (!raw) return emptyDay(date);
  const parsed = daySchema.parse(JSON.parse(raw));
  return parsed.date === date ? parsed : emptyDay(date);
}
/** Always merge against the latest local value before changing a field. Never sends progress to an API. */
export function updateDay(storage: Pick<Storage, 'getItem' | 'setItem'>, key: string, date: string, change: (day: WorkflowDay) => void): WorkflowDay {
  const day = readDay(storage, key, date);
  change(day);
  storage.setItem(key, JSON.stringify(daySchema.parse(day)));
  return day;
}

export function isInquiry(node: WorkflowNode) {
  return node.inquiry ?? ['loan-quote', 'reverse-quote'].includes(node.id);
}
