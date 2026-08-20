<script lang="ts">
  import { onDestroy, onMount } from "svelte";

  import "./app.css";
  import "./styles.css";

  import {
    fetchReport,
    generateMarketBriefing,
  } from "./api";
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
  import { deriveReport, type ReportDerived } from "./report-view";
  import {
    readCachedReport,
    type ReportCacheStorage,
    writeCachedReport,
  } from "./report-cache";
  import { currentReportDate } from "./report-date";
  import {
    pathnameForReportView,
    reportViewFromPathname,
    type ReportView,
  } from "./report-route";
  import type { MarketBriefing, ReportData } from "./types";
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
    margin: { data_date: null, total: null, total_change: null },
    primary: [],
    comparable: [],
    inventory: [],
  };
  let reportSurface: HTMLElement;
  let dateInput: HTMLInputElement;
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

  $: derived = data ? deriveReport(data) : EMPTY_DERIVED;
  $: dateParts = data
    ? chineseDateParts(data.report_date)
    : { date: "—", weekday: "—" };
  $: if (data) {
    document.title = `${data.report_date} · 资金管理部 • 市场点评`;
  }

  onMount(async () => {
    activeView = reportViewFromPathname(window.location.pathname);
    try {
      selectedDate = currentReportDate();
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
    const request = new AbortController();
    activeRequest = request;
    const requestedDate = selectedDate;
    const storage = browserReportStorage();
    const cachedReport = refresh || !storage
      ? null
      : readCachedReport(storage, requestedDate);
    loading = true;
    errorMessage = "";
    try {
      const [report, chartModule] = await Promise.all([
        cachedReport ?? fetchReport(requestedDate, refresh, request.signal),
        import("./charts"),
      ]);
      if (request.signal.aborted || selectedDate !== requestedDate) return;
      if (!cachedReport && storage) writeCachedReport(storage, report);
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

  function handleBriefingApplied(briefing: MarketBriefing): void {
    if (generatedBriefing === briefing) generatedBriefing = null;
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

  function browserReportStorage(): ReportCacheStorage | null {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
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
          <div class="view-toggle" role="group" aria-label="报告展示方式">
            <button
              id="visual-report-tab"
              class:active={activeView === "visual"}
              type="button"
              aria-pressed={activeView === "visual"}
              onclick={() => selectView("visual")}
            >
              可视化
            </button>
            <button
              id="text-report-tab"
              class:active={activeView === "text"}
              type="button"
              aria-pressed={activeView === "text"}
              onclick={() => selectView("text")}
            >
              文字版
            </button>
          </div>
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
            bind:this={dateInput}
            class="hero-date__input"
            type="date"
            aria-label="选择报告日期"
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
            <CoreMetrics {data} {derived} />
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
            onBriefingApplied={handleBriefingApplied}
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
            args={[derived.omoHistory]}
            ariaLabel="近十个操作日公开市场操作柱状图"
          />
          <div class="summary-strip" aria-label="公开市场操作汇总">
            <SummaryStrip
              items={omoSummaryItems(derived.omoHistory, data.report_date)}
            />
          </div>
        </section>

        <section class="dashboard-panel panel--rates" aria-labelledby="rates-title">
          <header class="panel-heading">
            <span class="panel-index">03</span>
            <h2 id="rates-title">固收市场</h2>
          </header>
          <div class="indicator-grid">
            <FundMetrics metrics={derived.funds} />
          </div>
          <ChartHost
            id="government-chart"
            renderer={charts.renderGovernmentCurve}
            args={[derived.governmentBonds]}
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
              <EquityStats {data} margin={derived.margin} />
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
            <PrimaryTable points={derived.primary} />
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
              rows={comparableTenorRows(derived.comparable)}
              emptyText="今日暂无公募债成交"
            />
          </div>
          <div class="summary-strip" aria-label="二级行情汇总">
            <SummaryStrip items={comparableSummaryItems(derived.comparable)} />
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
            args={[derived.inventory]}
            ariaLabel="东财存量债估值期限结构"
          />
          <div class="summary-strip" aria-label="东财债券汇总">
            <SummaryStrip items={inventorySummaryItems(derived.inventory)} />
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
          <TextReport data={data} {focusText} />
        </div>
      {/if}
    {/if}
  </main>
</div>
