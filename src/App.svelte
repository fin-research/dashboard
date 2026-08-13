<script lang="ts">
  import { onDestroy, onMount } from "svelte";

  import { fetchConfig, fetchReport, generateMarketBriefing } from "./api";
  import ChartHost from "./components/ChartHost.svelte";
  import CoreMetrics from "./components/CoreMetrics.svelte";
  import EquityStats from "./components/EquityStats.svelte";
  import EquityValues from "./components/EquityValues.svelte";
  import FundMetrics from "./components/FundMetrics.svelte";
  import PrimaryTable from "./components/PrimaryTable.svelte";
  import SecondaryTable from "./components/SecondaryTable.svelte";
  import SummaryStrip from "./components/SummaryStrip.svelte";
  import FocusEditor from "./components/FocusEditor.svelte";
  import TextReport from "./components/TextReport.svelte";
  import { exportReportImage } from "./export";
  import { loadStoredFocusText } from "./focus-editor";
  import { chineseDateParts } from "./formatters";
  import type { MarketBriefing, ReportData } from "./types";
  import {
    comparableSummaryItems,
    comparableTenorRows,
    inventorySummaryItems,
    omoSummaryItems,
    primarySummaryItems,
  } from "./view-model";

  type ChartRenderers = typeof import("./charts");
  type ReportView = "visual" | "text";

  let reportSurface: HTMLElement;
  let selectedDate = "";
  let data: ReportData | null = null;
  let charts: ChartRenderers | null = null;
  let loading = true;
  let errorMessage = "";
  let exporting = false;
  let exportLabel = "导出图片";
  let activeRequest: AbortController | null = null;
  let briefingRequest: AbortController | null = null;
  let generatedBriefing: MarketBriefing | null = null;
  let briefingLoading = false;
  let briefingError = "";
  let exportTimer: number | null = null;
  let activeView: ReportView = "visual";
  let focusText = "";
  let navigationOpen = false;
  let navigationTrigger: HTMLButtonElement;

  $: dateParts = data
    ? chineseDateParts(data.report_date)
    : { date: "—", weekday: "—" };
  $: if (data) {
    document.title = `${data.report_date} · 资金管理部 • 市场点评`;
  }

  onMount(async () => {
    try {
      const config = await fetchConfig();
      selectedDate = config.defaultDate;
      await loadReport(false);
    } catch (error) {
      showError(error);
    }
  });

  onDestroy(() => {
    activeRequest?.abort();
    briefingRequest?.abort();
    if (exportTimer !== null) window.clearTimeout(exportTimer);
  });

  async function loadReport(refresh: boolean): Promise<void> {
    if (!selectedDate) return;
    activeRequest?.abort();
    briefingRequest?.abort();
    briefingLoading = false;
    briefingError = "";
    activeRequest = new AbortController();
    loading = true;
    errorMessage = "";
    try {
      const [report, chartModule] = await Promise.all([
        fetchReport(selectedDate, refresh, activeRequest.signal),
        import("./charts"),
      ]);
      data = report;
      focusText = loadStoredFocusText(report.report_date);
      charts = chartModule;
      loading = false;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        showError(error);
      }
    }
  }

  async function createMarketBriefing(): Promise<void> {
    if (!data || briefingLoading) return;
    briefingRequest?.abort();
    briefingRequest = new AbortController();
    briefingLoading = true;
    briefingError = "";
    try {
      generatedBriefing = await generateMarketBriefing(
        data.report_date,
        briefingRequest.signal,
      );
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        briefingError = error instanceof Error ? error.message : String(error);
      }
    } finally {
      briefingLoading = false;
    }
  }

  async function exportImage(): Promise<void> {
    if (!data || exporting) return;
    exporting = true;
    exportLabel = "正在导出";
    try {
      await exportReportImage(reportSurface, data.report_date, {
        captureClass: true,
      });
      exportLabel = "导出完成";
    } catch (error) {
      console.error("导出图片失败", error);
      exportLabel = "导出失败";
    } finally {
      exportTimer = window.setTimeout(() => {
        exporting = false;
        exportLabel = "导出图片";
      }, 1200);
    }
  }

  function showError(error: unknown): void {
    loading = false;
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  function selectView(view: ReportView): void {
    activeView = view;
    navigationOpen = false;
  }

  function openNavigation(): void {
    navigationOpen = true;
    requestAnimationFrame(() => {
      document.getElementById(`${activeView}-report-tab`)?.focus();
    });
  }

  function closeNavigation(restoreFocus = false): void {
    navigationOpen = false;
    if (restoreFocus) requestAnimationFrame(() => navigationTrigger?.focus());
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || !navigationOpen) return;
    event.preventDefault();
    closeNavigation(true);
  }

  function handleTabKeydown(event: KeyboardEvent): void {
    const views: ReportView[] = ["visual", "text"];
    const currentIndex = views.indexOf(activeView);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % views.length;
    if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + views.length) % views.length;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = views.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextView = views[nextIndex]!;
    activeView = nextView;
    document.getElementById(`${nextView}-report-tab`)?.focus();
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<svelte:head>
  <meta name="theme-color" content="#f6f8fb" />
</svelte:head>

<div class="page-shell">
  <div class:open={navigationOpen} class="navigation-overlay">
    <button
      class="navigation-scrim"
      type="button"
      aria-label="关闭报告导航"
      tabindex={navigationOpen ? 0 : -1}
      onclick={() => closeNavigation(true)}
    ></button>
    <nav
      id="report-navigation"
      class="navigation-drawer"
      aria-label="报告导航"
      aria-hidden={!navigationOpen}
    >
      <div class="navigation-drawer__header">
        <strong>报告展示方式</strong>
        <button
          type="button"
          aria-label="关闭报告导航"
          onclick={() => closeNavigation(true)}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="m5 5 10 10M15 5 5 15" />
          </svg>
        </button>
      </div>
      <div class="report-tabs" aria-label="报告展示方式" role="tablist">
      <button
        id="visual-report-tab"
        class:active={activeView === "visual"}
        type="button"
        role="tab"
        aria-selected={activeView === "visual"}
        tabindex={navigationOpen && activeView === "visual" ? 0 : -1}
        onclick={() => selectView("visual")}
        onkeydown={handleTabKeydown}
      >
        可视化报告
      </button>
      <button
        id="text-report-tab"
        class:active={activeView === "text"}
        type="button"
        role="tab"
        aria-selected={activeView === "text"}
        tabindex={navigationOpen && activeView === "text" ? 0 : -1}
        onclick={() => selectView("text")}
        onkeydown={handleTabKeydown}
      >
        文字版报告
      </button>
      </div>
    </nav>
  </div>

  <main bind:this={reportSurface} id="report-surface">
    <header class="report-masthead">
      <div class="report-title">
        <h1>
          <button
            bind:this={navigationTrigger}
            class="report-navigation-trigger"
            type="button"
            aria-label="资金管理部 • 市场点评，展开报告导航"
            aria-expanded={navigationOpen}
            aria-controls="report-navigation"
            onclick={openNavigation}
          >
            <span class="report-title__department">资金管理部</span>
            <span class="report-title__dot" aria-hidden="true">•</span>
            <span class="report-title__subject">市场点评</span>
          </button>
        </h1>
      </div>
      <div class="masthead-controls" aria-label="报告控制">
        <div class="titlebar-actions">
          <button
            class:is-loading={loading}
            class="refresh-button"
            type="button"
            disabled={loading}
            onclick={() => loadReport(true)}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M16.4 6.1A7 7 0 1 0 17 11" />
              <path d="M16.5 2.7v4h-4" />
            </svg>
            <span>刷新</span>
          </button>
          <button
            class:is-exporting={exporting}
            class="export-button"
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
          </button>
        </div>
        <label class="hero-date">
          <span class="sr-only">选择报告日期</span>
          <input
            class="hero-date__input"
            type="date"
            aria-label="选择报告日期"
            bind:value={selectedDate}
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
    </header>

    {#if loading}
      <div class="alert loading-state" role="status" aria-live="polite">
        <span class="loading-orbit" aria-hidden="true"></span>
        <div>
          <strong>正在汇集市场数据</strong>
          <p>各市场数据正在对齐。</p>
        </div>
      </div>
    {:else if errorMessage}
      <div class="alert error-state" role="alert">
        <span class="error-index">!</span>
        <div>
          <strong>报告暂时无法加载</strong>
          <p>{errorMessage}</p>
        </div>
        <button
          class="btn btn-sm"
          type="button"
          onclick={() => loadReport(true)}>重新尝试</button
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
            <CoreMetrics {data} />
          </div>
          <div class="report-content">
        <section class="dashboard-panel panel--focus" aria-labelledby="focus-title">
          <header class="panel-heading">
            <span class="panel-index">01</span>
            <h2 id="focus-title">今日聚焦</h2>
            <button
              class:is-loading={briefingLoading}
              class="focus-generate-button"
              type="button"
              disabled={briefingLoading}
              aria-label="根据当天新闻生成今日聚焦"
              onclick={createMarketBriefing}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="m10 2 1.1 4.2L15 8l-3.9 1.8L10 14l-1.1-4.2L5 8l3.9-1.8L10 2Z" />
                <path d="m16 13 .6 2.1 1.9.9-1.9.9L16 19l-.6-2.1-1.9-.9 1.9-.9L16 13Z" />
              </svg>
              <span>{briefingLoading ? "生成中" : "生成聚焦"}</span>
            </button>
          </header>
          {#if briefingError}
            <p class="focus-generation-error" role="alert">{briefingError}</p>
          {/if}
          <FocusEditor
            reportDate={data.report_date}
            {generatedBriefing}
            onTextChange={(value) => (focusText = value)}
          />
        </section>

        <section class="dashboard-panel panel--omo" aria-labelledby="omo-title">
          <header class="panel-heading">
            <span class="panel-index">02</span>
            <h2 id="omo-title">公开市场操作</h2>
          </header>
          <ChartHost
            id="omo-chart"
            renderer={charts.renderOmo}
            args={[data.omo_history]}
            ariaLabel="近十个操作日公开市场操作柱状图"
          />
          <div class="summary-strip" aria-label="公开市场操作汇总">
            <SummaryStrip
              items={omoSummaryItems(data.omo_history, data.report_date)}
            />
          </div>
        </section>

        <section class="dashboard-panel panel--rates" aria-labelledby="rates-title">
          <header class="panel-heading">
            <span class="panel-index">03</span>
            <h2 id="rates-title">固收市场</h2>
          </header>
          <div class="indicator-grid">
            <FundMetrics metrics={data.funds} />
          </div>
          <ChartHost
            id="government-chart"
            renderer={charts.renderGovernmentCurve}
            args={[data.government_bonds]}
            ariaLabel="关键期限国债收益率曲线"
          />
        </section>

        <section class="dashboard-panel panel--equity" aria-labelledby="equity-title">
          <header class="panel-heading">
            <span class="panel-index">04</span>
            <h2 id="equity-title">权益市场</h2>
          </header>
          <div class="equity-stage">
            <div class="equity-dial-stage">
              <ChartHost
                id="equity-chart"
                renderer={charts.renderEquityGauges}
                args={[data.equities]}
                ariaLabel="A股四个主要指数收盘仪表盘"
              />
              <div class="equity-values" aria-label="A股指数点数与涨跌幅">
                <EquityValues points={data.equities} />
              </div>
            </div>
            <div class="stat-grid">
              <EquityStats {data} />
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
          <div class="data-list" aria-label="一级发行列表">
            <PrimaryTable points={data.primary} />
          </div>
          <div class="summary-strip" aria-label="一级发行汇总">
            <SummaryStrip items={primarySummaryItems(data.primary_summary)} />
          </div>
        </section>

        <section
          class="dashboard-panel panel--comparable"
          aria-labelledby="comparable-title"
        >
          <header class="panel-heading">
            <span class="panel-index">06</span>
            <h2 id="comparable-title">二级行情</h2>
          </header>
          <div
            class="data-list"
            aria-label="1年、2年、3年和5年可比证券公司债列表"
          >
            <SecondaryTable
              headers={["期限", "债券", "发行人", "成交"]}
              rows={comparableTenorRows(data.comparable)}
              emptyText="今日暂无公募债成交"
            />
          </div>
          <div class="summary-strip" aria-label="二级行情汇总">
            <SummaryStrip items={comparableSummaryItems(data.comparable)} />
          </div>
        </section>

        <section
          class="dashboard-panel panel--inventory"
          aria-labelledby="inventory-title"
        >
          <header class="panel-heading">
            <span class="panel-index">07</span>
            <h2 id="inventory-title">东财债券</h2>
          </header>
          <ChartHost
            id="inventory-chart"
            renderer={charts.renderInventory}
            args={[data.inventory]}
            ariaLabel="东财存量债估值期限结构"
          />
          <div class="summary-strip" aria-label="东财债券汇总">
            <SummaryStrip items={inventorySummaryItems(data.inventory)} />
          </div>
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
          <TextReport {data} {focusText} />
        </div>
      {/if}
    {/if}
  </main>
</div>
