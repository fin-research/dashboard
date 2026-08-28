<script lang="ts">
  import { onMount } from "svelte";

  export let embedded = false;

  import "../../app.css";
  import "../../styles.css";

  import { renderFinancingForecast } from "../../charts/financing-model";
  import ChartHost from "../../components/ChartHost.svelte";
  import MetricCard from "../../components/MetricCard.svelte";
  import MetricIcon from "../../components/MetricIcon.svelte";
  import {
    companyBusinessNarrative,
    conclusionSchema,
    parseFinancingModelReport,
    sellSidePayloadSchema,
    type FinancingModelConclusion,
    type FinancingModelReport,
  } from "$lib/financing-model";
  import { globalMessages } from "$lib/global-messages";
  import { portal } from "$lib/portal";
  import type { MetricIconName } from "../../view-model";

  let report: FinancingModelReport | null = null;
  let loading = true;
  let saving = false;
  let savingSellSide = false;
  let generatingResearch = false;
  let editingConclusion = false;
  let editingSellSide = false;
  let futureWindowDetailsOpen = false;
  let errorMessage = "";
  let editVerdict = "";
  let editNarrative = "";
  let editSellSideSummary = "";

  $: snapshot = report?.snapshot ?? null;
  $: company = snapshot?.company_metrics ?? null;
  $: validation = snapshot?.validation ?? null;
  $: marketDrivers = snapshot?.market_drivers.slice(0, 5) ?? [];
  $: metrics = snapshot
    ? [
        {
          label: "利差偏离",
          value: formatSigned(snapshot.prediction.deviation_bp, 2),
          unit: "bp",
          tone: snapshot.prediction.deviation_bp <= 0 ? "good" : "bad",
          detail:
            snapshot.prediction.deviation_bp <= 0
              ? "低于可比债中位数"
              : "高于可比债中位数",
          icon: "trade" as MetricIconName,
        },
        {
          label: "历史分位",
          value: `P${snapshot.prediction.historical_percentile.toFixed(0)}`,
          unit: "",
          tone: "primary",
          detail:
            snapshot.prediction.historical_percentile <= 50
              ? "历史融资成本偏低"
              : "历史融资成本偏高",
          icon: "bond" as MetricIconName,
        },
        {
          label: "LCR六十日分位",
          value: formatPercent(company?.ef_lcr_pctile_60d),
          unit: "",
          tone: "teal",
          detail: "短期流动性分位",
          icon: "liquidity" as MetricIconName,
        },
        {
          label: "NSFR六十日分位",
          value: formatPercent(company?.ef_nsfr_pctile_60d),
          unit: "",
          tone: "teal",
          detail: "稳定资金分位",
          icon: "leverage" as MetricIconName,
        },
        {
          label: "资金缺口",
          value: formatSignedNullable(company?.ef_funding_gap, 1),
          unit: "亿元",
          tone: (company?.ef_funding_gap ?? 0) >= 0 ? "good" : "bad",
          detail:
            company?.ef_funding_gap === null || company?.ef_funding_gap === undefined
              ? "公司资金数据暂缺"
              : company.ef_funding_gap >= 0
                ? "资金净余量"
                : "资金净缺口",
          icon: "bank" as MetricIconName,
        },
        {
          label: "主体利差",
          value: formatNullable(company?.ef_subject_spread_bp, 2),
          unit: "bp",
          tone: "primary",
          detail: "主体信用定价参考",
          icon: "issuance" as MetricIconName,
        },
      ]
    : [];

  onMount(loadReport);

  async function loadReport(): Promise<void> {
    loading = true;
    errorMessage = "";
    try {
      const response = await fetch("/api/financing-model", {
        headers: { Accept: "application/json" },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "融资择时模型读取失败");
      report = parseFinancingModelReport(payload);
      resetConclusionEditor();
      resetSellSideEditor();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      loading = false;
    }
  }

  function resetConclusionEditor(): void {
    if (!report) return;
    editVerdict = report.conclusion.verdict;
    editNarrative = report.conclusion.narrative;
  }

  function openConclusionEditor(): void {
    resetConclusionEditor();
    editingConclusion = true;
  }

  function useBaseConclusion(): void {
    if (!snapshot) return;
    editVerdict = snapshot.base_conclusion.verdict;
    editNarrative = snapshot.base_conclusion.narrative;
  }

  function resetSellSideEditor(): void {
    editSellSideSummary = report?.sellSide?.logicSummary ?? "";
  }

  function openSellSideEditor(): void {
    resetSellSideEditor();
    editingSellSide = true;
  }

  function financingMetricTone(
    tone: string,
  ): "primary" | "teal" | "good" | "bad" {
    if (tone === "teal" || tone === "good" || tone === "bad") return tone;
    return "primary";
  }

  async function saveConclusion(): Promise<void> {
    if (!report || saving) return;
    saving = true;
    try {
      const response = await fetch("/api/financing-model/conclusion", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: report.snapshot.run_id,
          verdict: editVerdict,
          preferredWindow: report.conclusion.preferredWindow,
          narrative: editNarrative,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "整体结论保存失败");
      const conclusion: FinancingModelConclusion = conclusionSchema.parse(payload);
      report = { ...report, conclusion };
      editingConclusion = false;
      globalMessages.success("整体结论已保存", {
        key: "financing-model-conclusion",
        title: "保存完成",
      });
    } catch (error) {
      globalMessages.error(
        error instanceof Error ? error.message : String(error),
        { key: "financing-model-conclusion", title: "结论保存失败" },
      );
    } finally {
      saving = false;
    }
  }

  async function generateResearch(): Promise<void> {
    if (!report || generatingResearch) return;
    generatingResearch = true;
    globalMessages.info("正在检索最近七日卖方研报并归纳逻辑，可能需要数分钟", {
      key: "financing-model-research",
      title: "卖方观点生成中",
      duration: 600_000,
    });
    try {
      const response = await fetch("/api/financing-model/sell-side", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: report.snapshot.run_id }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "卖方观点生成失败");
      const sellSide = sellSidePayloadSchema.parse(payload);
      report = { ...report, sellSide };
      editingSellSide = false;
      resetSellSideEditor();
      globalMessages.success("卖方观点已生成并保存", {
        key: "financing-model-research",
        title: "生成完成",
        duration: 6000,
      });
    } catch (error) {
      globalMessages.error(
        error instanceof Error ? error.message : String(error),
        {
          key: "financing-model-research",
          title: "卖方观点生成失败",
          duration: 10_000,
        },
      );
    } finally {
      generatingResearch = false;
    }
  }

  async function saveSellSideSummary(): Promise<void> {
    if (!report?.sellSide || savingSellSide) return;
    savingSellSide = true;
    try {
      const response = await fetch("/api/financing-model/sell-side", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: report.snapshot.run_id,
          logicSummary: editSellSideSummary,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "卖方观点保存失败");
      const sellSide = sellSidePayloadSchema.parse(payload);
      report = { ...report, sellSide };
      editingSellSide = false;
      resetSellSideEditor();
      globalMessages.success("卖方观点已保存", {
        key: "financing-model-research-revision",
        title: "保存完成",
      });
    } catch (error) {
      globalMessages.error(
        error instanceof Error ? error.message : String(error),
        {
          key: "financing-model-research-revision",
          title: "卖方观点保存失败",
        },
      );
    } finally {
      savingSellSide = false;
    }
  }

  function formatSigned(value: number, digits: number): string {
    const normalized = Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value;
    return `${normalized >= 0 ? "+" : ""}${normalized.toFixed(digits)}`;
  }

  function formatNullable(value: number | null | undefined, digits: number): string {
    return value === null || value === undefined ? "—" : value.toFixed(digits);
  }

  function formatSignedNullable(
    value: number | null | undefined,
    digits: number,
  ): string {
    return value === null || value === undefined ? "—" : formatSigned(value, digits);
  }

  function formatPercent(value: number | null | undefined): string {
    return value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;
  }

  function displayDate(value: string): string {
    const [year, month, day] = value.split("-");
    return `${year}年${Number(month)}月${Number(day)}日`;
  }

</script>

<svelte:head>
  <title>{embedded ? "融资择时模型 · 交易研究工作台" : "债券融资择时模型 · 资金管理部"}</title>
  <meta
    name="description"
    content="债券融资择时模型结构化指标、未来窗口、驱动因素与卖方观点"
  />
</svelte:head>

<div class:financing-model-page--embedded={embedded} class="financing-model-page">
  <a class="skip-link" href="#financing-model-report">跳至报告正文</a>
  <header class="model-header">
    <div class="model-title-block">
      <a class="model-back" href="/" aria-label="返回市场研究门户">
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="m12.5 4-6 6 6 6" />
        </svg>
      </a>
      <h1>
        <span>资金管理部</span>
        <span class="model-title-dot" aria-hidden="true">•</span>
        <span class="model-title-subject">债券融资择时模型</span>
      </h1>
    </div>
    <div
      class="model-actions"
      use:portal={embedded ? "#tr-topbar-actions" : null}
    >
      {#if snapshot}
        <div class="model-as-of">
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M4 6.5h12M6.5 3v3M13.5 3v3M4 4.5h12v12H4z" />
          </svg>
          <span>截至</span>
          <time datetime={snapshot.as_of_date}>{displayDate(snapshot.as_of_date)}</time>
        </div>
      {/if}
      <button class="refresh-control" type="button" onclick={loadReport} disabled={loading}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 6v5h-5M4 18v-5h5M6.1 9a7 7 0 0 1 11.4-2.2L20 9M4 15l2.5 2.2A7 7 0 0 0 17.9 15" />
        </svg>
        {loading ? "刷新中" : "刷新数据"}
      </button>
    </div>
  </header>

  {#if loading}
    <main id="financing-model-report" class="loading-state" aria-busy="true">
      <span class="spinner" aria-hidden="true"></span>
      <p>正在读取融资择时模型数据</p>
    </main>
  {:else if errorMessage}
    <main id="financing-model-report" class="error-state">
      <h2>模型数据暂不可用</h2>
      <p>{errorMessage}</p>
      <button type="button" onclick={loadReport}>重新读取</button>
    </main>
  {:else if report && snapshot}
    <main id="financing-model-report" class="report-stack">
      <section class="summary-section" aria-labelledby="summary-title">
        <div class="section-heading">
          <span class="section-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M5 19V9m7 10V5m7 14v-7M3 21h18" /></svg>
          </span>
          <h2 id="summary-title">发行建议</h2>
        </div>

        <div class="summary-grid">
          <article class="insight-card market-card">
            <h3>市场数据</h3>
            <p>
              截至 {displayDate(snapshot.market_data_date)}，模型预测发行利差相对可比债中位数
              <strong>{formatSigned(snapshot.prediction.deviation_bp, 2)} bp</strong>，处于历史
              <strong>P{snapshot.prediction.historical_percentile.toFixed(0)}</strong>。
            </p>
            <ol class="market-driver-list" aria-label="市场驱动因子 Top 5">
              {#each marketDrivers as driver}
                <li>
                  <span>{driver.display_name}</span>
                  <strong class:cost-down={driver.impact === "降低成本"} class:cost-up={driver.impact === "推高成本"}>
                    {driver.impact}
                  </strong>
                </li>
              {/each}
            </ol>
          </article>

          <article class="insight-card company-card">
            <h3>公司业务指标</h3>
            {#if company}
              <p>{companyBusinessNarrative(company)}</p>
              <dl class="company-business-metrics">
                <div>
                  <dt>LCR六十日分位</dt>
                  <dd class="business-value business-value--liquidity">
                    {formatPercent(company.ef_lcr_pctile_60d)}
                  </dd>
                </div>
                <div>
                  <dt>NSFR六十日分位</dt>
                  <dd class="business-value business-value--stability">
                    {formatPercent(company.ef_nsfr_pctile_60d)}
                  </dd>
                </div>
                <div>
                  <dt>资金缺口</dt>
                  <dd
                    class="business-value"
                    class:business-value--positive={company.ef_funding_gap !== null && company.ef_funding_gap >= 0}
                    class:business-value--negative={company.ef_funding_gap !== null && company.ef_funding_gap < 0}
                  >
                    {formatSignedNullable(company.ef_funding_gap, 1)} 亿元
                  </dd>
                </div>
                <div>
                  <dt>主体利差</dt>
                  <dd class="business-value business-value--spread">
                    {formatNullable(company.ef_subject_spread_bp, 2)} bp
                  </dd>
                </div>
              </dl>
            {:else}
              <p>暂无可用公司业务指标，本次仅使用市场择时信号。</p>
            {/if}
          </article>

          <article class="insight-card conclusion-card">
            <div class="card-title-row">
              <h3>整体结论</h3>
              <div class="card-title-actions">
                {#if report.conclusion.edited}<span class="edited-badge">人工修订</span>{/if}
                {#if !editingConclusion}
                  <button class="icon-button" type="button" aria-label="编辑整体结论" onclick={openConclusionEditor}>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17l-1 3ZM14.5 7.5l3 3" />
                    </svg>
                  </button>
                {/if}
              </div>
            </div>
            {#if editingConclusion}
              <form onsubmit={(event) => { event.preventDefault(); saveConclusion(); }}>
                <label>
                  <span>结论标题</span>
                  <input bind:value={editVerdict} maxlength="120" required />
                </label>
                <label>
                  <span>结论正文</span>
                  <textarea bind:value={editNarrative} maxlength="4000" rows="5" required></textarea>
                </label>
                <div class="editor-actions">
                  <button class="text-button" type="button" onclick={useBaseConclusion}>恢复模型基础内容</button>
                  <button class="secondary-button" type="button" onclick={() => (editingConclusion = false)}>取消</button>
                  <button class="primary-button" type="submit" disabled={saving}>{saving ? "保存中" : "保存"}</button>
                </div>
              </form>
            {:else}
              <strong class="conclusion-verdict">{report.conclusion.verdict}</strong>
              <p>{report.conclusion.narrative}</p>
            {/if}
          </article>
        </div>

        <div class="metric-strip">
          {#each metrics as metric}
            <MetricCard
              label={metric.label}
              value={metric.value}
              unit={metric.unit}
              detail={metric.detail}
              tone={financingMetricTone(metric.tone)}
              iconComponent={MetricIcon}
              iconProps={{ icon: metric.icon }}
              compact
            />
          {/each}
        </div>
      </section>

      <section class="analysis-section" aria-labelledby="window-title">
        <div class="section-heading section-heading--window">
          <span class="section-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M4 19h16M5 16l4-5 4 3 6-8" /></svg>
          </span>
          <h2 id="window-title">未来发行窗口</h2>
          <button
            class="window-details-toggle"
            type="button"
            aria-label={futureWindowDetailsOpen ? "收起未来发行窗口明细" : "展开未来发行窗口明细"}
            aria-expanded={futureWindowDetailsOpen}
            aria-controls="forecast-window-details"
            onclick={() => (futureWindowDetailsOpen = !futureWindowDetailsOpen)}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7.5 5 5 5-5" /></svg>
          </button>
        </div>
        <div class="window-layout">
          <article class="panel chart-panel">
            <ChartHost
              renderer={renderFinancingForecast}
              args={[snapshot.forecast_window]}
              ariaLabel="未来发行窗口预测偏离和相对成本变化图"
              className="forecast-chart"
            />
            <div
              id="forecast-window-details"
              class="forecast-table-wrap"
              hidden={!futureWindowDetailsOpen}
            >
              <table class="forecast-table">
                <caption>未来发行窗口明细</caption>
                <thead>
                  <tr>
                    <th scope="col">日期</th>
                    <th scope="col">窗口判断</th>
                    <th scope="col">预测偏离</th>
                    <th scope="col">历史分位</th>
                    <th scope="col">相对窗口中位数</th>
                  </tr>
                </thead>
                <tbody>
                  {#each snapshot.forecast_window as point}
                    <tr>
                      <th scope="row">{displayDate(point.date)} · {point.weekday}</th>
                      <td>{point.label}</td>
                      <td>{formatSigned(point.pred_bp, 2)} bp</td>
                      <td>P{point.percentile.toFixed(0)}</td>
                      <td>{formatSigned(point.savings_bp_vs_window_median, 2)} bp</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </article>
          <article class="panel confidence-panel">
            <h3>模型验证</h3>
            <dl class="confidence-grid">
              <div><dt>TSCV IC</dt><dd>{validation?.tscv.ic.toFixed(3)}</dd></div>
              <div><dt>RMSE</dt><dd>{validation?.tscv.rmse.toFixed(2)} bp</dd></div>
              <div><dt>推荐胜率</dt><dd>{validation ? `${(validation.timing_value.win_rate * 100).toFixed(1)}%` : "—"}</dd></div>
              <div><dt>历史节约</dt><dd>{validation ? `${formatSigned(validation.timing_value.cost_saving_bp, 2)} bp` : "—"}</dd></div>
            </dl>
          </article>
        </div>
      </section>

      <section class="analysis-section sell-side-section" aria-labelledby="sell-side-title">
        <div class="section-heading section-heading--actions">
          <div>
            <span class="section-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8 1a3 3 0 1 0 0-6M2 21v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2m2-7a5 5 0 0 1 6 5v2" /></svg>
            </span>
            <h2 id="sell-side-title">卖方观点</h2>
          </div>
          <div class="section-actions">
            {#if report.sellSide?.edited}<span class="edited-badge">人工修订</span>{/if}
            {#if report.sellSide && !editingSellSide}
              <button class="icon-button" type="button" aria-label="编辑卖方逻辑汇总" onclick={openSellSideEditor}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17l-1 3ZM14.5 7.5l3 3" />
                </svg>
              </button>
            {/if}
            <button class="primary-button research-button" type="button" onclick={generateResearch} disabled={generatingResearch || savingSellSide}>
              {generatingResearch ? "生成中" : report.sellSide ? "重新生成卖方观点" : "生成卖方观点"}
            </button>
          </div>
        </div>

        {#if report.sellSide}
          <div class="sell-side-summary-card">
            {#if editingSellSide}
              <form onsubmit={(event) => { event.preventDefault(); saveSellSideSummary(); }}>
                <label>
                  <span>卖方逻辑汇总</span>
                  <textarea bind:value={editSellSideSummary} maxlength="4000" rows="6" required></textarea>
                </label>
                <div class="editor-actions">
                  <button class="secondary-button" type="button" onclick={() => (editingSellSide = false)}>取消</button>
                  <button class="primary-button" type="submit" disabled={savingSellSide}>{savingSellSide ? "保存中" : "保存"}</button>
                </div>
              </form>
            {:else}
              <p>{report.sellSide.logicSummary}</p>
            {/if}
          </div>
          <div class="sell-side-grid">
            {#each report.sellSide.views as view}
              <article class="sell-side-card">
                <strong class="sell-side-institution">{view.institution}</strong>
                <p>{view.summary}</p>
                <div class="implication"><strong>对发行的含义</strong><span>{view.implication}</span></div>
              </article>
            {/each}
          </div>
        {:else}
          <div class="research-empty">
            <p>尚未生成卖方观点。</p>
          </div>
        {/if}
      </section>

    </main>
  {/if}
</div>

<style>
  .financing-model-page {
    width: min(100%, 2100px);
    min-height: 100dvh;
    margin-inline: auto;
    padding: 12px 16px 28px;
    color: var(--text-1);
    background: var(--bg-page);
  }

  .financing-model-page--embedded {
    min-height: 0;
    padding: 0;
  }

  .financing-model-page--embedded .skip-link,
  .financing-model-page--embedded .model-title-block {
    display: none;
  }

  .financing-model-page--embedded .model-header {
    display: none;
  }

  .skip-link {
    position: fixed;
    z-index: 20;
    top: 8px;
    left: 8px;
    padding: 10px 14px;
    border-radius: var(--radius-control);
    color: #fff;
    background: var(--color-primary);
    transform: translateY(-150%);
  }

  .skip-link:focus {
    transform: translateY(0);
  }

  .model-header,
  .report-stack,
  .loading-state,
  .error-state {
    width: 100%;
  }

  .model-header {
    position: relative;
    z-index: 10;
    display: flex;
    min-height: 64px;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding: 4px 2px 12px;
    border-bottom: 1px solid var(--border);
  }

  .model-title-block,
  .model-actions,
  .model-as-of,
  .refresh-control,
  .section-heading,
  .section-heading > div,
  .card-title-row,
  .card-title-actions,
  .editor-actions,
  .section-actions {
    display: flex;
    align-items: center;
  }

  .model-title-block {
    min-width: 0;
    gap: 10px;
  }

  .model-title-block h1 {
    display: flex;
    min-width: 0;
    align-items: baseline;
    gap: 9px;
    margin: 0;
    color: var(--text-2);
    font-size: 1.5rem;
    font-weight: bolder;
    letter-spacing: -0.025em;
  }

  .model-title-dot {
    color: color-mix(in srgb, var(--brand) 72%, var(--muted));
  }

  .model-title-subject {
    color: var(--brand-deep);
  }

  .model-back {
    display: grid;
    width: 44px;
    height: 44px;
    flex: 0 0 auto;
    place-items: center;
    border: 1px solid var(--line);
    border-radius: var(--radius-control);
    color: var(--brand-deep);
    background: var(--surface);
    box-shadow: var(--shadow-card);
    text-decoration: none;
    transition:
      border-color 160ms ease,
      background 160ms ease;
  }

  .model-back:hover {
    border-color: var(--brand);
    background: var(--brand-soft);
  }

  .model-back svg,
  .model-as-of svg,
  .refresh-control svg,
  .section-icon svg {
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.9;
  }

  .model-back svg {
    width: 20px;
  }

  .model-actions {
    flex: 0 0 auto;
    gap: 8px;
  }

  .model-as-of,
  .refresh-control {
    min-height: 44px;
    gap: 7px;
    padding: 0 12px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-control);
    color: var(--text-2);
    background: var(--surface);
    box-shadow: var(--shadow-card);
  }

  .model-as-of svg,
  .refresh-control svg {
    width: 18px;
  }

  .refresh-control {
    cursor: pointer;
    font-weight: bold;
    transition:
      border-color 160ms ease,
      background 160ms ease;
  }

  .refresh-control:hover:not(:disabled) {
    border-color: var(--brand);
    background: var(--brand-soft);
  }

  .refresh-control:disabled,
  .primary-button:disabled {
    cursor: wait;
    opacity: 0.62;
  }

  .report-stack {
    display: grid;
    gap: 16px;
  }

  .summary-section,
  .analysis-section {
    padding: 18px;
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    background: var(--bg-card);
    box-shadow: var(--shadow-card);
  }

  .section-heading {
    gap: 10px;
    min-height: 44px;
    margin-bottom: 12px;
  }

  .section-heading h2 {
    margin: 0;
    color: #173b78;
    font-size: 1.25rem;
    font-weight: bold;
  }

  .section-icon {
    display: grid;
    width: 36px;
    height: 36px;
    place-items: center;
    border-radius: 8px;
    color: var(--brand-deep);
    background: var(--brand-soft);
  }

  .section-icon svg {
    width: 21px;
  }

  .summary-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1.25fr;
    gap: 12px;
  }

  .insight-card,
  .panel,
  .sell-side-summary-card,
  .sell-side-card {
    border: 1px solid var(--border);
    border-radius: var(--radius-inner);
    background: var(--surface);
  }

  .insight-card {
    min-width: 0;
    padding: 16px;
  }

  .market-card {
    border-color: color-mix(in srgb, var(--brand) 32%, var(--line));
    background: color-mix(in srgb, var(--brand-soft) 38%, var(--surface));
  }

  .company-card {
    border-color: color-mix(in srgb, #16a394 32%, var(--line));
    background: color-mix(in srgb, #eafaf7 42%, var(--surface));
  }

  .conclusion-card {
    border-color: color-mix(in srgb, var(--brand) 24%, var(--line));
  }

  .insight-card h3,
  .panel h3 {
    margin: 0;
    font-size: 1.125rem;
    font-weight: bold;
  }

  .insight-card p {
    margin: 12px 0;
    line-height: 1.65;
  }

  .insight-card p strong {
    color: var(--color-primary);
  }

  .insight-card dl {
    display: grid;
    gap: 8px;
    margin: 0;
  }

  .insight-card dl div {
    display: flex;
    justify-content: space-between;
    gap: 14px;
  }

  .insight-card dt {
    color: var(--text-3);
  }

  .insight-card dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .company-business-metrics .business-value {
    font-weight: bold;
  }

  .business-value--liquidity {
    color: #087b72;
  }

  .business-value--stability {
    color: #175cd3;
  }

  .business-value--positive {
    color: #067647;
  }

  .business-value--negative {
    color: #b42318;
  }

  .business-value--spread {
    color: #6941c6;
  }

  .card-title-row,
  .card-title-actions,
  .section-actions {
    justify-content: space-between;
    gap: 10px;
  }

  .card-title-actions {
    justify-content: flex-end;
  }

  .edited-badge {
    padding: 3px 7px;
    border-radius: var(--radius-tag);
    color: #175cd3;
    background: #eff4ff;
    font-size: 0.75rem;
    font-weight: bold;
  }

  .conclusion-verdict {
    display: block;
    margin-top: 12px;
    color: #173b78;
    font-size: 1.25rem;
  }

  .text-button {
    min-height: 44px;
    padding: 0 10px;
    border: 0;
    border-radius: var(--radius-control);
    color: var(--color-primary);
    background: transparent;
    cursor: pointer;
    font-weight: bold;
  }

  .icon-button {
    display: grid;
    width: 44px;
    height: 44px;
    flex: 0 0 auto;
    place-items: center;
    border: 0;
    border-radius: var(--radius-control);
    color: var(--color-primary);
    background: transparent;
    cursor: pointer;
    transition: background 160ms ease;
  }

  .icon-button:hover:not(:disabled) {
    background: var(--brand-soft);
  }

  .icon-button:disabled {
    cursor: wait;
    opacity: 0.62;
  }

  .icon-button svg {
    width: 20px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.9;
  }

  .conclusion-card form,
  .conclusion-card label,
  .sell-side-summary-card form,
  .sell-side-summary-card label {
    display: grid;
    gap: 7px;
  }

  .conclusion-card form,
  .sell-side-summary-card form {
    gap: 11px;
    margin-top: 12px;
  }

  .conclusion-card label > span,
  .sell-side-summary-card label > span {
    font-size: 0.875rem;
    font-weight: bold;
  }

  .conclusion-card input,
  .conclusion-card textarea,
  .sell-side-summary-card textarea {
    width: 100%;
    min-height: 44px;
    padding: 9px 11px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-control);
    color: var(--text-1);
    background: #fff;
    font: inherit;
  }

  .conclusion-card textarea,
  .sell-side-summary-card textarea {
    min-height: 124px;
    resize: vertical;
    line-height: 1.55;
  }

  .editor-actions {
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }

  .editor-actions .text-button {
    margin-right: auto;
  }

  .primary-button,
  .secondary-button {
    min-height: 44px;
    padding: 0 16px;
    border-radius: var(--radius-control);
    cursor: pointer;
    font: inherit;
    font-weight: bold;
  }

  .primary-button {
    border: 1px solid var(--color-primary);
    color: #fff;
    background: var(--color-primary);
  }

  .secondary-button {
    border: 1px solid var(--border-strong);
    background: #fff;
  }

  .metric-strip {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(190px, 100%), 1fr));
    gap: 8px;
    margin-top: 12px;
  }

  .window-layout {
    display: grid;
    grid-template-columns: minmax(0, 2.2fr) minmax(280px, 0.8fr);
    gap: 12px;
  }

  .section-heading--window {
    width: fit-content;
  }

  .window-details-toggle {
    display: grid;
    width: 44px;
    height: 44px;
    margin-left: -4px;
    place-items: center;
    border: 0;
    border-radius: var(--radius-control);
    color: var(--brand-deep);
    background: transparent;
    cursor: pointer;
    transition: background 160ms ease;
  }

  .window-details-toggle:hover {
    background: var(--brand-soft);
  }

  .window-details-toggle svg {
    width: 18px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 2;
    transition: transform 180ms ease;
  }

  .window-details-toggle[aria-expanded="true"] svg {
    transform: rotate(180deg);
  }

  .panel {
    padding: 16px;
  }

  :global(.forecast-chart) {
    width: 100%;
    height: 310px;
  }

  .forecast-table-wrap {
    max-width: 100%;
    margin-top: 12px;
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: 8px;
  }

  .forecast-table {
    width: 100%;
    min-width: 680px;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }

  .forecast-table caption {
    padding: 10px 12px;
    color: #173b78;
    text-align: left;
    font-weight: bold;
  }

  .forecast-table th,
  .forecast-table td {
    padding: 9px 12px;
    border-top: 1px solid var(--border);
    text-align: right;
    white-space: nowrap;
  }

  .forecast-table thead th {
    color: var(--text-3);
    background: #f4f7fb;
    font-size: 0.8125rem;
  }

  .forecast-table th:first-child,
  .forecast-table td:first-child {
    text-align: left;
  }

  .forecast-table tbody th {
    color: var(--text-2);
    font-weight: normal;
  }

  .confidence-panel {
    display: grid;
    align-content: start;
    gap: 14px;
  }

  .confidence-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin: 0;
  }

  .confidence-grid div {
    padding: 12px;
    border: 1px solid color-mix(in srgb, var(--line) 72%, transparent);
    border-radius: 8px;
    background: color-mix(in srgb, var(--panel) 72%, var(--surface));
  }

  .confidence-grid dt {
    color: var(--text-3);
    font-size: 0.875rem;
  }

  .confidence-grid dd {
    margin: 6px 0 0;
    color: #173b78;
    font-size: 1.25rem;
    font-weight: bolder;
    font-variant-numeric: tabular-nums;
  }

  .market-driver-list {
    display: grid;
    gap: 0;
    margin: 12px 0 0;
    padding: 0;
    border-top: 1px solid color-mix(in srgb, var(--line) 72%, transparent);
    list-style: none;
  }

  .market-driver-list li {
    display: flex;
    min-height: 42px;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 0;
    border-bottom: 1px solid color-mix(in srgb, var(--line) 72%, transparent);
  }

  .market-driver-list strong {
    flex: 0 0 auto;
    font-weight: bold;
  }

  .market-driver-list .cost-down {
    color: #067647;
  }

  .market-driver-list .cost-up {
    color: #b42318;
  }

  .section-heading--actions {
    justify-content: space-between;
  }

  .section-heading--actions > div {
    gap: 10px;
  }

  .research-button {
    min-width: 158px;
  }

  .sell-side-summary-card {
    padding: 16px;
    background: color-mix(in srgb, var(--brand-soft) 38%, var(--surface));
  }

  .sell-side-summary-card p {
    margin: 0;
    max-width: 1100px;
    line-height: 1.6;
  }

  .sell-side-summary-card form {
    margin-top: 0;
  }

  .sell-side-grid {
    display: flex;
    align-items: stretch;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 12px;
  }

  .sell-side-card {
    display: flex;
    min-width: min(280px, 100%);
    flex: 1 1 320px;
    flex-direction: column;
    gap: 9px;
    padding: 14px;
    border-top: 3px solid var(--color-primary);
  }

  .sell-side-institution {
    color: var(--text-1);
  }

  .sell-side-card p {
    margin: 0;
    line-height: 1.65;
  }

  .implication {
    display: grid;
    gap: 5px;
    margin-top: auto;
    padding-top: 10px;
    border-top: 1px solid var(--border);
    color: var(--text-2);
  }

  .implication strong {
    color: #173b78;
    font-size: 0.875rem;
  }

  .research-empty {
    display: grid;
    min-height: 120px;
    place-items: center;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-inner);
    color: var(--text-2);
    background: color-mix(in srgb, var(--panel) 42%, var(--surface));
    text-align: center;
  }

  .research-empty p {
    margin: 0;
  }

  .loading-state,
  .error-state {
    display: grid;
    min-height: 50vh;
    place-items: center;
    align-content: center;
    gap: 12px;
    text-align: center;
  }

  .loading-state p,
  .error-state p,
  .error-state h2 {
    margin: 0;
  }

  .spinner {
    width: 36px;
    height: 36px;
    border: 3px solid #d8e2f0;
    border-top-color: var(--color-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .error-state button {
    min-height: 44px;
    padding: 0 16px;
    border: 1px solid var(--color-primary);
    border-radius: var(--radius-control);
    color: #fff;
    background: var(--color-primary);
    cursor: pointer;
    font-weight: bold;
  }

  button:focus-visible,
  a:focus-visible,
  input:focus-visible,
  textarea:focus-visible {
    outline: 3px solid color-mix(in srgb, var(--color-primary) 34%, transparent);
    outline-offset: 2px;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media (max-width: 1080px) {
    .model-header {
      align-items: flex-start;
      flex-direction: column;
    }

    .model-actions {
      width: 100%;
      justify-content: flex-end;
    }

    .summary-grid {
      grid-template-columns: 1fr 1fr;
    }

    .conclusion-card {
      grid-column: 1 / -1;
    }

    .window-layout {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 720px) {
    .financing-model-page {
      padding: 8px max(10px, env(safe-area-inset-right, 0px)) 24px
        max(10px, env(safe-area-inset-left, 0px));
    }

    .model-title-block h1 {
      font-size: 1.125rem;
    }

    .model-actions {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .model-as-of {
      justify-content: center;
      min-width: 0;
    }

    .summary-section,
    .analysis-section {
      padding: 12px;
    }

    .summary-grid {
      grid-template-columns: 1fr;
    }

    .conclusion-card {
      grid-column: 1;
    }

    .section-heading--actions {
      align-items: flex-start;
      gap: 12px;
    }

    .section-actions {
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .research-button {
      min-width: 0;
      padding-inline: 12px;
    }

    :global(.forecast-chart) {
      height: 280px;
    }
  }

  @media (max-width: 520px) {
    .model-as-of span {
      display: none;
    }

    .refresh-control {
      width: 44px;
      justify-content: center;
      padding: 0;
      font-size: 0;
    }

    .refresh-control svg {
      width: 20px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .model-back,
    .refresh-control,
    .icon-button,
    .window-details-toggle,
    .window-details-toggle svg {
      transition: none;
    }

    .spinner { animation: none; }
  }
</style>
