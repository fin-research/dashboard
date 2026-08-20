import assert from "node:assert/strict";
import test from "node:test";

import {
  readCachedReport,
  writeCachedReport,
} from "../src/report-cache.ts";

class MemoryStorage {
  #values = new Map();

  get length() {
    return this.#values.size;
  }

  getItem(key) {
    return this.#values.get(key) ?? null;
  }

  key(index) {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key) {
    this.#values.delete(key);
  }

  setItem(key, value) {
    this.#values.set(key, value);
  }
}

function report(reportDate) {
  return {
    report_date: reportDate,
    generated_at: `${reportDate}T15:00:00+08:00`,
    omo: [],
    rates: { dr: [], dibo: [], bonds: [], futures: [] },
    stock_paragraphs: [],
    margin: [],
    equities: [],
    equity_data_time: null,
    turnover_yi: null,
    turnover_change_yi: null,
    industries: [],
    industry_data_date: reportDate,
    primary_summary: { current_amount: 0, change_amount: null },
    primary: [],
    secondary: [],
    inventory: [],
  };
}

test("报告按日期写入前端缓存并可直接读取", () => {
  const storage = new MemoryStorage();
  const cached = report("2026-08-20");

  writeCachedReport(storage, cached);

  assert.deepEqual(readCachedReport(storage, "2026-08-20"), cached);
  assert.equal(readCachedReport(storage, "2026-08-19"), null);
});

test("报告缓存只保留最近两个日期", () => {
  const storage = new MemoryStorage();
  writeCachedReport(storage, report("2026-08-18"));
  writeCachedReport(storage, report("2026-08-19"));
  writeCachedReport(storage, report("2026-08-20"));

  assert.equal(readCachedReport(storage, "2026-08-18"), null);
  assert.deepEqual(
    readCachedReport(storage, "2026-08-19"),
    report("2026-08-19"),
  );
  assert.deepEqual(
    readCachedReport(storage, "2026-08-20"),
    report("2026-08-20"),
  );
});

test("损坏的报告缓存被清除并按未命中处理", () => {
  const storage = new MemoryStorage();
  storage.setItem("dm-market-report:data:v1:2026-08-20", "{bad-json");

  assert.equal(readCachedReport(storage, "2026-08-20"), null);
  assert.equal(storage.length, 0);
});
