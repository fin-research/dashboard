<script lang="ts">
  import { onMount } from "svelte";

  import "../../app.css";
  import "../../styles.css";
  import "../../bond-ledger.css";

  import {
    renderBondScaleReturnTrend,
    renderHoldingDistribution,
    renderMaturityDistribution,
  } from "../../charts/bond-ledger";
  import ChartHost from "../../components/ChartHost.svelte";
  import MetricIcon from "../../components/MetricIcon.svelte";
  import { exportReportImage } from "../../export";
  import {
    emptyBondLedgerReport,
    weekRange,
  } from "$lib/bond-ledger/analytics";
  import {
    calendarDays,
    calendarDaysWithLedgerStatus,
    monthLabel,
    monthStart,
    resolveAvailableRange,
    shiftMonth,
  } from "$lib/bond-ledger/calendar";
  import {
    formatDecimalPercent,
    formatMultiple,
    formatSignedWan,
    formatYears,
    formatYi,
  } from "$lib/bond-ledger/format";
  import type { BondLedgerReport } from "$lib/bond-ledger/types";
  import {
    archiveBondLedgerFile,
    deleteRemoteBondLedger,
    downloadRemoteBondLedger,
    listRemoteBondLedgers,
    loadBondLedgerReport,
    waitForBondLedgerImport,
    type RemoteBondLedgerFile,
  } from "$lib/bond-ledger/upload";
  import { currentReportDate } from "../../report-date";
  import { globalMessages } from "$lib/global-messages";
  import type { MetricIconName } from "../../view-model";

  const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
  const INITIAL_REPORT_DATE = currentReportDate();
  const INITIAL_WEEK_RANGE = weekRange(INITIAL_REPORT_DATE);

  let analytics: BondLedgerReport = emptyBondLedgerReport();
  let remoteFiles: RemoteBondLedgerFile[] = [];
  let databaseLedgerDates: string[] = [];
  let startDate = INITIAL_WEEK_RANGE.startDate;
  let endDate = INITIAL_WEEK_RANGE.endDate;
  let loadingRecords = true;
  let syncingRecords = false;
  let uploading = false;
  let deleting = false;
  let uploadMessage = "";
  let errorMessage = "";
  let rangeOpen = false;
  let rangePhase: "start" | "end" = "start";
  let rangeMonthLeft = monthStart(startDate);
  let managementMonth = monthStart(INITIAL_REPORT_DATE);
  let selectedManagedDate = "";
  let reuploadTarget = "";
  let exporting = false;
  let exportLabel = "导出图片";
  let exportTimer: number | null = null;
  let syncGeneration = 0;
  let batchInput: HTMLInputElement;
  let reuploadInput: HTMLInputElement;
  let managementDialog: HTMLDialogElement;
  let reportSurface: HTMLElement;

  $: current = analytics.currentPerformance;
  $: isDefaultWeek = isCurrentWeek(startDate, endDate);
  $: rangeMonths = [rangeMonthLeft, shiftMonth(rangeMonthLeft, 1)];
  $: managedFile =
    remoteFiles.find((file) => file.date === selectedManagedDate) ?? null;
  $: managementCalendarDays = calendarDaysWithLedgerStatus(
    managementMonth,
    databaseLedgerDates,
  );
  $: selectedManagedDateHasLedger = databaseLedgerDates.includes(
    selectedManagedDate,
  );
  $: metricCards = [
    {
      label: "当前规模",
      value: formatYi(current?.marketValue ?? null),
      detail: signedMetric(
        analytics.metricDeltas.marketValue,
        100_000_000,
        2,
        "亿元",
      ),
      delta: analytics.metricDeltas.marketValue,
      icon: "bank" as MetricIconName,
    },
    {
      label: "杠杆率",
      value: formatMultiple(current?.leverage ?? null),
      detail: signedMetric(analytics.metricDeltas.leverage, 1, 2, "倍"),
      delta: analytics.metricDeltas.leverage,
      icon: "leverage" as MetricIconName,
    },
    {
      label: "修正久期",
      value: formatYears(current?.modifiedDuration ?? null),
      detail: signedMetric(
        analytics.metricDeltas.modifiedDuration,
        1,
        2,
        "年",
      ),
      delta: analytics.metricDeltas.modifiedDuration,
      icon: "bond" as MetricIconName,
    },
    {
      label: "年初至今收益率",
      value: formatDecimalPercent(analytics.ytdAnnualizedReturn),
      detail: signedMetric(
        analytics.metricDeltas.ytdAnnualizedReturn,
        0.01,
        2,
        "pct",
      ),
      delta: analytics.metricDeltas.ytdAnnualizedReturn,
      icon: "equity" as MetricIconName,
    },
    {
      label: isDefaultWeek ? "本周损益" : "区间损益",
      value: formatSignedWan(analytics.rangeProfit),
      detail: signedMetric(
        analytics.metricDeltas.rangeProfit,
        10_000,
        1,
        "万元",
      ),
      delta: analytics.metricDeltas.rangeProfit,
      icon: "profit" as MetricIconName,
    },
    {
      label: isDefaultWeek ? "本周交易" : "区间交易",
      value: `${analytics.transactionCount} 只`,
      detail: signedMetric(
        analytics.metricDeltas.transactionCount,
        1,
        0,
        "只",
      ),
      delta: analytics.metricDeltas.transactionCount,
      icon: "trade" as MetricIconName,
    },
  ];

  onMount(() => {
    void refreshReport(true);
    return () => {
      if (exportTimer !== null) window.clearTimeout(exportTimer);
    };
  });

  async function refreshReport(allowFallback: boolean): Promise<void> {
    const generation = ++syncGeneration;
    syncingRecords = true;
    if (loadingRecords) errorMessage = "";
    try {
      const inventory = await listRemoteBondLedgers();
      if (generation !== syncGeneration) return;
      remoteFiles = inventory.files;
      databaseLedgerDates = inventory.databaseDates;
      const currentWeek = weekRange(currentReportDate());
      const resolved = resolveAvailableRange(
        databaseLedgerDates,
        startDate,
        endDate,
        currentWeek.startDate,
        currentWeek.endDate,
      );
      if (!resolved) {
        analytics = emptyBondLedgerReport();
        return;
      }
      if (resolved.fellBack && allowFallback) {
        startDate = resolved.startDate;
        endDate = resolved.endDate;
        rangeMonthLeft = monthStart(startDate);
        globalMessages.warning(
          `所选范围无线上台账，已回退至 ${startDate}—${endDate}`,
          {
            key: "bond-ledger-range-fallback",
            title: "日期范围已调整",
            duration: 6000,
          },
        );
      }
      if (generation !== syncGeneration) return;
      analytics = await loadBondLedgerReport(startDate, endDate);
    } catch (error) {
      if (generation !== syncGeneration) return;
      errorMessage = error instanceof Error ? error.message : String(error);
      analytics = emptyBondLedgerReport();
    } finally {
      if (generation === syncGeneration) {
        loadingRecords = false;
        syncingRecords = false;
      }
    }
  }

  async function refreshLedgerInventory(): Promise<void> {
    const inventory = await listRemoteBondLedgers();
    remoteFiles = inventory.files;
    databaseLedgerDates = inventory.databaseDates;
  }

  async function handleFiles(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    const target = input === reuploadInput ? reuploadTarget : "";
    input.value = "";
    reuploadTarget = "";
    if (!files.length || uploading) return;
    uploading = true;
    errorMessage = "";
    uploadMessage = "";
    const errors: string[] = [];
    let successCount = 0;
    let latestUploadedDate = "";
    for (const [index, file] of files.entries()) {
      uploadMessage = `正在上传 ${index + 1}/${files.length}：${file.name}`;
      try {
        const archived = await archiveBondLedgerFile(file, target || undefined);
        const imported = await waitForBondLedgerImport(
          archived.workflowId,
          () => {
            uploadMessage = `正在导入 ${index + 1}/${files.length}：${file.name}`;
          },
        );
        successCount += 1;
        if (imported.reportDate > latestUploadedDate) {
          latestUploadedDate = imported.reportDate;
        }
      } catch (error) {
        errors.push(
          `${file.name}：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    try {
      await refreshLedgerInventory();
      if (latestUploadedDate) {
        managementMonth = monthStart(latestUploadedDate);
        selectedManagedDate = latestUploadedDate;
      }
      if (
        latestUploadedDate &&
        isWithin(latestUploadedDate, startDate, endDate)
      ) {
        await refreshReport(false);
      } else if (successCount) {
        await refreshReport(true);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    } finally {
      uploading = false;
    }
    uploadMessage = successCount
      ? `已完成 ${successCount} 份 Excel 的 R2 归档和数据库导入`
      : "";
    if (errors.length) errorMessage = errors.join("；");
  }

  async function removeRemoteLedger(remote: RemoteBondLedgerFile): Promise<void> {
    if (deleting) return;
    const confirmed = window.confirm(
      `删除 ${remote.date} 的周报数据库数据？原始 Excel 仍保留在 R2 归档。`,
    );
    if (!confirmed) return;
    deleting = true;
    errorMessage = "";
    try {
      await deleteRemoteBondLedger(remote.date);
      await refreshLedgerInventory();
      selectedManagedDate = "";
      uploadMessage = `已删除 ${remote.date} 线上台账`;
      await refreshReport(true);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      deleting = false;
    }
  }

  async function openManagement(): Promise<void> {
    managementDialog.showModal();
    try {
      await refreshLedgerInventory();
      const latestDate = databaseLedgerDates.at(-1);
      if (latestDate) {
        managementMonth = monthStart(latestDate);
        selectedManagedDate = latestDate;
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }
  }

  function openBatchUpload(): void {
    reuploadTarget = "";
    batchInput.click();
  }

  function openReupload(date: string): void {
    reuploadTarget = date;
    reuploadInput.click();
  }

  async function downloadManagedFile(
    remote: RemoteBondLedgerFile,
  ): Promise<void> {
    errorMessage = "";
    try {
      await downloadRemoteBondLedger(remote);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }
  }

  function openRangePicker(event: MouseEvent): void {
    event.stopPropagation();
    rangeMonthLeft = monthStart(startDate || currentReportDate());
    rangePhase = "start";
    rangeOpen = !rangeOpen;
  }

  function closeRangeFromWindow(event: MouseEvent): void {
    const target = event.target;
    if (
      rangeOpen &&
      target instanceof Element &&
      !target.closest(".ledger-range-picker")
    ) {
      rangeOpen = false;
    }
  }

  function selectRangeDate(date: string): void {
    if (rangePhase === "start") {
      startDate = date;
      endDate = date;
      rangePhase = "end";
      return;
    }
    if (date < startDate) {
      endDate = startDate;
      startDate = date;
    } else {
      endDate = date;
    }
    rangeOpen = false;
    void refreshReport(true);
  }

  async function exportImage(): Promise<void> {
    if (!analytics.hasData || exporting) return;
    exporting = true;
    exportLabel = "正在导出";
    try {
      await exportReportImage(reportSurface, endDate, {
        captureClass: true,
        filename: `资金管理部-二级池周报-${startDate}至${endDate}.png`,
      });
      exportLabel = "导出完成";
    } catch (error) {
      console.error("导出二级池周报失败", error);
      exportLabel = "导出失败";
    } finally {
      exportTimer = window.setTimeout(() => {
        exporting = false;
        exportLabel = "导出图片";
      }, 1200);
    }
  }

  function remoteForDate(date: string): RemoteBondLedgerFile | null {
    return remoteFiles.find((file) => file.date === date) ?? null;
  }

  function isSelectedDate(date: string): boolean {
    return isWithin(date, startDate, endDate);
  }

  function isCurrentWeek(start: string, end: string): boolean {
    if (!start || !end) return false;
    const range = weekRange(currentReportDate());
    return start === range.startDate && end >= start && end <= range.endDate;
  }

  function isWithin(date: string, start: string, end: string): boolean {
    return Boolean(start && end && date >= start && date <= end);
  }

  function deltaClass(value: number | null): string {
    return value === null || value === 0
      ? "tone-flat"
      : value > 0
        ? "tone-up"
        : "tone-down";
  }

  function signedMetric(
    value: number | null,
    divisor: number,
    digits: number,
    unit: string,
  ): { value: string; unit: string } {
    if (value === null || !Number.isFinite(value)) {
      return { value: "—", unit: "" };
    }
    return {
      value: `${sign(value)}${(Math.abs(value) / divisor).toFixed(digits)}`,
      unit: ` ${unit}`,
    };
  }

  function sign(value: number): string {
    return value > 0 ? "+" : value < 0 ? "−" : "";
  }
</script>

<svelte:window onclick={closeRangeFromWindow} />

<svelte:head>
  <title>二级池周报 · 资金管理部</title>
  <meta name="description" content="二级资金池周报" />
  <meta name="theme-color" content="#f6f8fb" />
</svelte:head>

<div class="ledger-shell">
  <div bind:this={reportSurface} class="ledger-report">
    <header class="ledger-masthead">
      <div class="ledger-title-block">
        <a class="ledger-back" href="/" aria-label="返回市场研究门户">
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="m12.5 4-6 6 6 6" />
          </svg>
        </a>
        <h1>
          <span>资金管理部</span>
          <span class="ledger-title-dot" aria-hidden="true">•</span>
          <span class="ledger-title-subject">二级池周报</span>
        </h1>
      </div>

      <div class="ledger-actions" aria-label="台账、日期范围与导出控制">
        <div class="ledger-range-picker">
          <button
            class="ledger-range-trigger"
            type="button"
            aria-label="选择统计日期范围"
            aria-expanded={rangeOpen}
            onclick={openRangePicker}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M4 6.5h12M6.5 3v3M13.5 3v3M4 4.5h12v12H4z" />
            </svg>
            <time datetime={startDate}>{startDate}</time>
            <span aria-hidden="true">—</span>
            <time datetime={endDate}>{endDate}</time>
          </button>
          {#if rangeOpen}
            <div class="ledger-range-popover" role="dialog" aria-label="选择统计日期范围" tabindex="-1">
              <div class="range-calendar-nav">
                <button type="button" aria-label="向前一个月" onclick={() => (rangeMonthLeft = shiftMonth(rangeMonthLeft, -1))}>‹</button>
                <strong>{rangePhase === "start" ? "选择起始日期" : "选择结束日期"}</strong>
                <button type="button" aria-label="向后一个月" onclick={() => (rangeMonthLeft = shiftMonth(rangeMonthLeft, 1))}>›</button>
              </div>
              <div class="range-calendar-pair">
                {#each rangeMonths as month (month)}
                  <section class="mini-calendar" aria-label={monthLabel(month)}>
                    <h2>{monthLabel(month)}</h2>
                    <div class="calendar-weekdays" aria-hidden="true">
                      {#each WEEKDAYS as weekday}<span>{weekday}</span>{/each}
                    </div>
                    <div class="calendar-grid">
                      {#each calendarDays(month) as day (day.date)}
                        <button
                          type="button"
                          class:outside={!day.inMonth}
                          class:in-range={isSelectedDate(day.date)}
                          class:endpoint={day.date === startDate || day.date === endDate}
                          disabled={!day.inMonth}
                          aria-label={day.date}
                          onclick={() => selectRangeDate(day.date)}
                        >{day.day}</button>
                      {/each}
                    </div>
                  </section>
                {/each}
              </div>
            </div>
          {/if}
        </div>

        <button class="ledger-management-button" type="button" onclick={openManagement}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M3.5 5.5h13v11h-13zM6 3.5h8v2M6.5 9h7M6.5 12.5h7" />
          </svg>
          <span>台账管理</span>
        </button>
        <button
          class:is-exporting={exporting}
          class="export-button"
          type="button"
          disabled={!analytics.hasData || loadingRecords || exporting}
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
    </header>

    <div class="ledger-status" aria-live="polite">
      {#if syncingRecords && !loadingRecords}<p>正在读取数据库周报</p>{/if}
      {#if uploadMessage}<p class="ledger-status-success">{uploadMessage}</p>{/if}
      {#if errorMessage}<p class="ledger-status-error" role="alert">{errorMessage}</p>{/if}
    </div>

    {#if loadingRecords}
      <main class="ledger-loading" aria-live="polite">
        <span class="loading-orbit" aria-hidden="true"></span>
        <strong>正在读取数据库周报</strong>
      </main>
    {:else if !analytics.hasData}
      <main class="ledger-empty">
        <div class="ledger-empty-icon" aria-hidden="true">
          <svg viewBox="0 0 48 48">
            <path d="M10 6h21l7 7v29H10z" />
            <path d="M31 6v8h8M16 23h16M16 29h16M16 35h10" />
          </svg>
        </div>
        <h2>数据库暂无周报数据</h2>
        <button type="button" onclick={openManagement}>打开台账管理</button>
      </main>
    {:else}
      <main class="ledger-main">
        <section class="ledger-metrics" aria-label="二级池核心指标">
          {#each metricCards as card, index (card.label)}
            <article class={`ledger-metric ledger-metric--${index + 1}`}>
              <MetricIcon icon={card.icon} />
              <div>
                <span>{card.label}</span>
                <strong>{card.value}</strong>
                <small>较上周 <b class={deltaClass(card.delta)}>{card.detail.value}</b>{card.detail.unit}</small>
              </div>
            </article>
          {/each}
        </section>

        <div class="ledger-chart-grid">
          <section class="dashboard-panel ledger-panel ledger-panel--trend" aria-labelledby="return-trend-title">
            <header class="panel-heading ledger-panel-heading">
              <h2 id="return-trend-title">规模&amp;收益率走势</h2>
              <div class="ledger-trend-legend" role="list" aria-label="图例">
                <span role="listitem"><i class="ledger-legend-line ledger-legend-line--scale" aria-hidden="true"></i>规模</span>
                <span role="listitem"><i class="ledger-legend-line ledger-legend-line--return" aria-hidden="true"></i>年化收益率</span>
                <span role="listitem"><i class="ledger-legend-line ledger-legend-line--range" aria-hidden="true"></i>所选区间</span>
              </div>
            </header>
            <ChartHost
              renderer={renderBondScaleReturnTrend}
              args={[analytics.performanceTrend, startDate, endDate]}
              ariaLabel="二级池规模与业务口径年化收益率走势"
              className="ledger-chart ledger-chart--trend"
            />
          </section>

          <section class="dashboard-panel ledger-panel" aria-labelledby="holding-type-title">
            <header class="panel-heading ledger-panel-heading">
              <h2 id="holding-type-title">持仓分布</h2>
            </header>
            <ChartHost
              renderer={renderHoldingDistribution}
              args={[analytics.holdingTypes]}
              ariaLabel="按债券类型统计的持仓分布饼图"
              className="ledger-chart ledger-chart--category"
            />
          </section>

          <section class="dashboard-panel ledger-panel" aria-labelledby="maturity-title">
            <header class="panel-heading ledger-panel-heading">
              <h2 id="maturity-title">期限分布</h2>
            </header>
            <ChartHost
              renderer={renderMaturityDistribution}
              args={[analytics.maturityBuckets]}
              ariaLabel="按剩余期限统计的持仓规模直方图"
              className="ledger-chart ledger-chart--maturity"
            />
          </section>
        </div>

        <section class="dashboard-panel ledger-panel" aria-labelledby="transactions-title">
          <header class="panel-heading ledger-panel-heading ledger-panel-heading--transactions">
            <h2 id="transactions-title">成交明细</h2>
            <div class="transaction-summary" aria-label="成交汇总">
              <span><i class="transaction-dot transaction-dot--buy"></i>买入 <strong>{formatYi(analytics.transactionTotals.买入)}</strong></span>
              <span><i class="transaction-dot transaction-dot--sell"></i>卖出 <strong>{formatYi(analytics.transactionTotals.卖出)}</strong></span>
              <span><i class="transaction-dot transaction-dot--maturity"></i>到期 <strong>{formatYi(analytics.transactionTotals.到期)}</strong></span>
            </div>
          </header>
          <div class="ledger-table-wrap">
            <table class="ledger-table ledger-table--transactions">
              <thead>
                <tr>
                  <th>日期</th>
                  <th>方向</th>
                  <th>债券代码</th>
                  <th>债券名称</th>
                  <th>债券类型</th>
                  <th>成交面额</th>
                  <th>实现损益</th>
                </tr>
              </thead>
              <tbody>
                {#each analytics.transactions as transaction, index (`${transaction.date}-${transaction.code}-${transaction.side}-${index}`)}
                  <tr>
                    <td>{transaction.date}</td>
                    <td><span class={`transaction-side transaction-side--${transaction.side === "买入" ? "buy" : transaction.side === "卖出" ? "sell" : "maturity"}`}>{transaction.side}</span></td>
                    <td>{transaction.code}</td>
                    <th scope="row">{transaction.name}</th>
                    <td>{transaction.category}</td>
                    <td>{formatYi(transaction.faceAmount)}</td>
                    <td class={deltaClass(transaction.realizedProfit)}>{transaction.realizedProfit === null ? "-" : formatSignedWan(transaction.realizedProfit)}</td>
                  </tr>
                {:else}
                  <tr class="ledger-table-empty"><td colspan="7">所选范围暂无成交</td></tr>
                {/each}
              </tbody>
            </table>
          </div>
        </section>

      </main>
    {/if}
  </div>
</div>

<input
  bind:this={batchInput}
  class="sr-only"
  type="file"
  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  multiple
  disabled={uploading}
  onchange={handleFiles}
/>
<input
  bind:this={reuploadInput}
  class="sr-only"
  type="file"
  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  disabled={uploading}
  onchange={handleFiles}
/>

<dialog bind:this={managementDialog} class="ledger-management-dialog" aria-labelledby="ledger-management-title">
  <div class="ledger-management-content">
    <header>
      <h2 id="ledger-management-title">台账管理</h2>
      <button type="button" aria-label="关闭台账管理" onclick={() => managementDialog.close()}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
      </button>
    </header>
    <div class="ledger-management-toolbar">
      <button class="ledger-upload-primary" type="button" disabled={uploading} onclick={openBatchUpload}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 13V3m0 0L6.5 6.5M10 3l3.5 3.5M4 12.5V17h12v-4.5" /></svg>
        <span>{uploading ? "正在上传" : "批量上传 Excel"}</span>
      </button>
      <span>数据库共 {databaseLedgerDates.length} 个报表日</span>
    </div>
    {#if uploadMessage || errorMessage}
      <div class="ledger-management-status" aria-live="polite">
        {#if uploadMessage}<p class="ledger-status-success">{uploadMessage}</p>{/if}
        {#if errorMessage}<p class="ledger-status-error" role="alert">{errorMessage}</p>{/if}
      </div>
    {/if}
    <div class="management-calendar-nav">
      <button type="button" aria-label="上一个月" onclick={() => (managementMonth = shiftMonth(managementMonth, -1))}>‹</button>
      <strong>{monthLabel(managementMonth)}</strong>
      <button type="button" aria-label="下一个月" onclick={() => (managementMonth = shiftMonth(managementMonth, 1))}>›</button>
    </div>
    <section class="management-calendar" aria-label={monthLabel(managementMonth)}>
      <div class="calendar-weekdays" aria-hidden="true">
        {#each WEEKDAYS as weekday}<span>{weekday}</span>{/each}
      </div>
      <div class="calendar-grid">
        {#each managementCalendarDays as day (day.date)}
          <button
            type="button"
            class:outside={!day.inMonth}
            class:available={day.hasLedger}
            class:selected={day.date === selectedManagedDate}
            disabled={!day.inMonth || !day.hasLedger}
            aria-label={day.hasLedger ? `${day.date} 数据库有台账，查看管理操作` : `${day.date} 数据库无台账`}
            onclick={() => (selectedManagedDate = day.date)}
          >
            <span>{day.day}</span>
            <span class="sr-only">{day.hasLedger ? "有台账" : "无台账"}</span>
          </button>
        {/each}
      </div>
    </section>
    <section class="ledger-management-detail" aria-live="polite">
      {#if managedFile}
        <div>
          <strong>{managedFile.date}</strong>
          <span>{managedFile.fileName} · {(managedFile.size / 1024).toFixed(0)} KB</span>
        </div>
        <div class="ledger-management-actions">
          <button type="button" onclick={() => downloadManagedFile(managedFile)}>下载</button>
          <button type="button" disabled={uploading} onclick={() => openReupload(managedFile.date)}>重新上传</button>
          <button class="danger" type="button" disabled={deleting} onclick={() => removeRemoteLedger(managedFile)}>删除</button>
        </div>
      {:else if selectedManagedDate && selectedManagedDateHasLedger}
        <div>
          <strong>{selectedManagedDate}</strong>
          <span>数据库已有台账，暂无原始文件管理信息</span>
        </div>
      {:else}
        <strong>请选择有台账日期</strong>
      {/if}
    </section>
  </div>
</dialog>
