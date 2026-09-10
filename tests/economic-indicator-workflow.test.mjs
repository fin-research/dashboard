import test from 'node:test';
import assert from 'node:assert/strict';
import { economicIndicatorRequests, runEconomicIndicatorSync } from '../worker/economic-indicator-run.ts';
import { requestEconomicIndicatorData } from '../src/lib/server/economic-indicator-request.ts';

const scheduledTime = Date.parse('2026-09-09T16:00:15Z');
function harness(t) {
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'log', () => {});
  const attempts = new Map(), delays = [], history = [], saved = [], requests = [];
  const step = { async do(name, config, operation) {
    for (let attempt = 1; ; attempt++) {
      attempts.set(name, attempt);
      try {
        const result = await operation({ attempt });
        history.push({ name, result: structuredClone(result) });
        return result;
      } catch (error) {
        history.push({ name, attempt, error: error.message });
        if (attempt > config.retries.limit) throw error;
        assert.equal(config.retries.delay, '1 minute');
        assert.equal(config.retries.backoff, 'exponential');
        delays.push({ name, delay: 60_000 * 2 ** (attempt - 1) });
      }
    }
  }};
  const request = async (path, params) => {
    requests.push({ path, params: new URLSearchParams(params) });
    if (path === '/choice/edb') return {
      function: 'EDB', fields: ['code', 'date', 'RESULT', 'PUBLISHDATE'],
      rows: params.get('edbIds').split(',').map(code => ({
        code, date: '2026-09-08', RESULT: 1.5,
        ...(code === 'EMM00590832' ? {} : { PUBLISHDATE: '20260909' }),
      })),
    };
    return { hasNextPage: true, rows: [{ bondCode: params.get('bondCode'), capitalTime: Date.parse('2026-09-09T08:00:00Z'), weightedYield: 1.42 }] };
  };
  const persist = async rows => { saved.push(...rows); return { rowCount: rows.length, asOf: '2026-09-09' }; };
  return { step, request, persist, attempts, delays, history, saved, requests };
}

test('one DM interface exhausts 2 retries while all other requests persist once', async t => {
  const h = harness(t);
  let failedCalls = 0;
  const result = await runEconomicIndicatorSync(h.step, 'isolation', scheduledTime, async (path, params) => {
    if (params.get('bondCode') === 'DR001') { failedCalls++; throw new Error('DM HTTP 503: maintenance code=E503'); }
    return h.request(path, params);
  }, h.persist);
  assert.equal(failedCalls, 3);
  assert.equal(result.status, 'partial');
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].request.parameters.bondCode, 'DR001');
  assert.match(result.failures[0].error.message, /maintenance code=E503/);
  assert.deepEqual(h.delays.map(x => x.delay), [60_000, 120_000]);
  assert.equal(h.requests.length, economicIndicatorRequests(scheduledTime).length - 1);
  assert.equal(result.storedRows, 53);
  assert.ok(h.saved.some(x => x.code === 'E1300004'));
  assert.ok(h.saved.some(x => x.code === 'E1704420'));
  assert.ok(!h.saved.some(x => x.code === 'E1300003'));
  assert.equal(h.saved.find(x => x.code === 'EMM00590832').date, '2026-09-09');
  assert.equal(h.history.at(-1).result.status, 'partial');
  assert.equal(h.history.filter(x => x.error).length, 3);
});

test('a stalled Choice request does not delay DM writes, and all requests launch in parallel', async t => {
  const h = harness(t);
  const hold = Promise.withResolvers();
  const dmSaved = Promise.withResolvers();
  let calls = 0;
  const run = runEconomicIndicatorSync(h.step, 'parallel', scheduledTime, async (path, params) => {
    calls++;
    if (path === '/choice/edb') await hold.promise;
    return h.request(path, params);
  }, async rows => {
    const value = await h.persist(rows);
    if (rows.some(x => x.code === 'E1300004')) dmSaved.resolve();
    return value;
  });
  await dmSaved.promise;
  assert.equal(calls, economicIndicatorRequests(scheduledTime).length);
  assert.ok(h.saved.every(x => ['E1300003', 'E1300004', 'E1704420'].includes(x.code)));
  hold.resolve();
  assert.equal((await run).status, 'complete');
});

test('only a failing Choice batch retries; recovered attempts retain their error history', async t => {
  const h = harness(t);
  const first = economicIndicatorRequests(scheduledTime)[0];
  let calls = 0;
  const result = await runEconomicIndicatorSync(h.step, 'recover', scheduledTime, async (path, params) => {
    if (params.get('edbIds') === first.parameters.edbIds && ++calls < 3) throw new Error('Choice RPC code=10000009 no data');
    return h.request(path, params);
  }, h.persist);
  assert.equal(result.status, 'complete');
  assert.equal(result.storedRows, 54);
  assert.equal(calls, 3);
  assert.equal(h.requests.length, economicIndicatorRequests(scheduledTime).length);
  assert.equal(h.history.filter(x => x.error?.includes('10000009')).length, 2);
});

test('persist failures do not refetch paid data or prevent other transactions', async t => {
  const h = harness(t);
  let persistCalls = 0;
  const result = await runEconomicIndicatorSync(h.step, 'persist-failure', scheduledTime, h.request, async rows => {
    if (rows.some(x => x.code === 'E1300003')) { persistCalls++; throw new Error('Neon SQLSTATE 57014 statement timeout'); }
    return h.persist(rows);
  });
  assert.equal(persistCalls, 3);
  assert.equal(h.requests.length, economicIndicatorRequests(scheduledTime).length);
  assert.equal(result.status, 'partial');
  assert.equal(result.storedRows, 53);
  assert.match(result.failures[0].step, /^persist dm-DR001/);
  assert.match(result.failures[0].error.message, /57014/);
});

test('all failed interfaces retain a durable failed summary and never write', async t => {
  const h = harness(t);
  const result = await runEconomicIndicatorSync(h.step, 'all-failed', scheduledTime, async () => { throw new Error('network failure'); }, h.persist);
  assert.equal(result.status, 'failed');
  assert.equal(result.storedRows, 0);
  assert.equal(result.failures.length, economicIndicatorRequests(scheduledTime).length);
  assert.equal(h.saved.length, 0);
  assert.equal(h.history.at(-1).result.status, 'failed');
});

test('Data error response, safe parameters and nested upstream diagnostics survive Workflow serialization', async () => {
  const payload = { detail: 'DM failed', error: { upstreamStatus: 502, upstreamResponse: { body: '{"code":"MAINTENANCE","message":"try later"}' } } };
  const data = { fetch: async () => Response.json(payload, { status: 503, headers: { 'CF-Ray': 'ray-example' } }) };
  await assert.rejects(() => requestEconomicIndicatorData(data, '/cfets-histories', new URLSearchParams({ bondCode: 'DR001' })), error => {
    const details = JSON.parse(error.message);
    assert.equal(details.status, 503);
    assert.equal(details.parameters.bondCode, 'DR001');
    assert.equal(details.requestId, 'ray-example');
    assert.deepEqual(JSON.parse(details.responseBody), payload);
    return true;
  });
});

test('oversized and non-JSON Data failures are bounded, cancelled, and redacted', async () => {
  let cancelled = false;
  const data = { fetch: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('password=private-value ' + 'x'.repeat(30_000))); },
    cancel() { cancelled = true; },
  }), { status: 503 }) };
  await assert.rejects(() => requestEconomicIndicatorData(data, '/choice/edb', new URLSearchParams({ edbIds: 'E1000172' })), error => {
    const details = JSON.parse(error.message);
    assert.equal(details.responseTruncated, true);
    assert.ok(details.responseBody.length <= 24_000);
    assert.ok(!details.responseBody.includes('private-value'));
    return true;
  });
  assert.equal(cancelled, true);
});
