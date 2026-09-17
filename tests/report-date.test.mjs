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

test('17:00边界及跨周末假日使用已公布日历，不请求实时行情', async () => {
  const { defaultReportDate } = await import('../src/lib/server/market-report-date.ts');
  let calls = 0;
  const env = { DATA: { fetch: async () => {
    calls++;
    throw new Error('destination_unavailable');
  } } };
  for (const [now, expected] of [
    ['2026-09-17T16:59:59+08:00', '2026-09-16'],
    ['2026-09-17T17:00:00+08:00', '2026-09-17'],
    ['2026-09-14T08:00:00+08:00', '2026-09-11'],
    ['2026-05-06T09:00:00+08:00', '2026-04-30'],
    ['2026-09-28T09:00:00+08:00', '2026-09-24'],
    ['2026-10-08T09:00:00+08:00', '2026-09-30'],
    ['2026-10-12T09:00:00+08:00', '2026-10-09'],
  ]) {
    assert.equal(await defaultReportDate(env, new Date(now)), expected);
  }
  assert.equal(calls, 0);
});

test('行情日历滞后也按交易所日历选择准确上一交易日',async()=>{
  const { defaultReportDate }=await import('../src/lib/server/market-report-date.ts');
  const env={DATA:{fetch:async()=>Response.json({dataDate:'2026-09-11',tradingDates:['2026-09-10','2026-09-11']})}};
  assert.equal(await defaultReportDate(env,new Date('2026-09-15T09:00:00+08:00')), '2026-09-14');
  assert.equal(await defaultReportDate(undefined,new Date('2026-09-17T09:00:00+08:00')), '2026-09-16');
});

test('未覆盖年度及跨年边界仍须取得交易日证据，不猜测节假日', async () => {
  const { defaultReportDate } = await import('../src/lib/server/market-report-date.ts');
  const calls = [];
  const env = { DATA: { fetch: async request => {
    calls.push(request.url);
    return Response.json({ dataDate: '2027-01-05', tradingDates: ['2027-01-05', '2027-01-04'] });
  } } };
  assert.equal(await defaultReportDate(env, new Date('2027-01-05T09:00:00+08:00')), '2027-01-04');
  assert.equal(calls[0], 'https://data.internal/data/industry?date=2027-01-05&fields=dataDate,tradingDates');
  for (const now of ['2026-01-05T09:00:00+08:00', '2027-01-05T09:00:00+08:00']) {
    await assert.rejects(defaultReportDate(undefined, new Date(now)), error =>
      error.status === 503 && error.code === 'TRADING_CALENDAR_UNAVAILABLE');
  }
  env.DATA.fetch = async () => Response.json({ dataDate: '2027-01-05', tradingDates: [] });
  await assert.rejects(defaultReportDate(env, new Date('2027-01-05T09:00:00+08:00')), /上一交易日/);
});
