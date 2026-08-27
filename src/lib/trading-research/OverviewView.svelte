<script lang="ts">
  import { onMount } from "svelte";

  import ChartHost from "../../components/ChartHost.svelte";
  import MetricCard from "../../components/MetricCard.svelte";
  import { renderWorkbenchBarChart } from "../../charts/trading-research";
  import { fetchCreditReport } from "../credit/client.ts";
  import type { CreditReportResponse } from "../credit/types.ts";
  import Badge from "./Badge.svelte";
  import PanelHeading from "./PanelHeading.svelte";
  import SectionHeading from "./SectionHeading.svelte";
  import WorkbenchIcon from "./WorkbenchIcon.svelte";
  import {
    fundingOverview,
    overviewAlerts,
    researchSnapshot,
    tradingSummary,
  } from "./demo-data";

  const dr007 = researchSnapshot.rates[1]!;
  let creditReport = $state<CreditReportResponse | null>(null);
  const structureBars = $derived.by(() => [
      {
        label: "同业拆借",
        value: tradingSummary.interbankShare,
        color: "#2f6fed",
      },
      {
        label: "质押式回购",
        value: 100 - tradingSummary.interbankShare,
        color: "#f79009",
      },
      ...(creditReport
        ? [{
            label: "授信额度已使用",
            value: creditReport.summary.utilization,
            color: "#16a394",
          }]
        : []),
    ]);

  onMount(() => {
    void fetchCreditReport().then((report) => {
      creditReport = report;
    }).catch(() => undefined);
  });
</script>

<div class="tr-view-stack">
  <section aria-labelledby="overview-metrics-title">
    <SectionHeading
      id="overview-metrics-title"
      title="经营全景"
      meta="不同业务按各自快照基准日展示"
    />
    <div class="tr-metric-grid">
      <MetricCard
        label="融入融出存量"
        value={fundingOverview.total.toFixed(1)}
        unit="亿元"
        detail={`融入 ${fundingOverview.borrowTotal.toFixed(1)} · 融出 ${fundingOverview.lendTotal.toFixed(1)}`}
        iconComponent={WorkbenchIcon}
        iconProps={{ name: "funds" }}
        tone="orange"
      />
      <MetricCard
        label="当日成交金额"
        value={tradingSummary.totalAmount.toFixed(1)}
        unit="亿元"
        detail={`${tradingSummary.tradeCount} 笔 · 加权利率 ${tradingSummary.weightedRate.toFixed(2)}%`}
        iconComponent={WorkbenchIcon}
        iconProps={{ name: "trading" }}
        tone="blue"
      />
      <MetricCard
        label="可用授信额度"
        value={creditReport ? creditReport.summary.totalAvailable.toFixed(2) : "—"}
        unit="亿元"
        detail={creditReport ? `截至 ${creditReport.summary.reportDate} · 使用率 ${creditReport.summary.utilization.toFixed(1)}%` : "进入授信管理查看最新记录"}
        iconComponent={WorkbenchIcon}
        iconProps={{ name: "credit" }}
        tone="green"
      />
      <MetricCard
        label="DR007"
        value={dr007.value.toFixed(4)}
        unit="%"
        detail={`较前值 ${dr007.changeBp.toFixed(2)} bp`}
        iconComponent={WorkbenchIcon}
        iconProps={{ name: "research" }}
        tone="purple"
      />
    </div>
  </section>

  <section class="tr-panel" aria-labelledby="business-snapshot-title">
    <PanelHeading id="business-snapshot-title" title="交易与授信结构">
      <Badge tone="info">多基准日</Badge>
    </PanelHeading>
    <ChartHost
      renderer={renderWorkbenchBarChart}
      args={[structureBars, "交易品种与授信使用率结构", "%", 100]}
      ariaLabel="交易品种与授信使用率结构横向柱状图"
      className="tr-chart-host tr-chart-host--compact"
    />
  </section>

  <section class="tr-panel" aria-labelledby="overview-alerts-title">
    <PanelHeading id="overview-alerts-title" title="待办与风险">
      <Badge tone="warning">{overviewAlerts.length} 项</Badge>
    </PanelHeading>
    <div class="tr-alert-list">
      {#each overviewAlerts as alert}
        <article class={`tr-alert tr-alert--${alert.level}`}>
          <span class="tr-alert__icon" aria-hidden="true"><WorkbenchIcon name="warning" /></span>
          <div>
            <div class="tr-alert__meta">
              <strong>{alert.category}</strong>
              <span>{alert.owner}</span>
              <time>{alert.eventAt}</time>
            </div>
            <p>{alert.text}</p>
          </div>
        </article>
      {/each}
    </div>
  </section>
</div>
