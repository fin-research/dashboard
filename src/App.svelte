<script lang="ts">

  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import AuthMenu from '$lib/AuthMenu.svelte';
  import { onDestroy, onMount, tick } from "svelte";

  import { fetchReport } from "./api";
  import ChartHost from "./components/ChartHost.svelte";
  import CoreMetrics from "./components/CoreMetrics.svelte";
  import EquityStats from "./components/EquityStats.svelte";
  import EquityValues from "./components/EquityValues.svelte";
  import FundMetrics from "./components/FundMetrics.svelte";
  import PrimaryTable from "./components/PrimaryTable.svelte";
  import SecondaryTable from "./components/SecondaryTable.svelte";
  import SummaryStrip from "./components/SummaryStrip.svelte";
  import { plainTextToFocusHtml } from "./focus-editor";
  import TextReport from "./components/TextReport.svelte";
  import { exportReportImage } from "./export";
  import { chineseDateParts } from "./formatters";
  import { globalMessages } from "./lib/global-messages";
  import { deriveReport, type ReportDerived } from "./report-view";
  import {
    pathnameForReportView,
    reportViewFromPathname,
    type ReportView,
  } from "./report-route";
  import type {
    MarketReportResource,
    MarketReportResourceIssue,
    ReportData,
  } from "./types";
  import {
    comparableSummaryItems,
    comparableTenorRows,
    inventorySummaryItems,
    omoSummaryItems,
    primarySummaryItems,
  } from "./view-model";

  type ChartRenderers = typeof import("./charts");
  const EMPTY_DERIVED: ReportDerived = {
    omoHistory: [],
    funds: [],
    governmentBonds: [],
    margin: {
      data_date: null,
      total: null,
      total_change: null,
      financing: null,
      financing_change: null,
      securities_lending: null,
      securities_lending_change: null,
    },
    primary: [],
    comparable: [],
    inventory: [],
  };
  let reportSurface = $state<HTMLElement>(null!);
  let dateInput = $state<HTMLInputElement>(null!);
  let selectedDate = $state("");
  let data = $state<ReportData | null>(null);
  let charts = $state<ChartRenderers | null>(null);
  let loading = $state(true);
  let errorMessage = $state("");
  let exporting = $state(false);
  let exportLabel = $state("导出图片");
  let activeRequest: AbortController | null = null;
  let activeView: ReportView = $state("visual");
  let focusText = $state("");
  let resourceIssues = $state<MarketReportResourceIssue[]>([]);

  let reportDerived = $derived(data ? deriveReport(data) : EMPTY_DERIVED);
  let missingResources = $derived(resourceIssues.map((issue) => issue.resource));
  let dateParts = $derived(data
    ? chineseDateParts(data.report_date)
    : { date: "—", weekday: "—" });
  $effect(() => {
    if (data) {
      document.title = `${data.report_date} · 资金管理部 • 市场点评`;
    }
  });

  onMount(async () => {
    activeView = reportViewFromPathname(window.location.pathname);
    try {
      selectedDate = new URLSearchParams(window.location.search).get("date") ?? "";
      await loadReport(false);
    } catch (error) {
      showError(error);
    }
  });

  onDestroy(() => {
    activeRequest?.abort();

  });

  async function loadReport(refresh: boolean): Promise<void> {
    activeRequest?.abort();
    const request = new AbortController();
    activeRequest = request;
    const requestedDate = selectedDate;
    loading = true;
    data = null;
    errorMessage = "";
    resourceIssues = [];
    try {
      const [loaded, chartModule] = await Promise.all([
        fetchReport(requestedDate, refresh, request.signal),
        import("./charts"),
      ]);
      if (request.signal.aborted || selectedDate !== requestedDate) return;
      const report = loaded.report;
      data = report;
      selectedDate = report.report_date;
      resourceIssues = loaded.resourceIssues;
      focusText = report.focus_text;
      charts = chartModule;
      loading = false;
      if (resourceIssues.length) {
        globalMessages.warning(
          `部分数据暂缺：${resourceIssues.map((issue) => issue.label).join("、")}`,
          { key: "market-report-partial-data", duration: 8000 },
        );
      }
    } catch (error) {
      if (activeRequest === request && !request.signal.aborted) {
        showError(error);
      }
    }
  }

  function hasResourceIssue(...resources: MarketReportResource[]): boolean {
    return resources.some((resource) =>
      resourceIssues.some((issue) => issue.resource === resource)
    );
  }

  function openDatePicker(): void {
    try {
      dateInput.showPicker?.();
    } catch {
      // The native input click remains available where showPicker is unsupported.
    }
  }

  async function exportImage(): Promise<void> {
    if (!data || exporting) return;
    await tick();
    exporting = true;
    exportLabel = "正在导出";
    try {
      await exportReportImage(reportSurface, data.report_date, { captureClass: true });
      globalMessages.success(`${data.report_date} 图片已导出`, { key: "market-report-export" });
    } catch (error) {
      globalMessages.error(`图片导出失败：${error instanceof Error ? error.message : String(error)}`, { key: "market-report-export" });
    } finally {
      exporting = false;
      exportLabel = "导出图片";
    }
  }

  function showError(error: unknown): void {
    loading = false;
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  function selectView(view: ReportView): void {
    activeView = view;
    const pathname = pathnameForReportView(view);
    if (window.location.pathname !== pathname) {
      window.history.pushState(null, "", `${pathname}${window.location.search}`);
    }
  }

  function handlePopState(): void {
    activeView = reportViewFromPathname(window.location.pathname);
  }
</script>

<svelte:window onpopstate={handlePopState} />

<svelte:head>
  <meta name="theme-color" content="#f6f8fb" />
</svelte:head>

<div class="page-shell">
  <main bind:this={reportSurface} id="report-surface">
    <header class="report-masthead">
      <div class="report-title">
        <h1>
          <span class="report-title__department">资金管理部</span>
          <span class="report-title__dot" aria-hidden="true">•</span>
          <span class="report-title__subject">市场点评</span>
        </h1>
      </div>
      <div class="masthead-controls" aria-label="报告控制">
        <div class="titlebar-actions">
          <div class="report-view-switch view-toggle" role="group" aria-label="报告展示方式">
            <Button data-ui-owner="App-svelte" variant={activeView === "visual" ? 'default' : 'outline'} class={"ui-button report-view-switch-item"}
              id="visual-report-tab"

              type="button"
              aria-pressed={activeView === "visual"}
              disabled={exporting}
              onclick={() => selectView("visual")}
            >
              可视化
            </Button>
            <Button data-ui-owner="App-svelte" variant={activeView === "text" ? 'default' : 'outline'} class={"ui-button report-view-switch-item"}
              id="text-report-tab"

              type="button"
              aria-pressed={activeView === "text"}
              disabled={exporting}
              onclick={() => selectView("text")}
            >
              文字版
            </Button>
          </div>
          <Button data-ui-owner="App-svelte" variant="outline"

            class={["ui-button refresh-button", loading && "is-loading"]}
            type="button"
            disabled={loading || exporting}
            onclick={() => loadReport(true)}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M16.4 6.1A7 7 0 1 0 17 11" />
              <path d="M16.5 2.7v4h-4" />
            </svg>
            <span>刷新</span>
          </Button>
          <Button data-ui-owner="App-svelte" variant="default"

            class={["ui-button  export-button", exporting && "is-exporting"]}
            type="button"
            disabled={!data || loading || exporting}
            onclick={exportImage}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M10 3v9" />
              <path d="m6.5 8.7 3.5 3.6 3.5-3.6" />
              <path d="M4 14.5v2h12v-2" />
            </svg>
            <span>{exportLabel}</span>
          </Button>
        </div>
        <label class="hero-date">
          <span class="sr-only">选择报告日期</span>
          <Input data-ui-owner="App-svelte"
            bind:ref={dateInput}
            class={"ui-input hero-date__input"}
            type="date"
            aria-label="选择报告日期"
            disabled={exporting}
            bind:value={selectedDate}
            onclick={openDatePicker}
            onchange={() => loadReport(false)}
          />
          <time
            class="hero-date__display"
            datetime={data?.report_date ?? ""}
            aria-hidden="true"
          >
            <span class="hero-date__value">{dateParts.date}</span>
            <span class="hero-date__weekday">{dateParts.weekday}</span>
          </time>
        </label>
      </div>
      <div class="report-account"><AuthMenu /></div>
    </header>

    {#if loading}
      <div class="loading-state" role="status" aria-live="polite">
        <span class="loading-orbit" aria-hidden="true"></span>
        <div>
          <strong>正在加载市场点评</strong>
        </div>
      </div>
    {:else if errorMessage}
      <div class="error-state" role="alert">
        <span class="error-index">!</span>
        <div>
          <strong>报告暂时无法加载</strong>
          <p>{errorMessage}</p>
        </div>
        <Button data-ui-owner="App-svelte" variant="outline" size="sm"
          class={"ui-button "}
          type="button"
          onclick={() => loadReport(true)}>重新尝试</Button
        >
      </div>
    {:else if data && charts}
      {#if activeView === "visual"}
        <div
          id="visual-report-panel"
          class="visual-report-view"
          role="tabpanel"
          aria-labelledby="visual-report-tab"
        >
          <div class="core-metrics" aria-label="核心市场指标">
            <CoreMetrics {data} {reportDerived} {missingResources} />
          </div>
          <div class="report-content">
        <section class="dashboard-panel panel--focus" aria-labelledby="focus-title">
          <header class="panel-heading">
            <span class="panel-index">01</span>
            <h2 id="focus-title">今日聚焦</h2>
          </header>
          <div class="focus-editor" aria-label="今日聚焦">{@html plainTextToFocusHtml(focusText)}</div>
        </section>

        <section class="dashboard-panel panel--omo" aria-labelledby="omo-title">
          <header class="panel-heading">
            <span class="panel-index">02</span>
            <h2 id="omo-title">公开市场操作</h2>
          </header>
          {#if hasResourceIssue("omo")}
            <div class="module-data-missing" role="status">公开市场操作数据缺失</div>
          {:else}
            <ChartHost
              id="omo-chart"
              renderer={charts.renderOmo}
              args={[reportDerived.omoHistory]}
              ariaLabel="近十个操作日公开市场操作柱状图"
            />
            <div class="summary-strip" aria-label="公开市场操作汇总">
              <SummaryStrip
                items={omoSummaryItems(reportDerived.omoHistory, data.report_date)}
              />
            </div>
          {/if}
        </section>

        <section class="dashboard-panel panel--rates" aria-labelledby="rates-title">
          <header class="panel-heading">
            <span class="panel-index">03</span>
            <h2 id="rates-title">固收市场</h2>
          </header>
          {#if hasResourceIssue("fundingDr", "fundingDibo", "governmentBonds", "futures")}
            <div class="module-data-warning" role="status">
              {#if hasResourceIssue("fundingDr", "fundingDibo")}
                <span>资金利率数据缺失</span>
              {/if}
              {#if hasResourceIssue("governmentBonds")}
                <span>利率债成交数据缺失</span>
              {/if}
              {#if hasResourceIssue("futures")}
                <span>国债期货数据缺失</span>
              {/if}
            </div>
          {/if}
          <div class="indicator-grid">
            <FundMetrics metrics={reportDerived.funds} />
          </div>
          {#if !hasResourceIssue("governmentBonds")}
            <ChartHost
              id="government-chart"
              renderer={charts.renderGovernmentCurve}
              args={[reportDerived.governmentBonds]}
              ariaLabel="关键期限国债收益率曲线"
            />
          {/if}
        </section>

        <section class="dashboard-panel panel--equity" aria-labelledby="equity-title">
          <header class="panel-heading">
            <span class="panel-index">04</span>
            <h2 id="equity-title">权益市场</h2>
          </header>
          {#if hasResourceIssue("industry", "margin", "stock")}
            <div class="module-data-warning" role="status">
              {#if hasResourceIssue("industry")}
                <span>权益及行业行情数据缺失</span>
              {/if}
              {#if hasResourceIssue("margin")}
                <span>融资融券数据缺失</span>
              {/if}
              {#if hasResourceIssue("stock")}
                <span>A股收评数据缺失</span>
              {/if}
            </div>
          {/if}
          <div class="equity-stage">
            <div class="equity-dial-stage">
              <ChartHost
                id="equity-chart"
                renderer={charts.renderEquityGauges}
                args={[data.equities]}
                ariaLabel="A股四个主要指数收盘仪表盘"
              />
              <ChartHost
                id="equity-chart-mobile"
                renderer={charts.renderEquityGaugesMobile}
                args={[data.equities]}
                ariaLabel="A股四个主要指数收盘仪表盘"
              />
              <div class="equity-values" aria-label="A股指数点数与涨跌幅">
                <EquityValues points={data.equities} />
              </div>
            </div>
            <div class="stat-grid">
              <EquityStats {data} margin={reportDerived.margin} />
            </div>
            <div class="equity-heatmap-stage">
              <span class="equity-heatmap-label">申万一级行业</span>
              <ChartHost
                id="industry-chart"
                renderer={charts.renderIndustryTreemap}
                args={[data.industries]}
                className="chart-host chart-host--heatmap"
                ariaLabel="申万一级行业涨跌与总市值矩形树图"
              />
            </div>
          </div>
        </section>

        <section class="dashboard-panel panel--primary" aria-labelledby="primary-title">
          <header class="panel-heading">
            <span class="panel-index">05</span>
            <h2 id="primary-title">一级发行</h2>
          </header>
          {#if hasResourceIssue("primary")}
            <div class="module-data-missing" role="status">一级发行数据缺失</div>
          {:else}
            <div class="data-list" aria-label="一级发行列表">
              <PrimaryTable points={reportDerived.primary} />
            </div>
            <div class="summary-strip" aria-label="一级发行汇总">
              <SummaryStrip items={primarySummaryItems(data.primary_summary)} />
            </div>
          {/if}
        </section>

        <section
          class="dashboard-panel panel--comparable"
          aria-labelledby="comparable-title"
        >
          <header class="panel-heading">
            <span class="panel-index">06</span>
            <h2 id="comparable-title">二级行情</h2>
          </header>
          {#if hasResourceIssue("todayTrades", "bondInfos")}
            <div class="module-data-missing" role="status">可比债成交数据缺失</div>
          {:else}
            <div
              class="data-list"
              aria-label="1年、2年、3年和5年可比证券公司债列表"
            >
              <SecondaryTable
                headers={["期限", "债券", "发行人", "成交"]}
                rows={comparableTenorRows(reportDerived.comparable)}
                emptyText="今日暂无公募债成交"
              />
            </div>
            <div class="summary-strip" aria-label="二级行情汇总">
              <SummaryStrip items={comparableSummaryItems(reportDerived.comparable)} />
            </div>
          {/if}
        </section>

        <section
          class="dashboard-panel panel--inventory"
          aria-labelledby="inventory-title"
        >
          <header class="panel-heading">
            <span class="panel-index">07</span>
            <h2 id="inventory-title">东财债券</h2>
          </header>
          {#if hasResourceIssue("favoriteQuotes", "bondInfos")}
            <div class="module-data-missing" role="status">东财债券数据缺失</div>
          {:else}
            <ChartHost
              id="inventory-chart"
              renderer={charts.renderInventory}
              args={[reportDerived.inventory]}
              ariaLabel="东财存量债估值期限结构"
            />
            <div class="summary-strip" aria-label="东财债券汇总">
              <SummaryStrip items={inventorySummaryItems(reportDerived.inventory)} />
            </div>
          {/if}
        </section>
          </div>
        </div>
      {:else}
        <div
          id="text-report-panel"
          class="text-report-view"
          role="tabpanel"
          aria-labelledby="text-report-tab"
        >
          <TextReport data={data} {focusText} {missingResources} readonly />
        </div>
      {/if}
    {/if}
  </main>
</div>
