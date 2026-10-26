import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchBriefingNewsDetails } from '../src/lib/server/market-briefing.ts';
import { newsWorkflow } from './fixtures/market-briefing-news.mjs';

const date = '2026-10-23';
const items = Array.from({ length: 40 }, (_, i) => ({ sentimentId: `news-${i}`, title: `新闻${i}`, time: `${date}T15:00:00+08:00`, tags: ['债市'] }));
function harness(override) {
  let listCalls = 0, detailCalls = 0;
  const env = { DATA: { fetch: async request => {
    const url = new URL(request.url);
    if (url.pathname === '/data/news') { listCalls++; return Response.json(items); }
    detailCalls++;
    const id = url.pathname.split('/').at(-1);
    const result = await override?.(id);
    return result ?? Response.json({ ...items.find(item => item.sentimentId === id), content: '新闻正文' });
  } } };
  env.MARKET_BRIEFING_NEWS = newsWorkflow(env);
  return { env, counts: () => ({ listCalls, detailCalls }) };
}

test('40篇完整保序返回，详情使用四个独立预算，单批失败由child重试', async () => {
  let failed = false;
  const h = harness(id => {
    if (id === 'news-0' && !failed) { failed = true; return new Response('unavailable', { status: 503 }); }
  });
  const result = await fetchBriefingNewsDetails(h.env, date);
  assert.deepEqual(result.map(item => item.sentimentId), items.map(item => item.sentimentId));
  const children = [...h.env.MARKET_BRIEFING_NEWS.instances.values()];
  assert.equal(children.length, 4);
  assert.equal(children[0].attempts, 2);
  assert.ok(children.every(child => child.params.items.length === 10 && child.calls <= 30));
  const detailCalls = h.counts().detailCalls;
  await fetchBriefingNewsDetails(h.env, date);
  assert.equal(h.env.MARKET_BRIEFING_NEWS.instances.size, 4);
  assert.equal(h.counts().detailCalls, detailCalls);
});

test('子批终态失败保留原错，父层重复调用不重启或创建更多批次', async () => {
  const h = harness(() => new Response('upstream failure', { status: 503 }));
  await assert.rejects(fetchBriefingNewsDetails(h.env, date), /HTTP 503/);
  const calls = h.counts().detailCalls;
  assert.equal([...h.env.MARKET_BRIEFING_NEWS.instances.values()][0].attempts, 3);
  assert.ok(calls <= 30);
  await assert.rejects(fetchBriefingNewsDetails(h.env, date), /HTTP 503/);
  assert.equal(h.counts().detailCalls, calls);
  assert.equal(h.env.MARKET_BRIEFING_NEWS.instances.size, 1);
});

test('拒绝错位批次结果与缺失绑定，取消后不启动子批', async () => {
  const h = harness();
  h.env.MARKET_BRIEFING_NEWS = { create: async ({ params }) => ({ status: async () => ({ status: 'complete', output: params.items.toReversed() }) }) };
  await assert.rejects(fetchBriefingNewsDetails(h.env, date), /批次结果不匹配/);
  delete h.env.MARKET_BRIEFING_NEWS;
  await assert.rejects(fetchBriefingNewsDetails(h.env, date), /未配置/);
  const controller = new AbortController(); controller.abort(new Error('cancelled'));
  await assert.rejects(fetchBriefingNewsDetails(h.env, date, controller.signal), /cancelled/);
});

test('轮询有界并保持原始创建失败，等待中取消立即终止父请求', async t => {
  const h = harness();
  let polls = 0;
  h.env.MARKET_BRIEFING_NEWS = { create: async () => ({ status: async () => { polls++; return { status: 'running' }; } }) };
  t.mock.method(globalThis, 'setTimeout', callback => { queueMicrotask(callback); return 0; });
  await assert.rejects(fetchBriefingNewsDetails(h.env, date), /等待超时/);
  assert.equal(polls, 35);
  const controller = new AbortController();
  t.mock.method(globalThis, 'setTimeout', () => { queueMicrotask(() => controller.abort(new Error('cancelled during wait'))); return 0; });
  await assert.rejects(fetchBriefingNewsDetails(h.env, date, controller.signal), /cancelled during wait/);
  const original = new Error('create failed');
  h.env.MARKET_BRIEFING_NEWS = { create: async () => { throw original; }, get: async () => { throw new Error('missing'); } };
  await assert.rejects(fetchBriefingNewsDetails(h.env, date), error => error === original);
});

test('两次批次失败后第三次成功仍最多30个DATA请求', async () => {
  let failures = 0;
  const h = harness(id => {
    if (id === 'news-9' && failures++ < 2) return new Response('unavailable', { status: 503 });
  });
  assert.equal((await fetchBriefingNewsDetails(h.env, date)).length, 40);
  assert.equal([...h.env.MARKET_BRIEFING_NEWS.instances.values()][0].calls, 30);
});


test('queued和running后完整返回，status期间取消不遗漏abort', async t => {
  const h = harness();
  let created = 0;
  h.env.MARKET_BRIEFING_NEWS = { create: async ({ params }) => {
    created++; let polls = 0;
    return { status: async () => (++polls < 3
      ? { status: polls === 1 ? 'queued' : 'running' }
      : { status: 'complete', output: params.items.map(item => ({ ...item, content: '正文' })) }) };
  } };
  t.mock.method(globalThis, 'setTimeout', callback => { queueMicrotask(callback); return 0; });
  assert.equal((await fetchBriefingNewsDetails(h.env, date)).length, 40);
  assert.equal(created, 4);
  const controller = new AbortController();
  h.env.MARKET_BRIEFING_NEWS = { create: async () => ({ status: async () => {
    controller.abort(new Error('cancelled inside status')); return { status: 'running' };
  } }) };
  await assert.rejects(fetchBriefingNewsDetails(h.env, date, controller.signal), /cancelled inside status/);
});
