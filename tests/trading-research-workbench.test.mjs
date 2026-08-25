import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  computeTradingSummary,
  demoTrades,
  normalizeWorkbenchView,
  workbenchViews,
} from "../src/lib/trading-research/demo-data.ts";

test("交易研究工作台只保留五个迁入视图并支持稳定深链", () => {
  assert.deepEqual(
    workbenchViews.map((view) => view.label),
    ["总览", "交易管理", "授信管理", "研究辅助", "流程中心"],
  );
  assert.equal(normalizeWorkbenchView("credit"), "credit");
  assert.equal(normalizeWorkbenchView("timing"), "overview");
  assert.equal(normalizeWorkbenchView(null), "overview");
});

test("演示交易汇总严格由迁入的十笔交易派生", () => {
  const summary = computeTradingSummary(demoTrades);
  assert.equal(summary.tradeCount, 10);
  assert.equal(summary.totalAmount, 45);
  assert.equal(summary.interbankAmount, 27.5);
  assert.equal(summary.repoLendAmount, 17.5);
  assert.equal(summary.pendingCount, 2);
  assert.equal(Number(summary.weightedRate.toFixed(4)), 1.8358);
});

test("工作台使用抽屉导航、静态数据边界和本地表格溢出", async () => {
  const [page, styles, document] = await Promise.all([
    readFile(
      new URL("../src/routes/trading-research/+page.svelte", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/lib/trading-research/workbench.css", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../docs/TRADING_RESEARCH_WORKBENCH.md", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(page, /class="tr-drawer"/);
  assert.match(page, /aria-controls="tr-workbench-drawer"/);
  assert.match(page, /未来统一由数据库与同源 \/data API 提供/);
  assert.match(styles, /\.tr-table-scroll\s*\{[\s\S]*?overflow-x:\s*auto/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(document, /浏览器不得直连数据库/);
  assert.match(document, /\/data\/trading-research\/trades/);
});
