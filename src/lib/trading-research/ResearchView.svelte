<script lang="ts">
  import ChartHost from "../../components/ChartHost.svelte";
  import MetricCard from "../../components/MetricCard.svelte";
  import {
    renderWorkbenchCurveChart,
    renderWorkbenchHistoryChart,
  } from "../../charts/trading-research";
  import Badge from "./Badge.svelte";
  import PanelHeading from "./PanelHeading.svelte";
  import SectionHeading from "./SectionHeading.svelte";
  import WorkbenchIcon from "./WorkbenchIcon.svelte";
  import { demoMeta, researchSnapshot } from "./demo-data";

  const historyChart = {
    dates: researchSnapshot.history.dates,
    series: [
      { name: "DR007", values: researchSnapshot.history.dr007 },
      { name: "R007", values: researchSnapshot.history.r007 },
      { name: "GC001", values: researchSnapshot.history.gc001 },
    ],
  };
  const rateTones = ["blue", "orange", "purple", "green"] as const;

  function changeText(value: number): string {
    return `${value > 0 ? "+" : ""}${value.toFixed(2)} bp`;
  }

  function changeClass(value: number): string {
    if (value > 0) return "tr-change tr-change--up";
    if (value < 0) return "tr-change tr-change--down";
    return "tr-change";
  }
</script>

<div class="tr-view-stack">
  <section aria-labelledby="market-rates-title">
    <SectionHeading
      id="market-rates-title"
      title="核心市场利率"
      meta={`${demoMeta.researchStart}—${demoMeta.researchEnd}`}
    />
    <div class="tr-metric-grid">
      {#each researchSnapshot.rates as rate, index}
        <MetricCard
          label={rate.label}
          value={rate.value.toFixed(4)}
          unit="%"
          detail={changeText(rate.changeBp)}
          detailPrefix="较前值 "
          detailTone={changeClass(rate.changeBp)}
          iconComponent={WorkbenchIcon}
          iconProps={{ name: "research" }}
          tone={rateTones[index] ?? "blue"}
        />
      {/each}
    </div>
  </section>

  <section class="tr-panel" aria-labelledby="rate-trend-title">
    <PanelHeading id="rate-trend-title" title="核心利率走势">
      <Badge>最近10个有效观测日 · %</Badge>
    </PanelHeading>
    <ChartHost
      renderer={renderWorkbenchHistoryChart}
      args={[historyChart, "2026年8月3日至8月14日DR007、R007与GC001利率走势"]}
      ariaLabel="2026年8月3日至8月14日DR007、R007与GC001利率走势"
      className="tr-chart-host"
    />
    <details class="tr-chart-data">
      <summary>查看图表数据</summary>
      <div class="tr-table-scroll">
        <table class="tr-data-table">
          <thead><tr><th>日期</th><th class="is-numeric">DR007</th><th class="is-numeric">R007</th><th class="is-numeric">GC001</th></tr></thead>
          <tbody>
            {#each researchSnapshot.history.dates as date, index}
              <tr><th scope="row">{date}</th><td class="is-numeric">{researchSnapshot.history.dr007[index]?.toFixed(4)}</td><td class="is-numeric">{researchSnapshot.history.r007[index]?.toFixed(4)}</td><td class="is-numeric">{researchSnapshot.history.gc001[index]?.toFixed(4)}</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    </details>
  </section>

  <div class="tr-two-column">
    <section class="tr-panel" aria-labelledby="cd-curve-title">
      <PanelHeading id="cd-curve-title" title="同业存单曲线" />
      <ChartHost
        renderer={renderWorkbenchCurveChart}
        args={["同业存单", researchSnapshot.cdCurve, "同业存单各期限收益率曲线"]}
        ariaLabel="同业存单各期限收益率曲线"
        className="tr-chart-host tr-chart-host--curve"
      />
    </section>
    <section class="tr-panel" aria-labelledby="gov-curve-title">
      <PanelHeading id="gov-curve-title" title="中债国债曲线" />
      <ChartHost
        renderer={renderWorkbenchCurveChart}
        args={["中债国债", researchSnapshot.govCurve, "中债国债各期限收益率曲线"]}
        ariaLabel="中债国债各期限收益率曲线"
        className="tr-chart-host tr-chart-host--curve"
      />
    </section>
  </div>

  <section class="tr-panel" aria-labelledby="research-coverage-title">
    <PanelHeading id="research-coverage-title" title="当前缺失数据范围">
      <Badge>5 项缺失</Badge>
    </PanelHeading>
    <div class="tr-unavailable-grid">
      {#each researchSnapshot.unavailable as item}
        <article>
          <span aria-hidden="true"><WorkbenchIcon name="database" /></span>
          <div><h3>{item.label}</h3><p>{item.reason}</p></div>
        </article>
      {/each}
    </div>
  </section>
</div>
