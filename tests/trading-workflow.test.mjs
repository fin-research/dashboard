import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { buildGraph, timelineCursor } from '../src/lib/trading-workflow/graph.ts';
import { activeTasks, childrenOf, dayKey, descendants, dueReminders, emptyDay, moveNode, nodesSchema, readDay, saveSchema, shanghaiClock, updateDay } from '../src/lib/trading-workflow/model.ts';
import { readWorkflowConfig, saveWorkflowConfig } from '../src/lib/server/trading-workflow.ts';

function database() {
  const sqlite = new DatabaseSync(':memory:');
  const migration = readFileSync(new URL('../migrations/1015_trading_workflow_config.sql', import.meta.url), 'utf8');
  sqlite.exec(migration);
  const adapter = { prepare(sql) { let values = []; return { bind(...args) { values = args; return this; }, async first() { return sqlite.prepare(sql).get(...values) ?? null; } }; } };
  return { sqlite, adapter, migration };
}
const fixture = database();
const defaults = JSON.parse(fixture.sqlite.prepare('SELECT nodes FROM trading_workflow_config').get().nodes);
fixture.sqlite.close();
function storage() { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; }

test('migration seeds every product and shared instruction without progress tables; replay preserves edited config', async () => {
  const { sqlite, adapter, migration } = database();
  try {
    const initial = await readWorkflowConfig(adapter);
    assert.equal(initial.nodes.length, 26);
    assert.equal(nodesSchema.safeParse(initial.nodes).success, true);
    assert.deepEqual(initial.nodes.filter(n => n.scope === 'loan').map(n => n.title), ['询价', '本币发交易', '等待成交', '导出发咚咚群', '衡泰补单审批', '资金系统导入数据 & 还款申请', '银企流水查询是否到账']);
    assert.match(initial.nodes.find(n => n.id === 'reverse-check').detail, /AAA.*− 5.*≤ 95\n.*永续.*次级.*− 10.*≤ 90/);
    assert.match(initial.nodes.find(n => n.id === 'reverse-transfer').detail, /0386 → 0432/);
    assert.match(initial.nodes.find(n => n.id === 'reverse-ccdc').detail, /0432 → 2001/);
    const edited = initial.nodes.map(n => n.id === 'loan-send' ? { ...n, title: '修改后的节点' } : n);
    const result = await saveWorkflowConfig(adapter, { expectedVersion: 1, nodes: edited });
    assert.equal(result.version, 2);
    sqlite.exec(migration);
    assert.deepEqual(await readWorkflowConfig(adapter), result);
    assert.deepEqual(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name), ['trading_workflow_config']);
    await assert.rejects(saveWorkflowConfig(adapter, { expectedVersion: 1, nodes: defaults }), e => e.status === 409);
    assert.deepEqual(await readWorkflowConfig(adapter), result);
  } finally { sqlite.close(); }
});

test('config rejects progress, duplicate IDs, foreign/missing parents, cycles and invalid times', () => {
  assert.equal(saveSchema.safeParse({ expectedVersion: 1, nodes: defaults, completed: {} }).success, false);
  assert.equal(nodesSchema.safeParse([...defaults, defaults[0]]).success, false);
  for (const patch of [{ parentId: 'absent' }, { parentId: 'shared-done' }, { parentId: 'loan-send' }, { startTime: '25:00' }, { startTime: '11:00', endTime: '10:00' }, { startTime: null, endTime: '12:00' }]) {
    const nodes = defaults.map(n => n.id === 'loan-send' ? { ...n, ...patch } : n);
    assert.equal(nodesSchema.safeParse(nodes).success, false, JSON.stringify(patch));
  }
  const cycle = defaults.map(n => n.id === 'reverse-counterparty' ? { ...n, parentId: 'reverse-missing' } : n);
  assert.equal(nodesSchema.safeParse(cycle).success, false);
  assert.equal(nodesSchema.safeParse(defaults.map(n => n.id === 'loan-send' ? { ...n, completed: true } : n)).success, false);
});

test('reserved node IDs and more than four nested branches are rejected', () => {
  for (const id of ['__proto__', 'constructor', 'toString']) assert.equal(nodesSchema.safeParse([{ ...defaults[0], id }]).success, false);
  const nested = Array.from({ length: 5 }, (_, i) => ({ ...defaults[0], id: `branch-${i}`, kind: 'branch', startTime: null, parentId: i ? `branch-${i - 1}` : null }));
  assert.equal(nodesSchema.safeParse(nested.slice(0, 4)).success, true);
  assert.equal(nodesSchema.safeParse(nested).success, false);
});

test('daily products and nested conditions determine active tasks without losing prior completion', () => {
  const day = emptyDay('2026-09-15');
  assert.deepEqual(day.enabled, { loan: true, reverse: true, exchange: false });
  assert.equal(activeTasks(defaults, day, 'loan').length, 7);
  assert.equal(activeTasks(defaults, day, 'reverse').length, 3);
  assert.equal(activeTasks(defaults, day, 'exchange').length, 0);
  day.branches['reverse-counterparty'] = true;
  day.branches['reverse-missing'] = true;
  assert.equal(activeTasks(defaults, day, 'reverse').length, 5);
  day.completed['reverse-approval'] = true;
  day.branches['reverse-counterparty'] = false;
  assert.equal(activeTasks(defaults, day, 'reverse').length, 3);
  assert.equal(day.completed['reverse-approval'], true);
  day.enabled.exchange = true;
  assert.equal(activeTasks(defaults, day, 'exchange').length, 4);
});

test('move keeps branch descendants and reorders only siblings; deletion collects entire subtree', () => {
  const moved = moveNode(defaults, 'reverse-counterparty', -1);
  assert.deepEqual(childrenOf(moved, 'reverse').map(n => n.id), ['reverse-quote', 'reverse-counterparty', 'reverse-change', 'reverse-hengtai', 'reverse-confirm']);
  assert.deepEqual([...descendants(moved, 'reverse-counterparty')].sort(), ['reverse-approval', 'reverse-check', 'reverse-counterparty', 'reverse-missing'].sort());
  assert.equal(moveNode(defaults, 'loan-quote', -1), defaults);
  assert.deepEqual(childrenOf(moved, 'reverse', 'reverse-missing'), childrenOf(defaults, 'reverse', 'reverse-missing'));
});

test('local progress survives reload, merges other tab fields, and isolates user and Shanghai midnight', () => {
  const store = storage(), date = '2026-09-15', key = dayKey('a', date);
  updateDay(store, key, date, d => { d.completed['loan-quote'] = true; });
  updateDay(store, key, date, d => { d.branches['reverse-change'] = true; });
  const restored = readDay(store, key, date);
  assert.equal(restored.completed['loan-quote'], true);
  assert.equal(restored.branches['reverse-change'], true);
  assert.deepEqual(readDay(store, dayKey('b', date), date), emptyDay(date));
  const next = shanghaiClock(new Date('2026-09-15T16:00:00Z'));
  assert.equal(next.date, '2026-09-16'); assert.equal(next.time, '00:00:00');
  assert.deepEqual(readDay(store, dayKey('a', next.date), next.date), emptyDay(next.date));
  store.setItem(key, '{broken'); assert.throws(() => readDay(store, key, date));
});

test('reminders cover exact boundaries, intervals, late wakeup, inactive branches and daily/channel dedupe', () => {
  const day = emptyDay('2026-09-15');
  const due = time => dueReminders(defaults, day, new Date(`2026-09-15T${time}+08:00`), 'browser');
  assert.equal(due('08:29:59').length, 0);
  const start = due('08:30:00'); assert.equal(start.length, 2);
  for (const item of start) day.notified[item.key] = true;
  assert.equal(due('08:30:01').length, 0);
  assert.equal(due('10:00:00').length, 3);
  day.completed['loan-quote'] = true;
  const late = due('16:30:00');
  assert.equal(late.some(item => item.node.scope === 'exchange'), false);
  assert.equal(late.some(item => item.node.id === 'loan-quote'), false);
  assert.equal(late.filter(item => item.node.id === 'reverse-quote').length, 1);
  assert.equal(late.find(item => item.node.id === 'reverse-quote').time, '10:00');
  assert.equal(late.some(item => item.node.id === 'loan-arrival'), true);
  assert.equal(dueReminders(defaults, day, new Date('2026-09-16T08:30:00+08:00'), 'browser').length, 0);
  assert.equal(dueReminders(defaults, day, new Date('2026-09-15T08:30:00+08:00'), 'page').length, 1);
  const timedBranch = defaults.map(n => n.id === 'reverse-position' ? { ...n, startTime: '09:00' } : n);
  assert.equal(dueReminders(timedBranch, day, new Date('2026-09-15T09:00:00+08:00'), 'browser').length, 0);
  day.branches['reverse-change'] = true;
  assert.equal(dueReminders(timedBranch, day, new Date('2026-09-15T09:00:00+08:00'), 'browser').length, 1);
});

test('workflow DOM interactions, local-only writes, editor conflicts and authenticated API boundaries', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { stdout } = await promisify(execFile)(process.execPath, ['--conditions=browser','tests/helpers/trading-workflow-ui.mjs'], { cwd: new URL('../',import.meta.url), timeout:60000 });
  assert.match(stdout, /Trading workflow DOM and API checks passed/);
});


test('flow graph folds conditions, centers common steps, joins paths and preserves custom offsets', () => {
  const day = emptyDay('2026-09-15');
  const options = { editing: false, selectedId: '', clockMinutes: 600, activate() {}, toggleProduct() {}, note() {} };
  const folded = buildGraph(defaults, day, options);
  assert.equal(folded.nodes.some(n => n.id === 'reverse-position'), false);
  assert.equal(folded.nodes.some(n => n.id === 'product-exchange'), false);
  const at = id => folded.nodes.find(n => n.id === id).position;
  assert.equal(at('shared-elements').x, (at('product-loan').x + at('product-reverse').x) / 2);
  assert.equal(at('shared-done').x, at('shared-elements').x);
  assert.ok(at('shared-done').y > at('loan-arrival').y);
  assert.ok(at('loan-quote').y < at('shared-elements').y);
  assert.ok(at('reverse-quote').y < at('shared-elements').y);
  assert.ok(at('shared-elements').y < at('loan-send').y);
  assert.deepEqual(folded.timeline.map(mark=>mark.time), ['08:30','10:00','11:00','16:30']);
  const first=folded.timeline[0], second=folded.timeline[1];
  assert.equal(timelineCursor(folded.timeline, (first.minute + second.minute)/2), (first.y + second.y)/2);
  assert.equal(timelineCursor(folded.timeline, 0), first.y);
  assert.equal(timelineCursor([], 600), null);
  assert.ok(folded.nodes.every(node=>node.measured?.height > 0), 'flow nodes stay visible through reactive rebuilds');
  day.branches['reverse-change'] = true;
  const expanded = buildGraph(defaults, day, options);
  assert.ok(expanded.nodes.some(n => n.id === 'reverse-position'));
  assert.ok(expanded.edges.some(e => e.source === 'reverse-change' && e.target === 'reverse-position'));
  assert.ok(expanded.edges.some(e => e.source === 'reverse-ccdc' && e.target === 'reverse-counterparty'));
  assert.equal(expanded.edges.some(e => e.source === 'reverse-change' && e.target === 'reverse-counterparty'), false);
  const taller = buildGraph(defaults, day, {...options, heights:{'loan-send':500}});
  assert.ok(taller.nodes.find(n => n.id === 'loan-deal').position.y >= taller.nodes.find(n => n.id === 'loan-send').position.y + 528);
  const positioned = defaults.map(n => n.id === 'loan-send' ? {...n, offset:{x:85,y:-20}} : n);
  const custom = buildGraph(positioned, day, {...options, editing:true});
  assert.equal(custom.nodes.find(n => n.id === 'loan-send').position.x, custom.bases['loan-send'].x + 85);
  assert.equal(custom.nodes.find(n => n.id === 'loan-send').draggable, true);
  assert.equal(folded.nodes.find(n => n.id === 'loan-send').draggable, false);
  assert.equal(nodesSchema.safeParse(positioned).success, true);
  assert.equal(nodesSchema.safeParse(defaults.map(n => ({...n,offset:{x:Infinity,y:0}}))).success, false);
});

test('legacy day records gain empty inquiry notes without losing progress; notes isolate and merge by day', () => {
  const store=storage(), date='2026-09-15', key=dayKey('notes-user',date);
  const {notes,...legacy}=emptyDay(date); legacy.completed['loan-quote']=true;
  store.setItem(key,JSON.stringify(legacy));
  assert.deepEqual(readDay(store,key,date).notes,{});
  updateDay(store,key,date,d=>{d.notes['loan-quote']='7天 1.65%';});
  updateDay(store,key,date,d=>{d.completed['loan-send']=true;});
  assert.equal(readDay(store,key,date).completed['loan-quote'],true);
  assert.equal(readDay(store,key,date).notes['loan-quote'],'7天 1.65%');
  assert.deepEqual(readDay(store,dayKey('notes-user','2026-09-16'),'2026-09-16').notes,{});
});
