import assert from 'node:assert/strict';
import test from 'node:test';
import { collectMarketReport } from '../worker/market-report-collector.ts';
import { runMarketBriefing, startMarketBriefing } from '../worker/market-briefing-runner.ts';
import { sendMarketBriefingResult } from '../src/lib/server/market-briefing-email.ts';
import { reportDataSchema } from '../src/market-report.ts';
import { directResponse, snapshot } from './fixtures/market-resources.mjs';

const date = '2026-08-25';
function clock(t) { t.mock.timers.enable({ apis: ['Date'], now: new Date(`${date}T17:00:00+08:00`) }); }
function harness(override) {
  const calls = [], steps = [], objects = new Map();
  const env = { DATA: { fetch: async req => { calls.push(req.url); return override?.(req.url) ?? directResponse(req.url); } },
    EASTMONEY: { put: async (key, body) => { objects.set(key, JSON.parse(body)); return {etag:'saved'}; } } };
  const step = { do: async (name, config, fn) => { steps.push({name,config}); return fn(); } };
  return { env, step, calls, steps, objects };
}
async function industry() { return directResponse('https://example.test/data/industry').json(); }

test('服务端并发采集最小DTO，动态批量债券信息并保留缺失值及业务换算', async t => {
  clock(t);
  const h = harness();
  const result = await collectMarketReport(h.env, h.step, date, await industry());
  assert.equal(h.calls.length, 11); // industry is already checkpointed by trading-day
  assert.equal(h.calls.filter(url => url.includes('/bond-infos?')).length, 1);
  assert.ok(h.calls.every(url => url.includes('fields=')));
  assert.ok(h.steps.every(({config}) => config.retries.limit === 3));
  assert.equal(result.omo_operations[0].amount_yi, 1000);
  assert.equal(result.omo_operations[0].interest_rate, null);
  assert.equal(result.futures[0].last_price, null);
  assert.equal(result.primary_summary.current_amount, 0);
  assert.equal(result.secondary_bonds[0].issuer, '测试公司');
  assert.equal(result.inventory_bonds[0].bid_yield, 2.01);
});
test('个别国债收益率缺失保留其他行情且不归零', async t => {
  clock(t);
  const h = harness(url => url.includes('/bond-top-case?') ? Response.json([
    { ordinateName:'国债',abscissaName:'10Y',bondCode:'260011.IB',tradeNum:20,yield:1.8,yieldSubYtdCloseBp:-1 },
    { ordinateName:'国债',abscissaName:'5Y',bondCode:'260010.IB',tradeNum:1,yield:null,yieldSubYtdCloseBp:null },
  ]) : undefined);
  const report = await collectMarketReport(h.env,h.step,date,await industry());
  assert.deepEqual(report.government_bonds.map(row => row.yield_rate),[null,1.8]);
});
for (const source of ['stock-summary', 'industry', 'bond-infos']) {
  test(`${source}错误经step重试后失败并通知，不写残缺R2`, async t => {
    clock(t);
    const h = harness(url => url.includes(`/data/${source}?`) ? Response.json({detail:'源不可用'},{status:503}) : undefined);
    const notifications=[];
    await assert.rejects(runMarketBriefing(h.env,h.step,{reportDate:date},'test',{
      collectMarketReport, generateMarketBriefing: async () => ({stock:'股',bond:'债'}),
      saveMarketReport: async () => { throw new Error('must not save'); },
      sendMarketBriefingResult: async (_env,result) => {notifications.push(result);return {messageId:'1',status:'accepted'};},
    }));
    assert.equal(notifications[0].status,'failed');
    assert.equal(h.objects.size,0);
  });
}
test('完整Workflow并行启动数据与AI，成功先存R2后发邮件', async t => {
  clock(t);
  const h=harness(); const events=[];
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const result=await runMarketBriefing(h.env,h.step,{reportDate:date},'test',{
    collectMarketReport:async()=>{events.push('data-start');await gate;return reportDataSchema.strip().parse(snapshot());},
    generateMarketBriefing:async()=>{events.push('ai-start');release();return {stock:'股市判断',bond:'债市判断'};},
    saveMarketReport:async(_bucket,_date,report,focus)=>{events.push('r2');assert.equal(focus,'1、股市判断\n2、债市判断');return {...report,focus_text:focus,finalized_at:'saved'};},
    sendMarketBriefingResult:async()=>{events.push('mail');return {messageId:'1',status:'accepted'};},
  });
  assert.deepEqual(events,['data-start','ai-start','r2','mail']);
  assert.equal(result.status,'complete');
  assert.equal(h.steps.find(row=>row.name==='generate-focus').config.retries.limit,2);
});
test('非交易日跳过且不调用AI、R2或邮件；空日历失败关闭', async t => {
  t.mock.timers.enable({ apis:['Date'],now:new Date('2026-09-25T17:00:00+08:00') });
  const previous={...await industry(),tradingDates:['2026-08-22']};
  const h=harness(()=>Response.json(previous));
  assert.equal((await runMarketBriefing(h.env,h.step,{reportDate:'2026-09-25'},'test')).status,'skipped');
  assert.equal(h.steps.length,1);
});
test('邮件失败保留已归档报告，不再次发送生成失败邮件', async t=>{
  clock(t);const h=harness();let stored=false;const statuses=[];
  await assert.rejects(runMarketBriefing(h.env,h.step,{reportDate:date},'test',{
    collectMarketReport:async()=>reportDataSchema.strip().parse(snapshot()),generateMarketBriefing:async()=>({stock:'股',bond:'债'}),
    saveMarketReport:async()=>{stored=true;return {focus_text:'聚焦',finalized_at:'saved'};},
    sendMarketBriefingResult:async(_env,result)=>{statuses.push(result.status);throw new Error('mail failed');},
  }),/mail failed/);
  assert.equal(stored,true);assert.deepEqual(statuses,['success']);
});
test('重复Cron使用上海日确定性ID且只确认真实存在的实例', async()=>{
  let id;const instance={status:async()=>({status:'running'})};
  const env={MARKET_BRIEFING:{create:async options=>{id=options.id;throw new Error('exists');},get:async()=>instance}};
  assert.equal(await startMarketBriefing(env,Date.parse('2026-08-25T09:00:00Z')),instance);
  assert.equal(id,'market-briefing-2026-08-25');
  instance.status=async()=>{throw new Error('not found');};
  await assert.rejects(startMarketBriefing(env,Date.parse('2026-08-25T09:00:00Z')),/exists/);
});
test('Resend带幂等键、固定结果收件人；provider错误可重试',async t=>{
  t.mock.method(globalThis,'fetch',async()=>Response.json({id:'mail-id'}));
  const env={MARKET_BRIEFING_RESEND_API_KEY:'test',FROM_EMAIL:'no-reply@example.test',MARKET_BRIEFING_RECIPIENTS:'test@example.test'};
  const result={reportDate:date,instanceId:'workflow-id',status:'success',detail:'已归档'};
  assert.deepEqual(await sendMarketBriefingResult(env,result),{messageId:'mail-id',status:'accepted'});
  const [,init]=globalThis.fetch.mock.calls[0].arguments;
  assert.equal(new Headers(init.headers).get('Idempotency-Key'),'market-briefing/workflow-id/success');
  assert.deepEqual(JSON.parse(init.body).to,['test@example.test']);
  globalThis.fetch.mock.mockImplementation(async()=>Response.json({name:'validation_error',message:'bad'},{status:422}));
  await assert.rejects(sendMarketBriefingResult(env,result),/邮件发送失败/);
});

test('工作日行情滞后不能被误判休市跳过', async t => {
  clock(t); const h=harness(async()=>Response.json({...await industry(),tradingDates:['2026-08-24']}));
  await assert.rejects(runMarketBriefing(h.env,h.step,{reportDate:date},'test',{
    collectMarketReport, generateMarketBriefing:async()=>{throw new Error('must not generate');},
    saveMarketReport:async()=>{throw new Error('must not save');},sendMarketBriefingResult:async()=>({messageId:'1'}),
  }),/行情尚未更新/);
});
