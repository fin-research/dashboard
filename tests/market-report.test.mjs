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

function directDataResponse(target) {
  const url = new URL(target, "https://example.test");
  if (url.pathname === "/data/industry") {
    return Response.json({
      dataDate: "2026-08-25",
      industries: [],
      equities: [],
      turnoverYi: null,
      turnoverChangeYi: null,
      tradingDates: ["2026-08-22", "2026-08-25"],
    });
  }
  if (url.pathname === "/data/stock-summary") {
    return Response.json({
      title: "A股收评",
      time: "2026-08-25T15:00:00+08:00",
      paragraphs: ["第一段", "第二段"],
    });
  }
  if (url.pathname === "/data/omo") return Response.json([]);
  if (url.pathname === "/data/cfets") {
    return Response.json([]);
  }
  if (url.pathname === "/data/bond-top-case") {
    return Response.json([]);
  }
  if (url.pathname === "/data/futures-latest") {
    return Response.json([]);
  }
  if (url.pathname === "/data/margin") {
    return Response.json([
        {
          DIM_DATE: "2026-08-22",
          TOTAL_RZRQYE: 2e12,
          TOTAL_RZYE: 1.99e12,
          TOTAL_RQYE: 1e10,
        },
        {
          DIM_DATE: "2026-08-21",
          TOTAL_RZRQYE: 1.999e12,
          TOTAL_RZYE: 1.9891e12,
          TOTAL_RQYE: 9.9e9,
        },
    ]);
  }
  if (url.pathname === "/data/primary-issues") {
    assert.equal(url.searchParams.get("startDate"), "2026-08-22");
    return Response.json([]);
  }
  if (url.pathname === "/data/today-trades") return Response.json([]);
  if (url.pathname === "/data/favorite-quotes") return Response.json([]);
  throw new Error(`unexpected request: ${target}`);
}

test("浏览器直读原始 Data REST 并加工，不走聚合或 GraphQL", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (target) => {
    calls.push(String(target));
    return directDataResponse(String(target));
  };

  const result = await fetchReport(
    "2026-08-25",
    false,
    undefined,
    "2026-08-25",
  );
  assert.equal(result.report_date, "2026-08-25");
  assert.equal(result.margin.total, 20000);
  assert.deepEqual(result.stock_paragraphs, ["第一段", "第二段"]);
  assert.equal(result.focus_text, "");
  assert.equal(calls.filter((target) => target.includes("/data/market-report/")).length, 0);
  assert.equal(calls.filter((target) => target.includes("/api/market-report")).length, 0);
  assert.ok(calls.some((target) => target.includes("/data/industry?")));
  assert.ok(calls.some((target) => target.includes("/data/primary-issues?")));
  assert.ok(calls.every((target) => !target.includes("/data/graphql")));
});

test("人工定稿才写入裁剪后的 R2 快照", async () => {
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
