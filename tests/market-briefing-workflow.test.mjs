import assert from 'node:assert/strict';
import test from 'node:test';
import { runMarketBriefing, startMarketBriefing } from '../worker/market-briefing-runner.ts';
import { saveMarketReport } from '../src/lib/server/market-report.ts';
import { sendMarketBriefingResult } from '../src/lib/server/market-briefing-email.ts';
import { directResponse } from './fixtures/market-resources.mjs';

const date = '2026-08-25';
function clock(t) { t.mock.timers.enable({ apis: ['Date'], now: new Date(`${date}T17:00:00+08:00`) }); }
function deferred() { return Promise.withResolvers(); }
function newsItem(index) {
  return { sentimentId: `news-${index}`, title: `要闻${index}`, time: `${date}T15:00:00+08:00`, tags: ['债市'], content: '新闻正文' };
}
function harness(override) {
  const calls = [], steps = [], objects = new Map(), checkpoints = new Map(), notifications = [];
  const env = { DATA: { fetch: async req => {
    calls.push(req.url);
    const response = await override?.(req.url);
    if (response) return response;
    const url = new URL(req.url);
    if (url.pathname === '/data/news') return Response.json([newsItem(1)]);
    if (url.pathname.startsWith('/data/news/')) return Response.json(newsItem(1));
    return directResponse(req.url);
  } }, EASTMONEY: { put: async (key, body) => { objects.set(key, JSON.parse(body)); return { etag: 'saved' }; } } };
  // Successful step values survive replay. The harness does not implement the platform's retry engine.
  const step = { do: async (name, config, fn) => {
    if (checkpoints.has(name)) return structuredClone(checkpoints.get(name));
    steps.push({ name, config });
    const value = await fn();
    checkpoints.set(name, structuredClone(value));
    return value;
  } };
  const dependencies = {
    generateMarketBriefingFromNews: async () => ({ stock: '股市判断', bond: '债市判断' }),
    saveMarketReport,
    sendMarketBriefingResult: async (_env, result) => { notifications.push(result); return { messageId: '1', status: 'accepted' }; },
  };
  const run = () => runMarketBriefing(env, step, { reportDate: date }, 'test', dependencies);
  return { env, step, calls, steps, objects, checkpoints, notifications, dependencies, run };
}

test('独立行情和新闻step并发，AI不等待行业行情；共用收评并只汇总保存一次', async t => {
  clock(t);
  const industryGate = deferred();
  const h = harness(url => url.includes('/industry?') ? industryGate.promise.then(() => directResponse(url)) : undefined);
  const events = [];
  h.dependencies.generateMarketBriefingFromNews = async (_env, _date, news, options) => {
    assert.equal(h.checkpoints.has('fetch-industry'), false);
    assert.ok(h.calls.some(url => url.includes('/omo?')));
    assert.equal(h.calls.filter(url => url.includes('/stock-summary?')).length, 1);
    assert.match(news.news_text, /A股主要指数收涨/);
    assert.match(news.news_text, /新闻正文/);
    assert.equal(options.retry, false);
    events.push('ai');
    industryGate.resolve();
    return { stock: '股市判断', bond: '债市判断' };
  };
  h.dependencies.saveMarketReport = async (...args) => { events.push('r2'); return saveMarketReport(...args); };
  h.dependencies.sendMarketBriefingResult = async () => { events.push('mail'); return { messageId: '1', status: 'accepted' }; };
  const result = await h.run();
  assert.equal(result.status, 'complete');
  assert.deepEqual(events, ['ai', 'r2', 'mail']);
  assert.equal(h.calls.length, 14);
  assert.equal(h.calls.filter(url => url.includes('/bond-infos?')).length, 1);
  assert.ok(h.calls.every(url => url.includes('fields=')));
  assert.ok(h.steps.filter(row => row.name.startsWith('fetch-')).every(({ config }) => config.retries.limit === 3));
  assert.equal(h.steps.find(row => row.name === 'generate-focus').config.retries.limit, 2);
  assert.equal(h.steps.some(row => ['trading-day', 'assemble-report'].includes(row.name)), false);
  const report = h.objects.get(`market-briefing/${date}.json`);
  assert.equal(report.focus_text, '1、股市判断\n2、债市判断');
  assert.equal(report.omo_operations[0].amount_yi, 1000);
  assert.equal(report.omo_operations[0].interest_rate, null);
  assert.equal(report.futures[0].last_price, null);
  assert.equal(report.primary_summary.current_amount, 0);
  assert.equal(report.secondary_bonds[0].issuer, '测试公司');
  assert.equal(report.inventory_bonds[0].bid_yield, 2.01);
});

test('个别国债收益率缺失保留其他行情且不归零', async t => {
  clock(t);
  const h = harness(url => url.includes('/bond-top-case?') ? Response.json([
    { ordinateName: '国债', abscissaName: '10Y', bondCode: '260011.IB', tradeNum: 20, yield: 1.8, yieldSubYtdCloseBp: -1 },
    { ordinateName: '国债', abscissaName: '5Y', bondCode: '260010.IB', tradeNum: 1, yield: null, yieldSubYtdCloseBp: null },
  ]) : undefined);
  await h.run();
  assert.deepEqual(h.objects.get(`market-briefing/${date}.json`).government_bonds.map(row => row.yield_rate), [null, 1.8]);
});

for (const source of ['stock-summary', 'industry', 'bond-infos', 'news/news-1']) {
  test(`${source}的step失败后通知，不写残缺R2`, async t => {
    clock(t);
    const h = harness(url => url.includes(`/data/${source}?`) ? Response.json({ detail: '源不可用' }, { status: 503 }) : undefined);
    await assert.rejects(h.run());
    assert.equal(h.notifications[0].status, 'failed');
    assert.equal(h.objects.size, 0);
    assert.equal(h.steps.some(row => row.name === 'aggregate-and-save-r2'), false);
  });
}

test('失败通知等待所有并发step结束', async t => {
  clock(t);
  const gate = deferred(), started = deferred();
  const h = harness(url => {
    if (url.includes('/omo?')) return Response.json({}, { status: 503 });
    if (url.includes('/futures-latest?')) { started.resolve(); return gate.promise.then(() => directResponse(url)); }
  });
  const pending = assert.rejects(h.run());
  await started.promise;
  assert.deepEqual(h.notifications, []);
  gate.resolve();
  await pending;
  assert.equal(h.notifications[0].status, 'failed');
});

test('新闻详情各自持久化，并发上限五；AI失败重放不重新采集', async t => {
  clock(t);
  const gate = deferred(), full = deferred();
  let active = 0, peak = 0, attempts = 0;
  const h = harness(async url => {
    const path = new URL(url).pathname;
    if (path === '/data/news') return Response.json(Array.from({ length: 7 }, (_, i) => newsItem(i)));
    if (path.startsWith('/data/news/')) {
      active++; peak = Math.max(peak, active);
      if (active === 5) full.resolve();
      await gate.promise;
      active--;
      return Response.json(newsItem(Number(path.split('-').at(-1))));
    }
  });
  h.dependencies.generateMarketBriefingFromNews = async () => {
    if (++attempts === 1) throw new Error('AI unavailable');
    return { stock: '股', bond: '债' };
  };
  const failed = assert.rejects(h.run(), /AI unavailable/);
  await full.promise;
  assert.equal(active, 5);
  gate.resolve();
  await failed;
  assert.equal(peak, 5);
  assert.equal(h.steps.filter(row => row.name.startsWith('fetch-news-news-')).length, 7);
  const calls = h.calls.length;
  assert.equal((await h.run()).status, 'complete');
  assert.equal(h.calls.length, calls);
  assert.equal(attempts, 2);
});

for (const reportDate of ['2026-09-25', '2026-08-23']) {
  test(`${reportDate}非交易日直接跳过，不创建Workflow或step`, async () => {
    const h = harness();
    assert.equal((await runMarketBriefing(h.env, h.step, { reportDate }, 'test')).status, 'skipped');
    assert.equal(await startMarketBriefing({}, Date.parse(`${reportDate}T09:00:00Z`)), undefined);
    assert.equal(h.steps.length, 0);
    assert.equal(h.calls.length, 0);
  });
}

test('邮件失败保留报告，跨日恢复仅重做邮件，不重新采集、生成或保存', async t => {
  clock(t);
  const h = harness(), statuses = [];
  h.dependencies.sendMarketBriefingResult = async (_env, result) => { statuses.push(result.status); throw new Error('mail failed'); };
  await assert.rejects(h.run(), /mail failed/);
  assert.equal(h.objects.size, 1);
  assert.deepEqual(statuses, ['success']);
  const calls = h.calls.length, steps = h.steps.length;
  t.mock.timers.setTime(new Date('2026-08-26T09:00:00Z').valueOf());
  h.dependencies.sendMarketBriefingResult = async () => ({ messageId: '2', status: 'accepted' });
  assert.equal((await h.run()).status, 'complete');
  assert.equal(h.calls.length, calls);
  assert.deepEqual(h.steps.slice(steps).map(row => row.name), ['notify-success']);
});

test('跨日的未完成实时采集失败，不保存错日行情', async t => {
  clock(t);
  const h = harness();
  t.mock.timers.setTime(new Date('2026-08-26T09:00:00Z').valueOf());
  await assert.rejects(h.run(), /采集已跨日/);
  assert.equal(h.calls.length, 0);
  assert.equal(h.objects.size, 0);
});

test('重复Cron使用上海日确定性ID且只确认真实存在的实例', async () => {
  let id;
  const instance = { status: async () => ({ status: 'running' }) };
  const env = { MARKET_BRIEFING: { create: async options => { id = options.id; throw new Error('exists'); }, get: async () => instance } };
  assert.equal(await startMarketBriefing(env, Date.parse('2026-08-25T09:00:00Z')), instance);
  assert.equal(id, 'market-briefing-2026-08-25');
  instance.status = async () => { throw new Error('not found'); };
  await assert.rejects(startMarketBriefing(env, Date.parse('2026-08-25T09:00:00Z')), /exists/);
});

test('Resend带幂等键、固定结果收件人；provider错误可交给step重试', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ id: 'mail-id' }));
  const env = { MARKET_BRIEFING_RESEND_API_KEY: 'test', FROM_EMAIL: 'no-reply@example.test', MARKET_BRIEFING_RECIPIENTS: 'test@example.test' };
  const result = { reportDate: date, instanceId: 'workflow-id', status: 'success', detail: '已归档' };
  assert.deepEqual(await sendMarketBriefingResult(env, result), { messageId: 'mail-id', status: 'accepted' });
  const [, init] = globalThis.fetch.mock.calls[0].arguments;
  assert.equal(new Headers(init.headers).get('Idempotency-Key'), 'market-briefing/workflow-id/success');
  assert.deepEqual(JSON.parse(init.body).to, ['test@example.test']);
  globalThis.fetch.mock.mockImplementation(async () => Response.json({ name: 'validation_error', message: 'bad' }, { status: 422 }));
  await assert.rejects(sendMarketBriefingResult(env, result), /邮件发送失败/);
});

test('工作日行情滞后不能被误判休市跳过', async t => {
  clock(t);
  const h = harness(async url => url.includes('/industry?')
    ? Response.json({ ...await directResponse(url).json(), tradingDates: ['2026-08-24'] }) : undefined);
  await assert.rejects(h.run(), /行情尚未更新/);
  assert.equal(h.objects.size, 0);
});
