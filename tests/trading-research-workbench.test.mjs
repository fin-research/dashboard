import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  computeTradingSummary,
  demoTrades,
  normalizeWorkbenchView,
  workbenchViewPath,
  workbenchViews,
} from "../src/lib/trading-research/demo-data.ts";

test("交易研究工作台提供七个 path 标签页并保留稳定深链", () => {
  assert.deepEqual(
    workbenchViews.map((view) => view.label),
    [
      "总览",
      "交易管理",
      "授信管理",
      "研究辅助",
      "流程中心",
      "二级池周报",
      "融资择时模型",
    ],
  );
  assert.equal(normalizeWorkbenchView("credit"), "credit");
  assert.equal(normalizeWorkbenchView("financing-model"), "financing-model");
  assert.equal(normalizeWorkbenchView("timing"), "overview");
  assert.equal(normalizeWorkbenchView(null), "overview");
  assert.equal(workbenchViewPath("overview"), "/trading-research");
  assert.equal(workbenchViewPath("bond"), "/trading-research/bond");
  assert.equal(
    workbenchViewPath("financing-model"),
    "/trading-research/financing-model",
  );
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

test("工作台使用抽屉 path 导航、复用页面组件且不展示实现边界文案", async () => {
  const [page, route, styles, document] = await Promise.all([
    readFile(
      new URL("../src/lib/trading-research/WorkbenchPage.svelte", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/routes/trading-research/[view]/+page.ts", import.meta.url),
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
  assert.match(page, /href=\{workbenchViewPath\(view\.id\)\}/);
  assert.match(page, /<BondLedgerPage embedded \/>/);
  assert.match(page, /<FinancingModelPage embedded \/>/);
  assert.doesNotMatch(page, /\?view=|tr-context-strip|演示数据|静态演示|未来统一/);
  assert.match(route, /workbenchViews\.find/);
  assert.match(styles, /\.tr-table-scroll\s*\{[\s\S]*?overflow-x:\s*auto/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(document, /浏览器不得直连数据库/);
  assert.match(document, /\/data\/trading-research\/trades/);
});

test("工作台数据图表统一通过 ChartHost 和 ECharts renderer", async () => {
  const [overview, trading, credit, research, charts, styles] = await Promise.all([
    readFile(new URL("../src/lib/trading-research/OverviewView.svelte", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/trading-research/TradingView.svelte", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/trading-research/CreditView.svelte", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/trading-research/ResearchView.svelte", import.meta.url), "utf8"),
    readFile(new URL("../src/charts/trading-research.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/trading-research/workbench.css", import.meta.url), "utf8"),
  ]);

  for (const view of [overview, trading, credit, research]) {
    assert.match(view, /<ChartHost/);
  }
  assert.match(charts, /renderWorkbenchBarChart/);
  assert.match(charts, /renderWorkbenchHistoryChart/);
  assert.match(charts, /renderWorkbenchCurveChart/);
  assert.match(charts, /markLine/);
  assert.doesNotMatch(styles, /\.tr-(progress|distribution-bar|usage-fill|curve-list)\b/);
});
