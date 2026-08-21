<script lang="ts">
  import { onMount } from "svelte";

  import "../../../app.css";
  import "../../../styles.css";
  import "../../../bond-ledger.css";

  import {
    renderBondScaleReturnTrend,
    renderHoldingDistribution,
    renderMaturityDistribution,
  } from "../../../charts/bond-ledger";
  import ChartHost from "../../../components/ChartHost.svelte";
  import MetricIcon from "../../../components/MetricIcon.svelte";
  import { exportReportImage } from "../../../export";
  import {
    buildBondLedgerAnalytics,
    weekRange,
  } from "$lib/bond-ledger/analytics";
  import {
    calendarDays,
    monthLabel,
    monthStart,
    resolveAvailableRange,
    shiftDate,
    shiftMonth,
  } from "$lib/bond-ledger/calendar";
  import {
    deleteLocalBondLedger,
    listBondLedgers,
    putBondLedger,
  } from "$lib/bond-ledger/db";
  import {
    formatDecimalPercent,
    formatSignedWan,
    formatYears,
    formatYi,
  } from "$lib/bond-ledger/format";
  import { parseBondLedgerFile } from "$lib/bond-ledger/parser";
  import type { BondLedgerRecord } from "$lib/bond-ledger/types";
  import {
    archiveBondLedgerFile,
    deleteRemoteBondLedger,
    downloadRemoteBondLedger,
    fetchRemoteBondLedgerFile,
    listRemoteBondLedgers,
    type RemoteBondLedgerFile,
  } from "$lib/bond-ledger/upload";
  import { currentReportDate } from "../../../report-date";
  import type { MetricIconName } from "../../../view-model";

  const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

  let records: BondLedgerRecord[] = [];
  let remoteFiles: RemoteBondLedgerFile[] = [];
  let startDate = "";
  let endDate = "";
  let loadingRecords = true;
  let syncingRecords = false;
  let uploading = false;
  let deleting = false;
  let uploadMessage = "";
  let errorMessage = "";
  let rangeOpen = false;
  let rangePhase: "start" | "end" = "start";
  let rangeMonthLeft = "";
  let managementMonth = "";
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

  $: analytics = buildBondLedgerAnalytics(records, startDate, endDate);
  $: current = analytics.currentPerformance;
  $: isDefaultWeek = isCurrentWeek(startDate, endDate);
  $: rangeMonths = [rangeMonthLeft, shiftMonth(rangeMonthLeft, 1)];
  $: managedFile =
    remoteFiles.find((file) => file.date === selectedManagedDate) ?? null;
  $: metricCards = [
    {
      label: "当前规模",
      value: formatYi(current?.marketValue ?? null),
      detail: signedYi(analytics.metricDeltas.marketValue),
      delta: analytics.metricDeltas.marketValue,
      icon: "bank" as MetricIconName,
    },
    {
      label: "杠杆率",
      value: formatDecimalPercent(current?.leverage ?? null),
      detail: signedNumber(analytics.metricDeltas.leverage, 2, "x"),
      delta: analytics.metricDeltas.leverage,
      icon: "leverage" as MetricIconName,
    },
    {
      label: "修正久期",
      value: formatYears(current?.modifiedDuration ?? null),
      detail: signedNumber(analytics.metricDeltas.modifiedDuration, 2, "年"),
      delta: analytics.metricDeltas.modifiedDuration,
      icon: "bond" as MetricIconName,
    },
    {
      label: "年初至今收益率",
      value: formatDecimalPercent(analytics.ytdAnnualizedReturn),
      detail: signedPercentagePoint(
        analytics.metricDeltas.ytdAnnualizedReturn,
      ),
      delta: analytics.metricDeltas.ytdAnnualizedReturn,
      icon: "equity" as MetricIconName,
    },
    {
      label: isDefaultWeek ? "本周损益" : "区间损益",
      value: formatSignedWan(analytics.rangeProfit),
      detail: formatSignedWan(analytics.metricDeltas.rangeProfit),
      delta: analytics.metricDeltas.rangeProfit,
      icon: "profit" as MetricIconName,
    },
    {
      label: isDefaultWeek ? "本周交易" : "区间交易",
      value: `${analytics.transactionCount} 只`,
      detail: signedNumber(analytics.metricDeltas.transactionCount, 0, "只"),
      delta: analytics.metricDeltas.transactionCount,
      icon: "trade" as MetricIconName,
    },
  ];

  onMount(() => {
    const today = currentReportDate();
    const range = weekRange(today);
    startDate = range.startDate;
    endDate = range.endDate;
    rangeMonthLeft = monthStart(startDate);
    managementMonth = monthStart(today);
    void syncRangeFromRemote(true);
    return () => {
      if (exportTimer !== null) window.clearTimeout(exportTimer);
    };
  });

  async function syncRangeFromRemote(allowFallback: boolean): Promise<void> {
    const generation = ++syncGeneration;
    syncingRecords = true;
    if (loadingRecords) errorMessage = "";
    try {
      const inventory = await listRemoteBondLedgers();
      if (generation !== syncGeneration) return;
      remoteFiles = inventory.files;
      const resolved = resolveAvailableRange(
        remoteFiles.map((file) => file.date),
        startDate,
        endDate,
      );
      if (!resolved) {
        records = [];
        return;
      }
      if (resolved.fellBack && allowFallback) {
        startDate = resolved.startDate;
        endDate = resolved.endDate;
        rangeMonthLeft = monthStart(startDate);
        uploadMessage = `所选范围无线上台账，已回退至 ${startDate}—${endDate}`;
      }
      const comparisonStart = shiftDate(startDate, -7);
      const comparisonEnd = shiftDate(endDate, -7);
      const needed = remoteFiles.filter(
        (file) =>
          isWithin(file.date, startDate, endDate) ||
          isWithin(file.date, comparisonStart, comparisonEnd),
      );
      const neededStart = comparisonStart < startDate ? comparisonStart : startDate;
      const neededEnd = comparisonEnd > endDate ? comparisonEnd : endDate;
      const remoteDates = new Set(needed.map((file) => file.date));
      const local = await listBondLedgers();
      for (const record of local) {
        if (
          isWithin(record.date, neededStart, neededEnd) &&
          !remoteDates.has(record.date)
        ) {
          await deleteLocalBondLedger(record.date);
        }
      }
      const errors: string[] = [];
      for (const remote of needed) {
        try {
          const file = await fetchRemoteBondLedgerFile(remote);
          const parsed = await parseBondLedgerFile(file);
          if (parsed.date !== remote.date) {
            throw new Error(`文件报表日为 ${parsed.date}`);
          }
          await putBondLedger({
            ...parsed,
            fileName: remote.fileName,
            fileSize: remote.size,
            fileBlob: file,
            uploadedAt: remote.uploadedAt,
            cloudStored: true,
            cloudKey: remote.key,
          });
        } catch (error) {
          errors.push(
            `${remote.date}：${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      if (generation !== syncGeneration) return;
      records = await listBondLedgers();
      if (errors.length) errorMessage = errors.join("；");
    } catch (error) {
      if (generation !== syncGeneration) return;
      errorMessage = error instanceof Error ? error.message : String(error);
      records = await listBondLedgers().catch(() => []);
    } finally {
      if (generation === syncGeneration) {
        loadingRecords = false;
        syncingRecords = false;
      }
    }
  }

  async function refreshRemoteFiles(): Promise<void> {
    const inventory = await listRemoteBondLedgers();
    remoteFiles = inventory.files;
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
        const parsed = await parseBondLedgerFile(file);
        if (target && parsed.date !== target) {
          throw new Error(`重新上传文件的报表日必须为 ${target}`);
        }
        await archiveBondLedgerFile(file, parsed.date);
        successCount += 1;
        if (parsed.date > latestUploadedDate) latestUploadedDate = parsed.date;
      } catch (error) {
        errors.push(
          `${file.name}：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    try {
      await refreshRemoteFiles();
      records = await listBondLedgers();
      if (latestUploadedDate) {
        managementMonth = monthStart(latestUploadedDate);
        selectedManagedDate = latestUploadedDate;
      }
      if (
        latestUploadedDate &&
        isWithin(latestUploadedDate, startDate, endDate)
      ) {
        await syncRangeFromRemote(false);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    } finally {
      uploading = false;
    }
    uploadMessage = successCount
      ? `已上传 ${successCount} 份线上台账，重复日期已覆盖`
      : "";
    if (errors.length) errorMessage = errors.join("；");
  }

  async function removeRemoteLedger(remote: RemoteBondLedgerFile): Promise<void> {
    if (deleting) return;
    const confirmed = window.confirm(
      `删除 ${remote.date} 的线上台账？删除后无法恢复。`,
    );
    if (!confirmed) return;
    deleting = true;
    errorMessage = "";
    try {
      await deleteRemoteBondLedger(remote.date);
      await deleteLocalBondLedger(remote.date);
      await refreshRemoteFiles();
      selectedManagedDate = "";
      uploadMessage = `已删除 ${remote.date} 线上台账`;
      await syncRangeFromRemote(true);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      deleting = false;
    }
  }

  async function openManagement(): Promise<void> {
    managementDialog.showModal();
    try {
      await refreshRemoteFiles();
      const latest = remoteFiles.at(-1);
      if (latest) {
        managementMonth = monthStart(latest.date);
        selectedManagedDate = latest.date;
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
    void syncRangeFromRemote(true);
  }

  async function exportImage(): Promise<void> {
    if (!analytics.latestLedger || exporting) return;
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

  function signedYi(value: number | null): string {
    if (value === null || !Number.isFinite(value)) return "—";
    return `${sign(value)}${(Math.abs(value) / 100_000_000).toFixed(2)} 亿元`;
  }

  function signedPercentagePoint(value: number | null): string {
    if (value === null || !Number.isFinite(value)) return "—";
    return `${sign(value)}${(Math.abs(value) * 100).toFixed(2)}pct`;
  }

  function signedNumber(
    value: number | null,
    digits: number,
    suffix: string,
  ): string {
    if (value === null || !Number.isFinite(value)) return "—";
    return `${sign(value)}${Math.abs(value).toFixed(digits)}${suffix}`;
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
        <a class="ledger-back" href="/" aria-label="返回市场研究首页">
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
          disabled={!analytics.latestLedger || loadingRecords || exporting}
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
      {#if syncingRecords && !loadingRecords}<p>正在同步线上台账</p>{/if}
      {#if uploadMessage}<p class="ledger-status-success">{uploadMessage}</p>{/if}
      {#if errorMessage}<p class="ledger-status-error" role="alert">{errorMessage}</p>{/if}
    </div>

    {#if loadingRecords}
      <main class="ledger-loading" aria-live="polite">
        <span class="loading-orbit" aria-hidden="true"></span>
        <strong>正在同步线上台账</strong>
      </main>
    {:else if !analytics.latestLedger}
      <main class="ledger-empty">
        <div class="ledger-empty-icon" aria-hidden="true">
          <svg viewBox="0 0 48 48">
            <path d="M10 6h21l7 7v29H10z" />
            <path d="M31 6v8h8M16 23h16M16 29h16M16 35h10" />
          </svg>
        </div>
        <h2>线上暂无台账</h2>
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
                <small>较上周 <b class={deltaClass(card.delta)}>{card.detail}</b></small>
              </div>
            </article>
          {/each}
        </section>

        <div class="ledger-chart-grid">
          <section class="dashboard-panel ledger-panel ledger-panel--trend" aria-labelledby="return-trend-title">
            <header class="panel-heading ledger-panel-heading">
              <h2 id="return-trend-title">规模&amp;收益率走势</h2>
              <time datetime={analytics.latestLedger.date}>截至 {analytics.latestLedger.date}</time>
            </header>
            <ChartHost
              renderer={renderBondScaleReturnTrend}
              args={[analytics.performanceTrend, startDate, endDate]}
              ariaLabel="二级池规模与每日年化收益率走势"
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

        <section class="dashboard-panel ledger-panel" aria-labelledby="positions-title">
          <header class="panel-heading ledger-panel-heading">
            <h2 id="positions-title">持仓明细</h2>
          </header>
          <div class="ledger-table-wrap">
            <table class="ledger-table ledger-table--positions">
              <thead>
                <tr>
                  <th>债券代码</th>
                  <th>债券名称</th>
                  <th>债券类型</th>
                  <th>规模</th>
                  <th>剩余期限</th>
                  <th>收益率变动</th>
                  <th>{isDefaultWeek ? "本周损益" : "区间损益"}</th>
                  <th>累计损益</th>
                </tr>
              </thead>
              <tbody>
                {#each analytics.currentPositions as position (`${position.code}-${position.name}`)}
                  <tr>
                    <td>{position.code}</td>
                    <th scope="row">{position.name}</th>
                    <td>{position.category}</td>
                    <td>{formatYi(position.marketValue)}</td>
                    <td>{formatYears(position.remainingYears)}</td>
                    <td class={deltaClass(position.yieldChangeBp)}>{position.yieldChangeBp === null ? "-" : `${sign(position.yieldChangeBp)}${Math.abs(position.yieldChangeBp).toFixed(2)} BP`}</td>
                    <td class={deltaClass(position.rangeProfit)}>{formatSignedWan(position.rangeProfit)}</td>
                    <td class={deltaClass(position.ytdProfit)}>{formatSignedWan(position.ytdProfit)}</td>
                  </tr>
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
      <span>{remoteFiles.length} 个线上台账日</span>
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
        {#each calendarDays(managementMonth) as day (day.date)}
          {@const remote = remoteForDate(day.date)}
          <button
            type="button"
            class:outside={!day.inMonth}
            class:available={Boolean(remote)}
            class:selected={day.date === selectedManagedDate}
            disabled={!day.inMonth || !remote}
            aria-label={remote ? `${day.date} 已上传，查看管理操作` : `${day.date} 无台账`}
            onclick={() => (selectedManagedDate = day.date)}
          >
            <span>{day.day}</span>
            {#if remote}<i>已上传</i>{/if}
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
      {:else}
        <strong>请选择已上传日期</strong>
      {/if}
    </section>
  </div>
</dialog>
