<script lang="ts">
  import ChartHost from "../../components/ChartHost.svelte";
  import { renderWorkbenchBarChart } from "../../charts/trading-research";
  import MetricCard from "./MetricCard.svelte";
  import WorkbenchIcon from "./WorkbenchIcon.svelte";
  import {
    creditSummary,
    demoMeta,
    fundingOverview,
    overviewAlerts,
    researchSnapshot,
    tradingSummary,
    workflowDemos,
  } from "./demo-data";

  const coverage = [
    { label: "交易快照", value: `${tradingSummary.tradeCount} 笔`, detail: demoMeta.tradingAsOf },
    { label: "授信快照", value: `${creditSummary.count} 条`, detail: demoMeta.creditAsOf },
    { label: "研究快照", value: "10 项校验", detail: `${demoMeta.researchStart}—${demoMeta.researchEnd}` },
    { label: "流程任务", value: `${workflowDemos.length} 条`, detail: "当前流程任务" },
  ];
  const dr007 = researchSnapshot.rates[1]!;
  const structureBars = [
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
    {
      label: "授信额度已使用",
      value: creditSummary.utilization,
      color: "#16a394",
    },
  ];
</script>

<div class="tr-view-stack">
  <section aria-labelledby="overview-metrics-title">
    <div class="tr-section-heading">
      <div>
        <span class="tr-section-mark" aria-hidden="true"></span>
        <h2 id="overview-metrics-title">经营全景</h2>
      </div>
      <span>不同业务按各自快照基准日展示</span>
    </div>
    <div class="tr-metric-grid">
      <MetricCard
        label="融入融出存量"
        value={fundingOverview.total.toFixed(1)}
        unit="亿元"
        detail={`融入 ${fundingOverview.borrowTotal.toFixed(1)} · 融出 ${fundingOverview.lendTotal.toFixed(1)}`}
        icon="funds"
        tone="orange"
      />
      <MetricCard
        label="当日成交金额"
        value={tradingSummary.totalAmount.toFixed(1)}
        unit="亿元"
        detail={`${tradingSummary.tradeCount} 笔 · 加权利率 ${tradingSummary.weightedRate.toFixed(2)}%`}
        icon="trading"
        tone="blue"
      />
      <MetricCard
        label="可用授信额度"
        value={creditSummary.available.toFixed(2)}
        unit="亿元"
        detail={`总体使用率 ${creditSummary.utilization.toFixed(1)}%`}
        icon="credit"
        tone="green"
      />
      <MetricCard
        label="DR007"
        value={dr007.value.toFixed(4)}
        unit="%"
        detail={`较前值 ${dr007.changeBp.toFixed(2)} bp`}
        icon="research"
        tone="purple"
      />
    </div>
  </section>

  <div class="tr-two-column">
    <section class="tr-panel" aria-labelledby="business-snapshot-title">
      <div class="tr-panel-heading">
        <div>
          <h2 id="business-snapshot-title">交易与授信结构</h2>
        </div>
        <span class="tr-badge tr-badge--info">多基准日</span>
      </div>
      <ChartHost
        renderer={renderWorkbenchBarChart}
        args={[structureBars, "交易品种与授信使用率结构", "%", 100]}
        ariaLabel="交易品种与授信使用率结构横向柱状图"
        className="tr-chart-host tr-chart-host--compact"
      />
    </section>

    <section class="tr-panel" aria-labelledby="coverage-title">
      <div class="tr-panel-heading">
        <div>
          <h2 id="coverage-title">数据覆盖</h2>
        </div>
        <span class="tr-status tr-status--success"><WorkbenchIcon name="check" />已校验</span>
      </div>
      <div class="tr-coverage-grid">
        {#each coverage as item}
          <article>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.detail}</small>
          </article>
        {/each}
      </div>
    </section>
  </div>

  <section class="tr-panel" aria-labelledby="overview-alerts-title">
    <div class="tr-panel-heading">
      <div>
        <h2 id="overview-alerts-title">待办与风险</h2>
      </div>
      <span class="tr-badge tr-badge--warning">{overviewAlerts.length} 项</span>
    </div>
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
