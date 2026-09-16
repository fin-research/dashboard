<script lang="ts">

  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import AuthMenu from '$lib/AuthMenu.svelte';
  import { onDestroy, onMount, tick } from "svelte";

  import {
    fetchReport,
    generateMarketBriefing,
    saveMarketReport,
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
  import { saveStoredFocusText } from "./focus-editor";
  import { chineseDateParts } from "./formatters";
  import { globalMessages } from "./lib/global-messages";
  import { deriveReport, type ReportDerived } from "./report-view";
  import {
    currentReportDate,
    shouldWarnUnfinalizedReport,
  } from "./report-date";
  import {
    pathnameForReportView,
    reportViewFromPathname,
    type ReportView,
  } from "./report-route";
  import type {
    MarketBriefing,
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
  let textReport: TextReport | undefined = $state();
  let dateInput = $state<HTMLInputElement>(null!);
  let selectedDate = $state("");
  let data = $state<ReportData | null>(null);
  let charts = $state<ChartRenderers | null>(null);
  let loading = $state(true);
  let errorMessage = $state("");
  let exporting = $state(false);
  let exportLabel = $state("导出&保存");
  let activeRequest: AbortController | null = null;
  let briefingRequest: AbortController | null = null;
  let generatedBriefing = $state<MarketBriefing | null>(null);
  let briefingLoading = $state(false);
  let briefingProgress = $state("");
  let briefingSummaries: Array<{ id: string; text: string }> = $state([]);
  let activeView: ReportView = $state("visual");
  let focusText = $state("");
  let savedFocusText = $state("");
  let focusFinalizedAt = $state<string | null>(null);
  let savingFocus = $state(false);
  let savedDataJson = $state("");
  let resourceIssues = $state<MarketReportResourceIssue[]>([]);

  let reportDerived = $derived(data ? deriveReport(data) : EMPTY_DERIVED);
  let missingResources = $derived(resourceIssues.map((issue) => issue.resource));
  let reportDirty = $derived(Boolean(data) && (
    JSON.stringify(data) !== savedDataJson || focusText !== savedFocusText
  ));
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
      selectedDate = currentReportDate();
      await loadReport(false);
    } catch (error) {
      showError(error);
    }
  });

  onDestroy(() => {
    activeRequest?.abort();
    briefingRequest?.abort();

  });

  async function loadReport(refresh: boolean): Promise<void> {
    if (!selectedDate) return;
    activeRequest?.abort();
    briefingRequest?.abort();
    briefingRequest = null;
    generatedBriefing = null;
    briefingLoading = false;
    briefingProgress = "";
    briefingSummaries = [];
    const request = new AbortController();
    activeRequest = request;
    const requestedDate = selectedDate;
    loading = true;
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
      resourceIssues = loaded.resourceIssues;
      focusText = report.focus_text;
      savedFocusText = report.focus_text;
      focusFinalizedAt = report.finalized_at;
      savedDataJson = JSON.stringify(report);
      charts = chartModule;
      loading = false;
      if (resourceIssues.length) {
        globalMessages.warning(
          `部分数据暂缺：${resourceIssues.map((issue) => issue.label).join("、")}`,
          { key: "market-report-partial-data", duration: 8000 },
        );
      }
      if (shouldWarnUnfinalizedReport(requestedDate, report.finalized_at)) {
        globalMessages.warning(
          `${requestedDate} 无市场点评定稿，已从可回溯数据源重新生成`,
          { key: "market-report-unfinalized" },
        );
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        showError(error);
      }
    }
  }

  function hasResourceIssue(...resources: MarketReportResource[]): boolean {
    return resources.some((resource) =>
      resourceIssues.some((issue) => issue.resource === resource)
    );
  }

  function cancelBriefing(): void {
    briefingRequest?.abort();
    briefingRequest = null;
    briefingLoading = false;
    briefingSummaries = [];
  }

  async function createMarketBriefing(): Promise<void> {
    if (!data || briefingLoading || exporting || savingFocus) return;
    const request = new AbortController();
    briefingRequest = request;
    const date = data.report_date;
    briefingLoading = true;
    briefingProgress = "正在读取新闻";
    briefingSummaries = [];
    try {
      const result = await generateMarketBriefing(date, request.signal, (event) => {
        if (briefingRequest !== request || request.signal.aborted) return;
        if (event.type === "summary") {
          const existing = briefingSummaries.findIndex((summary) => summary.id === event.id);
          briefingSummaries = existing < 0 ? [...briefingSummaries, event]
            : briefingSummaries.map((summary, index) => index === existing ? event : summary);
        } else {
          briefingProgress = event.text;
          if (event.type === "reset") briefingSummaries = [];
        }
      });
      if (briefingRequest === request && !request.signal.aborted && data?.report_date === date) generatedBriefing = result;
    } catch (error) {
      if (!request.signal.aborted && briefingRequest === request)
        globalMessages.error(error instanceof Error ? error.message : String(error), { key: "market-briefing-generate" });
    } finally {
      if (briefingRequest === request) {
        briefingLoading = false;
        briefingRequest = null;
      }
    }
  }

  function handleBriefingApplied(briefing: MarketBriefing): void {
    if (generatedBriefing === briefing) generatedBriefing = null;
  }

  async function persistReport(
    report: ReportData,
    nextFocusText: string,
  ): Promise<void> {
    if (savingFocus) return;
    savingFocus = true;
    try {
      const snapshot = await saveMarketReport(report, nextFocusText);
      if (data?.report_date !== snapshot.report_date) return;
      data = snapshot;
      focusText = snapshot.focus_text;
      savedFocusText = snapshot.focus_text;
      focusFinalizedAt = snapshot.finalized_at;
      savedDataJson = JSON.stringify(snapshot);
      globalMessages.success(`${snapshot.report_date} 市场点评定稿已保存`, {
        key: "market-report-save",
      });
    } catch (error) {
      globalMessages.error(
        error instanceof Error ? error.message : String(error),
        { key: "market-report-save" },
      );
    } finally {
      savingFocus = false;
    }
  }

  function openDatePicker(): void {
    try {
      dateInput.showPicker?.();
    } catch {
      // The native input click remains available where showPicker is unsupported.
    }
  }

  function handleFocusTextChange(value: string): void {
    focusText = value;
  }

  function handleTextReportDataChange(
    report: ReportData,
    nextFocusText: string,
  ): void {
    data = report;
    focusText = nextFocusText;
    saveStoredFocusText(report.report_date, nextFocusText);
  }

  async function saveTextReport(
    report: ReportData,
    nextFocusText: string,
  ): Promise<void> {
    handleTextReportDataChange(report, nextFocusText);
    await persistReport(report, nextFocusText);
  }

  async function exportImage(): Promise<void> {
    if (!data || exporting || briefingLoading || savingFocus) return;
    if (activeView === "text" && !textReport?.prepareExport()) return;
    await tick();
    const report = data;
    const exportedFocus = focusText;
    exporting = true;
    exportLabel = "正在导出";
    let downloaded = false;
    try {
      await exportReportImage(reportSurface, report.report_date, { captureClass: true });
      downloaded = true;
      exportLabel = "正在保存";
      const snapshot = await saveMarketReport(report, exportedFocus);
      if (data?.report_date === snapshot.report_date) {
        data = snapshot;
        focusText = snapshot.focus_text;
        savedFocusText = snapshot.focus_text;
        focusFinalizedAt = snapshot.finalized_at;
        savedDataJson = JSON.stringify(snapshot);
      }
      globalMessages.success(`${snapshot.report_date} 图片已导出，市场点评定稿已保存`, { key: "market-report-export" });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      globalMessages.error(`${downloaded ? "图片已导出，云端保存失败" : "图片导出失败"}：${detail}`, { key: "market-report-export" });
    } finally {
      exporting = false;
      exportLabel = "导出&保存";
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
              disabled={exporting || savingFocus || briefingLoading}
              onclick={() => selectView("visual")}
            >
              可视化
            </Button>
            <Button data-ui-owner="App-svelte" variant={activeView === "text" ? 'default' : 'outline'} class={"ui-button report-view-switch-item"}
              id="text-report-tab"

              type="button"
              aria-pressed={activeView === "text"}
              disabled={exporting || savingFocus || briefingLoading}
              onclick={() => selectView("text")}
            >
              文字版
            </Button>
          </div>
          <Button data-ui-owner="App-svelte" variant="outline"

            class={["ui-button refresh-button", loading && "is-loading"]}
            type="button"
            disabled={loading || exporting || savingFocus}
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
            disabled={!data || loading || exporting || briefingLoading || savingFocus}
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
            disabled={exporting || savingFocus}
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
          <strong>正在汇集市场数据</strong>
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
            <Button data-ui-owner="App-svelte" variant="default"

              class={["ui-button  focus-generate-button", briefingLoading && "is-loading"]}
              type="button"
              disabled={exporting || savingFocus}
              aria-label={briefingLoading ? "取消生成今日聚焦" : "根据当天新闻生成今日聚焦"}
              onclick={briefingLoading ? cancelBriefing : createMarketBriefing}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="m10 2 1.1 4.2L15 8l-3.9 1.8L10 14l-1.1-4.2L5 8l3.9-1.8L10 2Z" />
                <path d="m16 13 .6 2.1 1.9.9-1.9.9L16 19l-.6-2.1-1.9-.9 1.9-.9L16 13Z" />
              </svg>
              <span>{briefingLoading ? "取消生成" : "生成聚焦"}</span>
            </Button>
          </header>
          <FocusEditor
            generating={briefingLoading}
            disabled={exporting || savingFocus}
            progressText={briefingProgress}
            summaries={briefingSummaries}
            reportDate={data.report_date}
            {generatedBriefing}
            initialText={focusText}
            finalizedAt={focusFinalizedAt}
            onTextChange={handleFocusTextChange}
            onBriefingApplied={handleBriefingApplied}
          />
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
          <TextReport
            bind:this={textReport}
            disabled={exporting}
            data={data}
            {focusText}
            {missingResources}
            dirty={reportDirty}
            saving={savingFocus || exporting}
            onDataChange={handleTextReportDataChange}
            onSave={saveTextReport}
          />
        </div>
      {/if}
    {/if}
  </main>
</div>
