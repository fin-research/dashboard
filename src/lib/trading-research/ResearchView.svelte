<script lang="ts">
  import ChartHost from "../../components/ChartHost.svelte";
  import {
    renderWorkbenchCurveChart,
    renderWorkbenchHistoryChart,
  } from "../../charts/trading-research";
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
  <section class="tr-evidence-strip" aria-labelledby="research-evidence-title">
    <span class="tr-evidence-strip__icon" aria-hidden="true"><WorkbenchIcon name="check" /></span>
    <div>
      <h2 id="research-evidence-title">研究快照校验通过</h2>
    </div>
    <dl>
      <div><dt>校验结果</dt><dd>{researchSnapshot.validation.passedChecks}/10 通过</dd></div>
      <div><dt>生成方式</dt><dd>{researchSnapshot.validation.mode}</dd></div>
      <div><dt>规则版本</dt><dd>{researchSnapshot.validation.ruleVersion}</dd></div>
      <div><dt>复核状态</dt><dd>{researchSnapshot.validation.reviewStatus}</dd></div>
    </dl>
  </section>

  <section aria-labelledby="market-rates-title">
    <div class="tr-section-heading">
      <div><span class="tr-section-mark" aria-hidden="true"></span><h2 id="market-rates-title">核心市场利率</h2></div>
      <span>{demoMeta.researchStart}—{demoMeta.researchEnd}</span>
    </div>
    <div class="tr-rate-grid">
      {#each researchSnapshot.rates as rate}
        <article class="tr-rate-card">
          <div><span>{rate.label}</span><small>较前值</small></div>
          <strong>{rate.value.toFixed(4)}<em>%</em></strong>
          <span class={changeClass(rate.changeBp)}>{changeText(rate.changeBp)}</span>
        </article>
      {/each}
    </div>
  </section>

  <section class="tr-panel" aria-labelledby="rate-trend-title">
    <div class="tr-panel-heading">
      <div><h2 id="rate-trend-title">核心利率走势</h2></div>
      <span class="tr-badge tr-badge--neutral">最近10个有效观测日 · %</span>
    </div>
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
      <div class="tr-panel-heading"><div><h2 id="cd-curve-title">同业存单曲线</h2></div></div>
      <ChartHost
        renderer={renderWorkbenchCurveChart}
        args={["同业存单", researchSnapshot.cdCurve, "同业存单各期限收益率曲线"]}
        ariaLabel="同业存单各期限收益率曲线"
        className="tr-chart-host tr-chart-host--curve"
      />
    </section>
    <section class="tr-panel" aria-labelledby="gov-curve-title">
      <div class="tr-panel-heading"><div><h2 id="gov-curve-title">中债国债曲线</h2></div></div>
      <ChartHost
        renderer={renderWorkbenchCurveChart}
        args={["中债国债", researchSnapshot.govCurve, "中债国债各期限收益率曲线"]}
        ariaLabel="中债国债各期限收益率曲线"
        className="tr-chart-host tr-chart-host--curve"
      />
    </section>
  </div>

  <section class="tr-panel" aria-labelledby="research-coverage-title">
    <div class="tr-panel-heading">
      <div><h2 id="research-coverage-title">当前缺失数据范围</h2></div>
      <span class="tr-badge tr-badge--neutral">5 项缺失</span>
    </div>
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
