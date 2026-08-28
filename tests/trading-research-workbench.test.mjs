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

test("二级池成交明细表统一使用 1rem 字号", async () => {
  const styles = await readFile(
    new URL("../src/bond-ledger.css", import.meta.url),
    "utf8",
  );

  assert.match(
    styles,
    /\.ledger-table--transactions :is\(th, td\)\s*\{[\s\S]*?font-size:\s*1rem/,
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
  assert.match(page, /class="tr-sidebar-toggle"[\s\S]*?<WorkbenchIcon name="sidebar"/);
  assert.match(page, /class="tr-portal-link" href="\/"[\s\S]*?东方财富证券 · 资金管理部/);
  assert.match(page, /class="tr-breadcrumb"[\s\S]*?交易研究工作台[\s\S]*?activeView\?\.label/);
  assert.doesNotMatch(page, /tr-brand|tr-back-link|tr-drawer__collapse/);
  assert.match(page, /href=\{workbenchViewPath\(view\.id\)\}/);
  assert.match(page, /<BondLedgerPage embedded \/>/);
  assert.match(page, /<FinancingModelPage embedded \/>/);
  assert.doesNotMatch(page, /\?view=|tr-context-strip|演示数据|静态演示|未来统一/);
  assert.match(route, /workbenchViews\.find/);
  assert.match(styles, /\.tr-table-scroll\s*\{[\s\S]*?overflow-x:\s*auto/);
  assert.match(styles, /grid-template-areas:\s*\n\s*"topbar topbar"\s*\n\s*"drawer workspace"/);
  assert.match(styles, /\.tr-workspace\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(styles, /:root:has\(\.tr-workbench\)\s*\{[\s\S]*?overflow:\s*hidden/);
  assert.match(styles, /body:has\(\.tr-workbench\)\s*\{[\s\S]*?overflow:\s*hidden/);
  assert.match(styles, /\.tr-portal-link\s*\{[\s\S]*?font-size:\s*1rem/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(document, /浏览器不得直连数据库/);
  assert.match(document, /\/data\/trading-research\/trades/);
});

test("工作台数据图表统一通过 ChartHost 和 ECharts renderer", async () => {
  const [overview, trading, credit, research, charts, common, styles, icon] = await Promise.all([
    readFile(new URL("../src/lib/trading-research/OverviewView.svelte", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/trading-research/TradingView.svelte", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/trading-research/CreditView.svelte", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/trading-research/ResearchView.svelte", import.meta.url), "utf8"),
    readFile(new URL("../src/charts/trading-research.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/charts/common.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/trading-research/workbench.css", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/trading-research/WorkbenchIcon.svelte", import.meta.url), "utf8"),
  ]);

  for (const view of [overview, trading, research]) {
    assert.match(view, /<ChartHost/);
  }
  assert.doesNotMatch(credit, /<ChartHost/);
  assert.match(credit, /tr-credit-calendar/);
  assert.match(charts, /renderWorkbenchBarChart/);
  assert.match(charts, /renderWorkbenchHistoryChart/);
  assert.match(charts, /renderWorkbenchCurveChart/);
  assert.match(charts, /markLine/);
  assert.match(common, /fontWeight:\s*"normal"/);
  assert.doesNotMatch(styles, /\.tr-workbench\s+svg\s*\{/);
  assert.match(styles, /\.tr-workbench-icon\s*\{/);
  assert.match(icon, /class=\{`tr-workbench-icon/);
  assert.doesNotMatch(styles, /\.tr-(progress|distribution-bar|usage-fill|curve-list)\b/);
});

test("市场点评、工作台与并入模块复用统一指标卡和结构组件", async () => {
  const viewUrls = [
    "../src/lib/trading-research/OverviewView.svelte",
    "../src/lib/trading-research/TradingView.svelte",
    "../src/lib/trading-research/CreditView.svelte",
    "../src/lib/trading-research/ResearchView.svelte",
    "../src/lib/trading-research/WorkflowView.svelte",
  ];
  const [metricCard, coreMetrics, metricIcon, panelHeading, workbenchPage, bond, financing, styles, design, ...views] = await Promise.all([
    readFile(new URL("../src/components/MetricCard.svelte", import.meta.url), "utf8"),
    readFile(new URL("../src/components/CoreMetrics.svelte", import.meta.url), "utf8"),
    readFile(new URL("../src/components/MetricIcon.svelte", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/trading-research/PanelHeading.svelte", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/trading-research/WorkbenchPage.svelte", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/pages/BondLedgerPage.svelte", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/pages/FinancingModelPage.svelte", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/trading-research/workbench.css", import.meta.url), "utf8"),
    readFile(new URL("../DESIGN.md", import.meta.url), "utf8"),
    ...viewUrls.map((url) => readFile(new URL(url, import.meta.url), "utf8")),
  ]);

  for (const view of views) {
    assert.match(view, /SectionHeading from "\.\/SectionHeading\.svelte"/);
    assert.match(view, /PanelHeading from "\.\/PanelHeading\.svelte"/);
    assert.match(view, /Badge from "\.\/Badge\.svelte"/);
  }
  for (const view of views.slice(0, 4)) {
    assert.match(view, /MetricCard from "\.\.\/\.\.\/components\/MetricCard\.svelte"/);
  }
  for (const integratedPage of [bond, financing]) {
    assert.match(integratedPage, /MetricCard from "\.\.\/\.\.\/components\/MetricCard\.svelte"/);
    assert.match(integratedPage, /<MetricCard/);
  }
  assert.match(metricCard, /detailPrefix/);
  assert.match(metricCard, /iconPosition/);
  assert.match(metricCard, /iconPosition = "start"/);
  assert.match(metricCard, /color:\s*var\(--metric-accent\)/);
  assert.match(metricCard, /border-radius:\s*50%/);
  assert.match(metricCard, /stroke-width:\s*2\.5/);
  assert.doesNotMatch(metricCard, /text-overflow:\s*ellipsis/);
  assert.match(coreMetrics, /MetricCard from "\.\/MetricCard\.svelte"/);
  assert.match(coreMetrics, /<MetricCard/);
  assert.doesNotMatch(coreMetrics, /core-card|card__balance/);
  assert.match(metricIcon, /class=\{`metric-icon metric-icon--\$\{icon\}`\}/);
  assert.match(panelHeading, /tr-panel-heading__controls/);
  assert.match(styles, /\.tr-panel-heading\s*\{[\s\S]*?display:\s*grid/);
  assert.match(styles, /\.tr-panel-heading--wrap \.tr-table-controls\s*\{[\s\S]*?flex-wrap:\s*nowrap/);
  assert.match(workbenchPage, /id="tr-topbar-actions"/);
  assert.match(bond, /use:portal=\{embedded \? "#tr-topbar-actions" : null\}/);
  assert.match(financing, /use:portal=\{embedded \? "#tr-topbar-actions" : null\}/);
  assert.match(bond, /globalMessages\.(success|error|info)/);
  assert.match(financing, /globalMessages\.(success|error|info)/);
  assert.doesNotMatch(bond, /class="ledger-status"/);
  assert.doesNotMatch(financing, /class="status-region"/);
  assert.doesNotMatch(styles, /\.tr-(metric-card|rate-card)\b/);
  assert.match(design, /共享组件归属与复用顺序/);
  assert.match(design, /src\/components\/MetricCard\.svelte/);
  assert.match(design, /禁止先在页面内实现/);
});

test("工作台不再展示数据覆盖与校验状态模块", async () => {
  const [overview, credit, research, workflow, demoData, styles] = await Promise.all([
    readFile(new URL("../src/lib/trading-research/OverviewView.svelte", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/trading-research/CreditView.svelte", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/trading-research/ResearchView.svelte", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/trading-research/WorkflowView.svelte", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/trading-research/demo-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/trading-research/workbench.css", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(overview, /数据覆盖|tr-coverage-grid|已校验/);
  assert.doesNotMatch(credit, /授信口径校验通过|tr-reconciliation/);
  assert.doesNotMatch(research, /研究快照校验通过|tr-evidence-strip/);
  assert.doesNotMatch(`${workflow}\n${demoData}`, /发布口径校验通过/);
  assert.doesNotMatch(styles, /tr-(coverage-grid|reconciliation|evidence-strip)/);
});
