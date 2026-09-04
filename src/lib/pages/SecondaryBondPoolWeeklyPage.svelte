<script lang="ts">
  import { onMount } from "svelte";

  export let embedded = false;

  import "../../app.css";
  import "../../styles.css";
  import "../../bond-ledger.css";
  import "../../secondary-bond-pool.css";

  import {
    renderWeeklyPoolScaleLeverage,
    renderWeeklyTradingAllocation,
    renderWeeklyTradingMaturity,
    renderWeeklyYieldProfitTrend,
  } from "../../charts/bond-ledger";
  import ChartHost from "../../components/ChartHost.svelte";
  import MetricCard from "../../components/MetricCard.svelte";
  import MetricIcon from "../../components/MetricIcon.svelte";
  import ModuleCard from "../../components/ModuleCard.svelte";
  import { exportReportImage } from "../../export";
  import {
    emptyBondLedgerReport,
    isoWeek,
    previousBusinessWeekRange,
  } from "$lib/bond-ledger/analytics";
  import {
    calendarDays,
    monthLabel,
    monthStart,
    shiftMonth,
  } from "$lib/bond-ledger/calendar";
  import {
    formatDecimalPercent,
    formatWan,
    formatYears,
    formatYield,
    formatYi,
  } from "$lib/bond-ledger/format";
  import type { BondLedgerReport } from "$lib/bond-ledger/types";
  import { loadBondLedgerReport } from "$lib/bond-ledger/upload";
  import { globalMessages } from "$lib/global-messages";
  import { portal } from "$lib/portal";
  import PanelHeading from "$lib/trading-research/PanelHeading.svelte";
  import { currentReportDate } from "../../report-date";
  import type { MetricIconName } from "../../view-model";

  const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
  const DEFAULT_RANGE = previousBusinessWeekRange(currentReportDate());

  let analytics: BondLedgerReport = emptyBondLedgerReport();
  let startDate = DEFAULT_RANGE.startDate;
  let endDate = DEFAULT_RANGE.endDate;
  let loading = true;
  let exporting = false;
  let exportLabel = "导出图片";
  let exportTimer: number | null = null;
  let rangeOpen = false;
  let rangePhase: "start" | "end" = "start";
  let rangeMonthLeft = monthStart(startDate);
  let syncGeneration = 0;
  let reportSurface: HTMLElement;

  $: current = analytics.currentPerformance;
  $: currentOperating = analytics.operatingTrend.find(
    (point) => point.date === current?.date,
  ) ?? analytics.operatingTrend.at(-1) ?? null;
  $: rangePerformance = analytics.performanceTrend.filter(
    (point) =>
      point.date.slice(5) !== "01-01" &&
      point.date >= startDate &&
      point.date <= endDate,
  );
  $: rangeOperating = analytics.operatingTrend.filter(
    (point) => point.date >= startDate && point.date <= endDate,
  );
  $: tradingMarketValue = currentOperating?.tradingMarketValue ?? 0;
  $: availableMarketValue = currentOperating?.availableMarketValue ?? 0;
  $: calculatedLeverage =
    current && current.principal > 0
      ? analytics.detailMarketValue / current.principal
      : null;
  $: rangeRevenue = rangePerformance.reduce(
    (total, point) => total + point.dailyRevenue,
    0,
  );
  $: oneYearShare = analytics.tradingMaturityBuckets
    .slice(0, 5)
    .reduce((total, bucket) => total + bucket.share, 0);
  $: categorySummary = analytics.tradingHoldingTypes
    .slice(0, 3)
    .map((item) => `${item.category} ${(item.share * 100).toFixed(1)}%`)
    .join("、");
  $: reportWeek = isoWeek(current?.date ?? endDate);
  $: rangeMonths = [rangeMonthLeft, shiftMonth(rangeMonthLeft, 1)];
  $: metricCards = [
    {
      label: "业务本金",
      value: formatYi(current?.principal ?? null),
      detail: `时间加权 ${formatYi(current?.timeWeightedPrincipal ?? null)}`,
      tone: "blue" as const,
      icon: "bank" as MetricIconName,
    },
    {
      label: "全池持仓总市值",
      value: formatYi(analytics.detailMarketValue || null),
      detail: `交易户 ${formatYi(tradingMarketValue)} / 可供户 ${formatYi(availableMarketValue)}`,
      tone: "cyan" as const,
      icon: "bond" as MetricIconName,
    },
    {
      label: "全池综合杠杆率",
      value: formatDecimalPercent(calculatedLeverage),
      detail: `对比平层基准 ${formatSignedPercentagePoint(calculatedLeverage === null ? null : calculatedLeverage - 1)}`,
      tone: "purple" as const,
      icon: "leverage" as MetricIconName,
    },
    {
      label: "年化收益率（含免税）",
      value: formatDecimalPercent(
        currentOperating?.fullPoolYtdAnnualizedReturn ?? null,
        3,
      ),
      detail: `不含免税 ${formatDecimalPercent(currentOperating?.fullPoolYtdExTaxAnnualizedReturn ?? null, 3)} / 平层静态 ${formatStaticYield(currentOperating?.flatStatic ?? null)}`,
      tone: "teal" as const,
      icon: "profit" as MetricIconName,
    },
    {
      label: "累计毛利（含免税）",
      value: formatWan(current?.cumulativeProfit ?? null),
      detail: `免税增厚 ${formatWan(currentOperating?.cumulativeTaxExemptProfit ?? null)}`,
      tone: "orange" as const,
      icon: "equity" as MetricIconName,
    },
  ];

  onMount(() => {
    void refreshReport();
    return () => {
      if (exportTimer !== null) window.clearTimeout(exportTimer);
    };
  });

  async function refreshReport(): Promise<void> {
    const generation = ++syncGeneration;
    loading = true;
    try {
      const report = await loadBondLedgerReport(startDate, endDate);
      if (generation === syncGeneration) analytics = report;
    } catch (error) {
      if (generation !== syncGeneration) return;
      analytics = emptyBondLedgerReport();
      globalMessages.error(
        error instanceof Error ? error.message : String(error),
        { key: "secondary-bond-pool-error", title: "二级池周报读取失败" },
      );
    } finally {
      if (generation === syncGeneration) loading = false;
    }
  }

  function openRangePicker(event: MouseEvent): void {
    event.stopPropagation();
    rangeMonthLeft = monthStart(startDate);
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
    void refreshReport();
  }

  function isSelectedDate(date: string): boolean {
    return Boolean(startDate && endDate && date >= startDate && date <= endDate);
  }

  async function exportImage(): Promise<void> {
    if (!analytics.hasData || !analytics.auditPassed || exporting) return;
    exporting = true;
    exportLabel = "正在导出";
    try {
      await exportReportImage(reportSurface, current?.date ?? endDate, {
        captureClass: true,
        filename: `资金管理部-二级债券池运营周报-${current?.date ?? endDate}.png`,
      });
      globalMessages.success("二级债券池运营周报图片已导出", {
        key: "secondary-bond-pool-export",
        title: "导出完成",
      });
    } catch (error) {
      globalMessages.error(
        error instanceof Error ? error.message : String(error),
        { key: "secondary-bond-pool-export", title: "导出失败" },
      );
    } finally {
      exportTimer = window.setTimeout(() => {
        exporting = false;
        exportLabel = "导出图片";
      }, 1200);
    }
  }

  function formatSignedPercentagePoint(value: number | null): string {
    if (value === null || !Number.isFinite(value)) return "—";
    const sign = value > 0 ? "+" : value < 0 ? "−" : "";
    return `${sign}${Math.abs(value * 100).toFixed(2)} 个百分点`;
  }

  function formatStaticYield(value: number | null): string {
    return value === null || !Number.isFinite(value)
      ? "—"
      : `${value.toFixed(3)}%`;
  }

  function formatChineseDate(value: string): string {
    const [year, month, day] = value.split("-");
    return year && month && day ? `${year}年${month}月${day}日` : value;
  }

  function auditDifference(check: BondLedgerReport["auditChecks"][number]): string {
    const divisor = check.key === "leverage" ? 1 : 10_000;
    const digits = check.key === "leverage" ? 6 : 2;
    const unit = check.key === "leverage" ? "" : " 万元";
    return `${(check.difference / divisor).toFixed(digits)}${unit}`;
  }
</script>

<svelte:window onclick={closeRangeFromWindow} />

<svelte:head>
  <title>{embedded ? "二级债券池运营周报 · 交易研究工作台" : "二级债券池运营周报 · 资金管理部"}</title>
  <meta name="description" content="二级债券池运营周报" />
  <meta name="theme-color" content="#f6f8fb" />
</svelte:head>

<div class:secondary-weekly-shell--embedded={embedded} class="secondary-weekly-shell">
  <article bind:this={reportSurface} class="secondary-weekly-report">
    <header class="secondary-weekly-masthead">
      <div>
        <a class="secondary-weekly-portal" href="/" aria-label="返回市场研究门户">东方财富证券 · 资金管理部</a>
        <h1>二级债券池运营周报</h1>
        <p>
          报告基准日：{formatChineseDate(current?.date ?? endDate)}（{reportWeek.year}年第{reportWeek.week}周）
        </p>
      </div>

      <div
        class="weekly-report-actions"
        aria-label="日期范围与导出控制"
        use:portal={embedded ? "#tr-topbar-actions" : null}
      >
        <div class="ledger-range-picker">
          <button
            class="ledger-range-trigger"
            type="button"
            aria-label="选择周报数据范围"
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
            <div class="ledger-range-popover" role="dialog" aria-label="选择周报数据范围" tabindex="-1">
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

        <button
          class="secondary-weekly-export"
          class:is-exporting={exporting}
          type="button"
          disabled={!analytics.hasData || !analytics.auditPassed || loading || exporting}
          onclick={exportImage}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M10 3v9" /><path d="m6.5 8.7 3.5 3.6 3.5-3.6" /><path d="M4 14.5v2h12v-2" />
          </svg>
          <span>{exportLabel}</span>
        </button>
      </div>
    </header>

    {#if loading}
      <main class="secondary-weekly-state" aria-live="polite">
        <span class="loading-orbit" aria-hidden="true"></span>
        <strong>正在读取二级池周报数据</strong>
      </main>
    {:else if !analytics.hasData}
      <main class="secondary-weekly-state">
        <h2>所选范围暂无二级池数据</h2>
        <p>请在页头选择其他日期范围。</p>
      </main>
    {:else if !analytics.auditPassed}
      <main class="secondary-weekly-state secondary-weekly-state--audit">
        <h2>三维对账未全部通过，暂不生成周报</h2>
        <ul>
          {#each analytics.auditChecks.filter((check) => !check.pass) as check (check.key)}
            <li>{check.label}：差额 {auditDifference(check)}</li>
          {/each}
        </ul>
      </main>
    {:else}
      <main class="secondary-weekly-main">
        <section class="secondary-weekly-metrics" aria-label="二级债券池核心指标">
          {#each metricCards as card (card.label)}
            <MetricCard
              label={card.label}
              value={card.value}
              detail={card.detail}
              tone={card.tone}
              iconComponent={MetricIcon}
              iconProps={{ icon: card.icon }}
              iconPosition="start"
            />
          {/each}
        </section>

        <div class="secondary-weekly-columns">
          <div class="secondary-weekly-column secondary-weekly-column--primary">
            <ModuleCard class="secondary-weekly-panel" labelledBy="weekly-scale-title">
              <PanelHeading id="weekly-scale-title" title="规模演变与杠杆走势" controlsInline>
                <span class="secondary-weekly-panel-meta">{startDate}—{endDate}</span>
              </PanelHeading>
              <ChartHost
                renderer={renderWeeklyPoolScaleLeverage}
                args={[rangePerformance]}
                ariaLabel="所选区间业务本金、持仓市值、时间加权本金与杠杆走势"
                className="secondary-weekly-chart secondary-weekly-chart--trend"
              />
              <div class="secondary-weekly-analysis">
                <p><strong>规模概览：</strong>最新业务本金 {formatYi(current?.principal ?? null)}，全池持仓市值 {formatYi(analytics.detailMarketValue)}，综合杠杆率 {formatDecimalPercent(calculatedLeverage)}。</p>
                <p><strong>双户结构：</strong>交易户占全池市值 {formatDecimalPercent(analytics.detailMarketValue > 0 ? tradingMarketValue / analytics.detailMarketValue : null)}，可供户占 {formatDecimalPercent(analytics.detailMarketValue > 0 ? availableMarketValue / analytics.detailMarketValue : null)}；两户共同纳入 DV01 与损益核对。</p>
              </div>
            </ModuleCard>

            <ModuleCard class="secondary-weekly-panel" labelledBy="weekly-yield-title">
              <PanelHeading id="weekly-yield-title" title="收益率与累计创收归因" controlsInline>
                <span class="secondary-weekly-panel-meta">区间营收 {formatWan(rangeRevenue)}</span>
              </PanelHeading>
              <ChartHost
                renderer={renderWeeklyYieldProfitTrend}
                args={[rangeOperating]}
                ariaLabel="所选区间年化收益率、平层静态、累计毛利与免税增厚走势"
                className="secondary-weekly-chart secondary-weekly-chart--trend"
              />
              <div class="secondary-weekly-analysis">
                <p><strong>收益率：</strong>含免税年化收益率 {formatDecimalPercent(currentOperating?.fullPoolYtdAnnualizedReturn ?? null, 3)}，不含免税 {formatDecimalPercent(currentOperating?.fullPoolYtdExTaxAnnualizedReturn ?? null, 3)}，平层静态 {formatStaticYield(currentOperating?.flatStatic ?? null)}。</p>
                <p><strong>利润拆分：</strong>累计毛利（含免税）{formatWan(current?.cumulativeProfit ?? null)}，其中免税增厚 {formatWan(currentOperating?.cumulativeTaxExemptProfit ?? null)}；区间营收按所选日期内有效交易日汇总。</p>
              </div>
            </ModuleCard>
          </div>

          <div class="secondary-weekly-column secondary-weekly-column--secondary">
            <ModuleCard class="secondary-weekly-panel" labelledBy="weekly-allocation-title">
              <PanelHeading id="weekly-allocation-title" title="资产配置与期限分布" controlsInline>
                <span class="secondary-weekly-panel-meta">交易户 {formatYi(tradingMarketValue)}</span>
              </PanelHeading>
              <div class="secondary-weekly-allocation-grid">
                <ChartHost
                  renderer={renderWeeklyTradingAllocation}
                  args={[analytics.tradingHoldingTypes]}
                  ariaLabel="交易户资产类别结构"
                  className="secondary-weekly-chart secondary-weekly-chart--allocation"
                />
                <ChartHost
                  renderer={renderWeeklyTradingMaturity}
                  args={[analytics.tradingMaturityBuckets]}
                  ariaLabel="交易户剩余期限分布"
                  className="secondary-weekly-chart secondary-weekly-chart--allocation"
                />
              </div>
              <div class="secondary-weekly-analysis">
                <p><strong>资产类别：</strong>按交易户市值计算，主要类别为 {categorySummary || "—"}。</p>
                <p><strong>期限结构：</strong>交易户中 1 年以内资产占比 {formatDecimalPercent(oneYearShare)}；最新修正久期 {formatYears(current?.modifiedDuration ?? null)}，合并 DV01 {formatWan(currentOperating?.dv01 ?? null)} / BP。</p>
              </div>
            </ModuleCard>

            <ModuleCard class="secondary-weekly-panel" labelledBy="weekly-holdings-title">
              <PanelHeading id="weekly-holdings-title" title="核心重仓券速览" controlsInline>
                <span class="secondary-weekly-panel-meta">Top 5</span>
              </PanelHeading>
              <div class="secondary-weekly-table-wrap">
                <table class="secondary-weekly-table">
                  <thead><tr><th>券名</th><th>类别</th><th>期限</th><th>市值</th><th>收益率</th></tr></thead>
                  <tbody>
                    {#each analytics.topTradingPositions as position (position.name)}
                      <tr>
                        <th scope="row">{position.name}</th>
                        <td>{position.category}</td>
                        <td>{position.remainingYears === null ? "—" : `${position.remainingYears.toFixed(2)}Y`}</td>
                        <td>{formatYi(position.marketValue)}</td>
                        <td>{formatYield(position.reportYield)}</td>
                      </tr>
                    {:else}
                      <tr><td colspan="5">暂无有效交易户持仓</td></tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </ModuleCard>

            <ModuleCard class="secondary-weekly-panel secondary-weekly-focus" labelledBy="weekly-focus-title">
              <PanelHeading id="weekly-focus-title" title="后续跟踪重点" />
              <ol>
                <li><strong>规模与杠杆：</strong>跟踪业务本金、持仓规模和回购资金变化，确认杠杆是否处于业务允许区间。</li>
                <li><strong>利率风险：</strong>同步观察修正久期、全池 DV01、收益率曲线和资金利率变化。</li>
                <li><strong>流动性：</strong>跟踪 1 年内资产占比、存单到期与可供户配置变化。</li>
                <li><strong>质量控制：</strong>下一期先完成规模、杠杆和损益三维对账，再更新报告。</li>
              </ol>
            </ModuleCard>
          </div>
        </div>
      </main>
    {/if}

    <footer class="secondary-weekly-footer">资金管理部 · 二级债券池内部报告</footer>
  </article>
</div>
