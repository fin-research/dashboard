import assert from "node:assert/strict";
import test from "node:test";

import {
  currentReportDate,
  shouldWarnUnfinalizedReport,
} from "../src/report-date.ts";

test("报告默认日期按上海时区取页面打开时的当天", () => {
  assert.equal(
    currentReportDate(new Date("2026-08-17T16:30:00.000Z")),
    "2026-08-18",
  );
});

test("只有历史日期无定稿时提示 warning", () => {
  assert.equal(
    shouldWarnUnfinalizedReport("2026-08-17", null, "2026-08-18"),
    true,
  );
  assert.equal(
    shouldWarnUnfinalizedReport("2026-08-18", null, "2026-08-18"),
    false,
  );
  assert.equal(
    shouldWarnUnfinalizedReport(
      "2026-08-17",
      "2026-08-17T16:00:00+08:00",
      "2026-08-18",
    ),
    false,
  );
});

test('17:00边界及跨周末假日的默认日期', async () => {
  const { defaultReportDate } = await import('../src/lib/server/market-report-date.ts');
  const calls = [];
  const env = { DATA: { fetch: async req => {
    calls.push(req.url);
    return Response.json({ dataDate:'2026-09-15', tradingDates: ['2026-09-11','2026-09-14','2026-09-15'] });
  } } };
  assert.equal(await defaultReportDate(env, new Date('2026-09-15T16:59:59+08:00')), '2026-09-14');
  assert.equal(await defaultReportDate(env, new Date('2026-09-14T08:00:00+08:00')), '2026-09-11');
  assert.equal(await defaultReportDate(env, new Date('2026-09-15T17:00:00+08:00')), '2026-09-15');
  assert.equal(calls.length, 2);
  env.DATA.fetch = async () => Response.json({ dataDate:'2026-04-30',tradingDates:['2026-04-29','2026-04-30'] });
  assert.equal(await defaultReportDate(env, new Date('2026-05-06T09:00:00+08:00')), '2026-04-30');
  env.DATA.fetch = async () => Response.json({ dataDate:'2026-09-15',tradingDates:[] });
  await assert.rejects(defaultReportDate(env, new Date('2026-09-15T09:00:00+08:00')), /上一交易日/);
});

test('行情日历落后于上一交易日不能静默加载更早报告',async()=>{
  const { defaultReportDate }=await import('../src/lib/server/market-report-date.ts');
  const env={DATA:{fetch:async()=>Response.json({dataDate:'2026-09-11',tradingDates:['2026-09-10','2026-09-11']})}};
  await assert.rejects(defaultReportDate(env,new Date('2026-09-15T09:00:00+08:00')),error=>error.code==='TRADING_CALENDAR_UNAVAILABLE');
});
