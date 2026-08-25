<script lang="ts">
  import MetricCard from "./MetricCard.svelte";
  import WorkbenchIcon from "./WorkbenchIcon.svelte";
  import {
    creditAlerts,
    creditSummary,
    demoCreditLines,
    demoMeta,
  } from "./demo-data";

  let query = $state("");
  let risk = $state("all");

  const filteredLines = $derived.by(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return demoCreditLines.filter((line) => {
      const matchesQuery =
        !normalizedQuery ||
        [line.bank, line.bankType, line.creditType]
          .join(" ")
          .toLocaleLowerCase("zh-CN")
          .includes(normalizedQuery);
      const matchesRisk =
        risk === "all" ||
        (risk === "warning" && line.utilization >= 80) ||
        (risk === "attention" && line.utilization >= 60);
      return matchesQuery && matchesRisk;
    });
  });

  function utilizationTone(value: number): string {
    if (value >= 80) return "danger";
    if (value >= 60) return "warning";
    return "normal";
  }
</script>

<div class="tr-view-stack">
  <section aria-labelledby="credit-metrics-title">
    <div class="tr-section-heading">
      <div><span class="tr-section-mark" aria-hidden="true"></span><h2 id="credit-metrics-title">授信总览</h2></div>
      <span>数据截至 {demoMeta.creditAsOf} · 共 {creditSummary.count} 条发布范围记录</span>
    </div>
    <div class="tr-metric-grid tr-metric-grid--five">
      <MetricCard label="授信总额度" value={creditSummary.total.toFixed(2)} unit="亿元" detail={`${creditSummary.count} 条明细`} icon="credit" tone="blue" />
      <MetricCard label="已使用额度" value={creditSummary.used.toFixed(2)} unit="亿元" detail={`使用率 ${creditSummary.utilization.toFixed(1)}%`} icon="funds" tone="orange" />
      <MetricCard label="可用额度" value={creditSummary.available.toFixed(2)} unit="亿元" detail="总额度减已使用" icon="check" tone="green" />
      <MetricCard label="近30日到期" value={String(creditSummary.expiring30)} unit="笔" detail="按快照生成口径" icon="calendar" tone="purple" />
      <MetricCard label="80%预警" value="4" unit="家" detail="另有13家超过60%" icon="warning" tone="red" />
    </div>
  </section>

  <section class="tr-reconciliation" aria-labelledby="reconciliation-title">
    <div class="tr-reconciliation__status">
      <span aria-hidden="true"><WorkbenchIcon name="check" /></span>
      <div><h2 id="reconciliation-title">授信口径校验通过</h2></div>
    </div>
    <dl>
      <div><dt>周报发布口径</dt><dd>{creditSummary.total.toFixed(2)} <small>亿元</small></dd></div>
      <div><dt>主表有效记录</dt><dd>{creditSummary.mainTableTotal.toFixed(2)} <small>亿元</small></dd></div>
      <div><dt>范围调整</dt><dd>{creditSummary.scopeAdjustment.toFixed(2)} <small>亿元</small></dd></div>
    </dl>
    <p>已排除当前授信周报名单外的历史或合并机构记录 2.00 亿元。</p>
  </section>

  <div class="tr-two-column tr-two-column--credit">
    <section class="tr-panel" aria-labelledby="credit-risk-title">
      <div class="tr-panel-heading">
        <div><h2 id="credit-risk-title">高使用率机构</h2></div>
        <span class="tr-badge tr-badge--neutral">风险优先样例 · 12/120</span>
      </div>
      <div class="tr-usage-list">
        {#each demoCreditLines.slice(0, 6) as line}
          <div>
            <div><span>{line.bank}</span><strong>{line.utilization.toFixed(1)}%</strong></div>
            <div class="tr-usage-track" aria-label={`${line.bank}授信使用率 ${line.utilization.toFixed(1)}%`}>
              <span class={`tr-usage-fill tr-usage-fill--${utilizationTone(line.utilization)}`} style={`width: ${line.utilization}%`}></span>
              <i class="tr-threshold tr-threshold--attention" aria-hidden="true"></i>
              <i class="tr-threshold tr-threshold--warning" aria-hidden="true"></i>
            </div>
          </div>
        {/each}
        <div class="tr-threshold-legend" aria-label="使用率阈值">
          <span><i class="is-attention"></i>60% 关注</span>
          <span><i class="is-warning"></i>80% 预警</span>
        </div>
      </div>
    </section>

    <section class="tr-panel" aria-labelledby="credit-alert-title">
      <div class="tr-panel-heading">
        <div><h2 id="credit-alert-title">授信预警</h2></div>
        <span class="tr-badge tr-badge--warning">{creditAlerts.length} 项</span>
      </div>
      <div class="tr-compact-alerts">
        {#each creditAlerts as alert}
          <article>
            <span aria-hidden="true"><WorkbenchIcon name="warning" /></span>
            <div><p>{alert.text}</p><small>{alert.eventAt}</small></div>
          </article>
        {/each}
      </div>
    </section>
  </div>

  <section class="tr-panel" aria-labelledby="credit-table-title">
    <div class="tr-panel-heading tr-panel-heading--wrap">
      <div><h2 id="credit-table-title">授信明细</h2></div>
      <div class="tr-table-controls" role="search">
        <label class="tr-search-control">
          <span class="sr-only">搜索授信机构</span>
          <WorkbenchIcon name="search" />
          <input bind:value={query} type="search" placeholder="机构、性质或授信类型" />
        </label>
        <label>
          <span class="sr-only">授信风险</span>
          <select bind:value={risk}>
            <option value="all">全部风险</option>
            <option value="attention">关注及以上</option>
            <option value="warning">预警</option>
          </select>
        </label>
        <span class="tr-result-count">{filteredLines.length} 条</span>
      </div>
    </div>
    <div class="tr-table-scroll">
      <table class="tr-data-table">
        <caption class="sr-only">授信风险优先样例明细</caption>
        <thead><tr><th>机构</th><th>性质</th><th>授信类型</th><th class="is-numeric">总额度</th><th class="is-numeric">已使用</th><th class="is-numeric">可用</th><th class="is-numeric">使用率</th><th>到期日</th></tr></thead>
        <tbody>
          {#each filteredLines as line (line.bank)}
            <tr>
              <th scope="row">{line.bank}</th>
              <td>{line.bankType}</td>
              <td>{line.creditType}</td>
              <td class="is-numeric">{line.total.toFixed(1)}</td>
              <td class="is-numeric">{line.used.toFixed(1)}</td>
              <td class="is-numeric">{line.available.toFixed(1)}</td>
              <td class="is-numeric"><span class={`tr-utilization tr-utilization--${utilizationTone(line.utilization)}`}>{line.utilization.toFixed(1)}%</span></td>
              <td>{line.expiry ?? "待补录"}</td>
            </tr>
          {:else}
            <tr><td class="tr-empty-cell" colspan="8">没有符合当前筛选条件的授信记录</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  <section class="tr-empty-panel" aria-labelledby="credit-history-title">
    <WorkbenchIcon name="database" />
    <div><h2 id="credit-history-title">暂无可核验的历史授信序列</h2><p>源工作簿只提供当前快照，接入数据库后再展示近12个月额度趋势。</p></div>
  </section>
</div>
