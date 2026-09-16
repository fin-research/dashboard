import assert from "node:assert/strict";
import test from "node:test";

import { fetchReport } from "../src/api.ts";
import {
  readMarketReport,
  saveMarketReport,
} from "../src/lib/server/market-report.ts";

function reportData() {
  return {
    report_date: "2026-08-25",
    generated_at: "2026-08-25T15:00:00+08:00",
    omo_operations: [],
    funding_rates: [],
    government_bonds: [],
    futures: [],
    stock_paragraphs: ["第一段", "第二段"],
    margin: {
      data_date: "2026-08-22",
      total: 20000,
      total_change: 10,
      financing: 19900,
      financing_change: 9,
      securities_lending: 100,
      securities_lending_change: 1,
    },
    equities: [],
    equity_data_time: null,
    turnover_yi: null,
    turnover_change_yi: null,
    industries: [],
    industry_data_date: "2026-08-25",
    primary_summary: { current_amount: 0, change_amount: 0 },
    primary_issues: [],
    secondary_bonds: [],
    inventory_bonds: [],
  };
}

function memoryBucket() {
  const objects = new Map();
  return {
    objects,
    async get(key) {
      const text = objects.get(key);
      return text === undefined
        ? null
        : { async json() { return JSON.parse(text); } };
    },
    async put(key, value, options) {
      objects.set(key, String(value));
      return { key, etag: "etag", options };
    },
  };
}

test("浏览器从归档读取完整报告且不请求原始行情", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json({
    ...reportData(), focus_text: "归档聚焦", cached_at: "2026-08-25T09:00:00Z", finalized_at: "2026-08-25T09:00:00Z",
  }));
  const { report } = await fetchReport("2026-08-25", false);
  assert.equal(report.focus_text, "归档聚焦");
  assert.equal(globalThis.fetch.mock.calls.length, 1);
  assert.equal(globalThis.fetch.mock.calls[0].arguments[0], "/api/market-report?date=2026-08-25");
});

test("定稿写入裁剪后的 R2 快照", async () => {
  const bucket = memoryBucket();
  const saved = await saveMarketReport(
    bucket,
    "2026-08-25",
    reportData(),
    "定稿判断",
  );
  assert.equal(saved.focus_text, "定稿判断");
  assert.ok(saved.finalized_at);

  const raw = JSON.parse(bucket.objects.get("market-briefing/2026-08-25.json"));
  assert.equal(raw.focus_text, "定稿判断");
  assert.equal("text_report" in raw, false);
  assert.equal("todayTrades" in raw, false);
  assert.equal("favoriteQuotes" in raw, false);
  assert.equal("bondInfos" in raw, false);

  const stored = await readMarketReport(bucket, "2026-08-25");
  assert.deepEqual(stored, saved);
});

test("读取不存在或损坏的历史定稿时返回明确错误", async () => {
  const bucket = memoryBucket();
  await assert.rejects(
    readMarketReport(bucket, "2026-08-25"),
    (error) => error.status === 404 && error.code === "REPORT_NOT_FINALIZED",
  );

  bucket.objects.set("market-briefing/2026-08-25.json", "{bad-json");
  await assert.rejects(
    readMarketReport(bucket, "2026-08-25"),
    (error) => error.status === 503 && error.code === "FINALIZED_SNAPSHOT_INVALID",
  );
});

test("过大的定稿快照在写入 R2 前被拒绝", async () => {
  const bucket = memoryBucket();
  await assert.rejects(
    saveMarketReport(
      bucket,
      "2026-08-25",
      reportData(),
      "超长内容".repeat(150_000),
    ),
    (error) => error.status === 400 && /数据过大/.test(error.message),
  );
  assert.equal(bucket.objects.size, 0);
});

test("合并导出保存仍只上传原 JSON 定稿数据与今日聚焦", async () => {
  const { saveMarketReport: saveFromBrowser } = await import('../src/api.ts');
  const original = globalThis.fetch;
  const report = reportData();
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/market-report?date=2026-08-25');
    assert.equal(init.method, 'PUT');
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(init.body), { report, focusText: '股债正文' });
    return Response.json({ ...report, focus_text: '股债正文', cached_at: '2026-08-25T15:00:00Z', finalized_at: '2026-08-25T15:00:00Z' });
  };
  try { await saveFromBrowser(report, '股债正文'); }
  finally { globalThis.fetch = original; }
});

test('R2未定稿对象返回404而非成功快照',async()=>{
  const bucket=memoryBucket();
  bucket.objects.set('market-briefing/2026-08-25.json',JSON.stringify({...reportData(),focus_text:'',cached_at:'2026-08-25T09:00:00Z',finalized_at:null}));
  await assert.rejects(readMarketReport(bucket,'2026-08-25'),error=>error.status===404&&error.code==='REPORT_NOT_FINALIZED');
});
