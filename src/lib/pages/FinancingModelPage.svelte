<script lang="ts">
  import { onMount } from "svelte";

  export let embedded = false;

  import "../../app.css";
  import "../../styles.css";
  import "../../layout-report.css";

  import {
    renderFinancingDriverContributions,
    renderFinancingDriverRadar,
    renderFinancingForecast,
    renderFinancingGauge,
    renderFinancingProductComparison,
  } from "../../charts/financing-model";
  import ChartHost from "../../components/ChartHost.svelte";
  import MetricCard from "../../components/MetricCard.svelte";
  import MetricIcon from "../../components/MetricIcon.svelte";
  import ModuleCard from "../../components/ModuleCard.svelte";
  import InstitutionLogo from "$lib/components/InstitutionLogo.svelte";
  import PanelHeading from "$lib/trading-research/PanelHeading.svelte";
  import {
    conclusionSchema,
    parseFinancingModelReport,
    sellSideSummaryBody,
    sellSidePayloadSchema,
    timingDecisionHistorySchema,
    timingDecisionRecordSchema,
    type FinancingModelConclusion,
    type FinancingModelReport,
    type FinancingModelVersion,
    type TimingDecisionRecord,
  } from "$lib/financing-model";
  import { globalMessages } from "$lib/global-messages";
  import { portal } from "$lib/portal";
  import type { MetricIconName } from "../../view-model";

  const VERSION_TIME_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  let report: FinancingModelReport | null = null;
  let loading = true;
  let loadingVersion = false;
  let saving = false;
  let savingSellSide = false;
  let savingDecision = false;
  let generatingResearch = false;
  let editingConclusion = false;
  let editingSellSide = false;
  let editingDecision = false;
  let futureWindowDetailsOpen = false;
  let errorMessage = "";
  let editVerdict = "";
  let editNarrative = "";
  let editSellSideSummary = "";
  let editDecisionRunId = "";
  let editDecisionAction = "";
  let editDecisionOutcome = "";
  let selectedRunId = "";
  let decisionHistory: TimingDecisionRecord[] = [];

  $: snapshot = report?.snapshot ?? null;
  $: company = snapshot?.company_metrics ?? null;
  $: validation = snapshot?.validation ?? null;
  $: marketDrivers = snapshot?.market_drivers.slice(0, 5) ?? [];
  $: productRecommendation = snapshot?.product_recommendation ?? null;
  $: recommendedScenario =
    productRecommendation?.scenarios.find((scenario) => scenario.is_recommended) ??
    null;
  $: versions = report?.versions ?? [];
  $: businessMetrics = snapshot
    ? [
        {
          label: "LCR",
          value: formatRatioPercent(company?.ef_lcr),
          unit: "%",
          tone: "teal",
          detail: lcrInsight(company?.ef_lcr),
          icon: "liquidity" as MetricIconName,
        },
        {
          label: "NSFR",
          value: formatRatioPercent(company?.ef_nsfr),
          unit: "%",
          tone: "blue",
          detail: nsfrInsight(company?.ef_nsfr),
          icon: "leverage" as MetricIconName,
        },
        {
          label: "资金缺口",
          value: formatSignedNullable(company?.ef_funding_gap, 1),
          unit: "亿元",
          tone: "orange",
          detail: fundingGapInsight(company?.ef_funding_gap),
          icon: "bank" as MetricIconName,
        },
        {
          label: "主体利差",
          value: formatNullable(company?.ef_subject_spread_bp, 2),
          unit: "bp",
          tone: "purple",
          detail: subjectSpreadInsight(company?.ef_subject_spread_pctile),
          icon: "issuance" as MetricIconName,
        },
      ]
    : [];
  $: validationMetrics = validation
    ? [
        {
          label: "样本量",
          value: `${validation.tscv.sample_count ?? validation.tscv.validation_samples} 笔`,
          tip: "最终预测模型实际使用的全部有效历史发行样本数。",
        },
        {
          label: "样本区间",
          value: formatDateRange(
            validation.tscv.sample_start_date,
            validation.tscv.sample_end_date,
          ),
          tip: "最终预测模型全部有效历史样本的最早至最晚发行日期。",
        },
        {
          label: "胜率",
          value: `${(validation.timing_value.win_rate * 100).toFixed(1)}%`,
          tip: "模型推荐样本中，实际发行利差偏离低于零的记录占比。",
        },
        {
          label: "历史节约",
          value: `${formatSigned(validation.timing_value.cost_saving_bp, 2)} bp`,
          tip: "全样本实际偏离均值减去模型推荐样本实际偏离均值，正值表示节约。",
        },
        {
          label: "信息系数",
          value: validation.tscv.ic.toFixed(3),
          tip: "各时序验证折内预测偏离与实际偏离相关系数的平均值。",
        },
        {
          label: "平均误差",
          value:
            validation.tscv.mae === null
              ? "—"
              : `${validation.tscv.mae.toFixed(2)} bp`,
          tip: "所有样本外预测与实际发行利差偏离之差的平均绝对值。",
        },
      ]
    : [];

  onMount(loadReport);

  async function loadReport(): Promise<void> {
    loading = true;
    errorMessage = "";
    try {
      const [reportResponse, historyResponse] = await Promise.all([
        fetch("/api/financing-model", {
          headers: { Accept: "application/json" },
        }),
        fetch("/api/financing-model/decisions", {
          headers: { Accept: "application/json" },
        }),
      ]);
      const [reportPayload, historyPayload] = await Promise.all([
        reportResponse.json(),
        historyResponse.json(),
      ]);
      if (!reportResponse.ok) {
        throw new Error(reportPayload.error || "融资择时模型读取失败");
      }
      if (!historyResponse.ok) {
        throw new Error(historyPayload.error || "择时决策记录读取失败");
      }
      applyReport(parseFinancingModelReport(reportPayload));
      decisionHistory = timingDecisionHistorySchema.parse(historyPayload);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      loading = false;
    }
  }

  function applyReport(nextReport: FinancingModelReport): void {
    report = nextReport;
    selectedRunId = nextReport.snapshot.run_id;
    futureWindowDetailsOpen = false;
    editingConclusion = false;
    editingSellSide = false;
    resetConclusionEditor();
    resetSellSideEditor();
    closeDecisionEditor();
  }

  async function loadVersion(event: Event): Promise<void> {
    if (!report || loadingVersion) return;
    const nextRunId = (event.currentTarget as HTMLSelectElement).value;
    if (!nextRunId || nextRunId === report.snapshot.run_id) return;
    const previousRunId = report.snapshot.run_id;
    selectedRunId = nextRunId;
    loadingVersion = true;
    try {
      const response = await fetch(
        `/api/financing-model?run=${encodeURIComponent(nextRunId)}`,
        { headers: { Accept: "application/json" } },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "融资择时模型版本读取失败");
      }
      applyReport(parseFinancingModelReport(payload));
    } catch (error) {
      selectedRunId = previousRunId;
      globalMessages.error(
        error instanceof Error ? error.message : String(error),
        { key: "financing-model-version", title: "版本切换失败" },
      );
    } finally {
      loadingVersion = false;
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
    editVerdict = snapshot.prediction.recommendation_label;
    editNarrative = snapshot.base_conclusion.narrative;
  }

  function resetSellSideEditor(): void {
    editSellSideSummary = report?.sellSide?.logicSummary ?? "";
  }

  function openSellSideEditor(): void {
    resetSellSideEditor();
    editingSellSide = true;
  }

  function openDecisionEditor(record?: TimingDecisionRecord): void {
    if (!snapshot) return;
    const current =
      record ??
      decisionHistory.find((item) => item.runId === snapshot?.run_id);
    editDecisionRunId = current?.runId ?? snapshot.run_id;
    editDecisionAction = current?.decisionAction ?? "";
    editDecisionOutcome = current?.outcome ?? "";
    editingDecision = true;
  }

  function closeDecisionEditor(): void {
    editingDecision = false;
    editDecisionRunId = "";
    editDecisionAction = "";
    editDecisionOutcome = "";
  }

  async function saveDecision(): Promise<void> {
    if (!editDecisionRunId || savingDecision) return;
    savingDecision = true;
    try {
      const response = await fetch("/api/financing-model/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: editDecisionRunId,
          decisionAction: editDecisionAction,
          outcome: editDecisionOutcome,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "择时决策记录保存失败");
      const saved = timingDecisionRecordSchema.parse(payload);
      decisionHistory = [
        saved,
        ...decisionHistory.filter((item) => item.runId !== saved.runId),
      ].sort((left, right) => right.decisionDate.localeCompare(left.decisionDate));
      closeDecisionEditor();
      globalMessages.success("择时决策记录已保存", {
        key: "financing-model-decision",
        title: "保存完成",
      });
    } catch (error) {
      globalMessages.error(
        error instanceof Error ? error.message : String(error),
        { key: "financing-model-decision", title: "决策记录保存失败" },
      );
    } finally {
      savingDecision = false;
    }
  }

  function financingMetricTone(
    tone: string,
  ): "primary" | "teal" | "blue" | "orange" | "purple" {
    if (
      tone === "teal" ||
      tone === "blue" ||
      tone === "orange" ||
      tone === "purple"
    )
      return tone;
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

  function formatRatioPercent(value: number | null | undefined): string {
    return value === null || value === undefined ? "—" : (value * 100).toFixed(1);
  }

  function lcrInsight(value: number | null | undefined): string {
    if (value === null || value === undefined) return "流动性数据暂缺";
    if (value >= 1.5) return "流动性宽裕";
    if (value >= 1) return "流动性充足";
    return "流动性偏紧";
  }

  function nsfrInsight(value: number | null | undefined): string {
    if (value === null || value === undefined) return "稳定资金数据暂缺";
    if (value >= 1.2) return "稳定资金充足";
    if (value >= 1) return "稳定资金达标";
    return "稳定资金承压";
  }

  function fundingGapInsight(value: number | null | undefined): string {
    if (value === null || value === undefined) return "资金缺口数据暂缺";
    if (value < -100) return "资金缺口较大";
    if (value > 50) return "资金较为宽裕";
    return "资金缺口可控";
  }

  function subjectSpreadInsight(value: number | null | undefined): string {
    if (value === null || value === undefined) return "主体利差分位暂缺";
    if (value <= 0.33) return "主体利差相对低位";
    if (value >= 0.67) return "主体利差相对高位";
    return "主体利差处于中枢";
  }

  function formatDateRange(
    start: string | null,
    end: string | null,
  ): string {
    if (!start || !end) return "—";
    return `${start.replaceAll("-", ".")}–${end.replaceAll("-", ".")}`;
  }

  function displayDate(value: string): string {
    const [year, month, day] = value.split("-");
    return `${year}年${Number(month)}月${Number(day)}日`;
  }

  function versionLabel(
    version: FinancingModelVersion,
    availableVersions: FinancingModelVersion[],
  ): string {
    const sameDateCount = availableVersions.filter(
      (candidate) => candidate.asOfDate === version.asOfDate,
    ).length;
    if (sameDateCount === 1) return version.asOfDate;
    return `${version.asOfDate} · ${VERSION_TIME_FORMATTER.format(new Date(version.generatedAt))}`;
  }

</script>

<svelte:head>
  <title>{embedded ? "融资择时模型 · 交易研究工作台" : "债券融资择时模型 · 资金管理部"}</title>
  <meta
    name="description"
    content="债券融资择时模型结构化指标、未来窗口、驱动因素与卖方观点"
  />
</svelte:head>

{#snippet versionActions(portalTarget: string | null)}
  <div
    class="model-actions layout-report-screen-only"
    use:portal={portalTarget}
  >
    {#if snapshot}
      <label class="model-version-control">
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M4 6.5h12M6.5 3v3M13.5 3v3M4 4.5h12v12H4z" />
        </svg>
        <span>日期版本</span>
        <select
          aria-label="融资择时模型日期版本"
          value={selectedRunId}
          onchange={loadVersion}
          disabled={loadingVersion}
        >
          {#each versions as version (version.runId)}
            <option value={version.runId}>{versionLabel(version, versions)}</option>
          {/each}
        </select>
      </label>
    {/if}
  </div>
{/snippet}

{#snippet standaloneHeader()}
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
    {@render versionActions(null)}
  </header>
{/snippet}

{#snippet reportContents()}
  {#if loading}
    <section id="financing-model-report" class="loading-state" aria-busy="true">
      <span class="spinner" aria-hidden="true"></span>
      <p>正在读取融资择时模型数据</p>
    </section>
  {:else if errorMessage}
    <section id="financing-model-report" class="error-state">
      <h2>模型数据暂不可用</h2>
      <p>{errorMessage}</p>
      <button type="button" onclick={loadReport}>重新读取</button>
    </section>
  {:else if report && snapshot}
    <section id="financing-model-report" class="report-stack">
      <section class="decision-grid" aria-label="融资窗口与整体结论">
        <ModuleCard class="window-card" labelledBy="financing-window-title">
          <PanelHeading id="financing-window-title" title="融资窗口" />
          <div class="window-card-body">
            <ChartHost
              renderer={renderFinancingGauge}
              args={[snapshot.prediction]}
              ariaLabel={`融资窗口历史分位 P${snapshot.prediction.historical_percentile.toFixed(0)}`}
              className="window-gauge"
            />
            <div class="window-decision">
              <span class={`recommendation-badge recommendation-badge--${snapshot.prediction.recommendation}`}>
                {snapshot.prediction.recommendation_label}
              </span>
              <h3>窗口处于{snapshot.prediction.window_zone}区间</h3>
              <p>
                模型预测发行利差相对偏离
                <strong>{formatSigned(snapshot.prediction.deviation_bp, 2)} bp</strong>，处于历史
                <strong>P{snapshot.prediction.historical_percentile.toFixed(0)}</strong>
              </p>
            </div>
          </div>
        </ModuleCard>

        <ModuleCard class="conclusion-card" labelledBy="overall-conclusion-title">
            <PanelHeading id="overall-conclusion-title" title="整体结论" controlsInline>
              {#if !editingConclusion}
                <button class="icon-button" type="button" aria-label="编辑整体结论" onclick={openConclusionEditor}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17l-1 3ZM14.5 7.5l3 3" />
                  </svg>
                </button>
              {/if}
            </PanelHeading>
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
        </ModuleCard>
      </section>

      <section class="driver-grid" aria-label="模型驱动解释">
        <ModuleCard class="chart-card" labelledBy="driver-structure-title">
          <PanelHeading id="driver-structure-title" title="驱动结构" />
          <ChartHost
            renderer={renderFinancingDriverRadar}
            args={[snapshot.driver_structure]}
            ariaLabel="按六类因子汇总的 SHAP 发行支持度雷达图"
            className="driver-radar-chart"
          />
        </ModuleCard>
        <ModuleCard class="chart-card" labelledBy="factor-contribution-title">
          <PanelHeading id="factor-contribution-title" title="因子贡献" />
          <ChartHost
            renderer={renderFinancingDriverContributions}
            args={[marketDrivers]}
            ariaLabel="当前预测 Top 5 因子贡献，正值支持发行"
            className="driver-contribution-chart"
          />
        </ModuleCard>
      </section>

      <section class="business-section" aria-labelledby="business-title">
        <PanelHeading id="business-title" title="业务指标" />
        <div class="business-metric-grid">
          {#each businessMetrics as metric}
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

      {#if productRecommendation}
        <section class="product-section" aria-labelledby="product-title">
          <div class="product-layout">
            <ModuleCard class="chart-card" labelledBy="product-title">
              <PanelHeading id="product-title" title="品种推荐" />
              <ChartHost
                renderer={renderFinancingProductComparison}
                args={[productRecommendation]}
                ariaLabel="3年与5年公募债和次级债预测偏离对比"
                className="product-comparison-chart"
              />
            </ModuleCard>
            <ModuleCard class="product-result" labelledBy="product-result-title">
              <PanelHeading id="product-result-title" title="模型推荐" />
              <strong class="product-result-name">{productRecommendation.recommended_product}</strong>
              {#if recommendedScenario}
                <span class={`recommendation-badge recommendation-badge--${recommendedScenario.recommendation}`}>
                  {recommendedScenario.recommendation_label}
                </span>
                <p>
                  相对同类债中位数 {formatSigned(recommendedScenario.pred_bp, 2)} bp · 历史
                  P{recommendedScenario.historical_percentile.toFixed(0)}
                </p>
              {/if}
            </ModuleCard>
          </div>
        </section>
      {/if}

      <section class="supporting-grid" aria-label="未来发行窗口与模型验证">
        <ModuleCard class="forecast-panel" labelledBy="window-title">
          <PanelHeading id="window-title" title="未来发行窗口">
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
          </PanelHeading>
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
        </ModuleCard>
        <ModuleCard class="validation-panel" labelledBy="validation-title">
          <PanelHeading id="validation-title" title="模型验证" />
          <dl class="validation-grid">
            {#each validationMetrics as metric, index}
              <div>
                <div class="validation-label">
                  <dt>{metric.label}</dt>
                  <button class="info-tip" type="button" aria-label={`${metric.label}指标含义`} aria-describedby={`validation-tip-${index}`}>
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <circle cx="10" cy="10" r="7.5" />
                      <path d="M10 9v5M10 6.3h.01" />
                    </svg>
                    <span class="metric-tooltip" id={`validation-tip-${index}`} role="tooltip">
                      {metric.tip}
                    </span>
                  </button>
                </div>
                <dd>{metric.value}</dd>
              </div>
            {/each}
            </dl>
        </ModuleCard>
      </section>

      <ModuleCard class="decision-history-section" labelledBy="decision-history-title">
        <PanelHeading id="decision-history-title" title="历史择时决策记录">
          {#if !editingDecision}
            <button class="primary-button" type="button" onclick={() => openDecisionEditor()}>
              录入当前决策
            </button>
          {/if}
        </PanelHeading>

        {#if editingDecision}
          <form class="decision-editor" onsubmit={(event) => { event.preventDefault(); saveDecision(); }}>
            <label>
              <span>决策操作</span>
              <textarea bind:value={editDecisionAction} maxlength="1000" rows="3" required></textarea>
            </label>
            <label>
              <span>结果</span>
              <textarea bind:value={editDecisionOutcome} maxlength="2000" rows="3"></textarea>
            </label>
            <div class="editor-actions">
              <button class="secondary-button" type="button" onclick={closeDecisionEditor}>取消</button>
              <button class="primary-button" type="submit" disabled={savingDecision}>
                {savingDecision ? "保存中" : "保存"}
              </button>
            </div>
          </form>
        {/if}

        <div class="decision-table-wrap">
          <table class="decision-table">
            <thead>
              <tr>
                <th scope="col">日期</th>
                <th scope="col">历史分位</th>
                <th scope="col">发行建议</th>
                <th scope="col">决策操作</th>
                <th scope="col">结果</th>
              </tr>
            </thead>
            <tbody>
              {#each decisionHistory as record}
                <tr>
                  <th scope="row">{displayDate(record.decisionDate)}</th>
                  <td>P{record.historicalPercentile.toFixed(0)}</td>
                  <td>
                    <span class={`recommendation-badge recommendation-badge--${record.recommendation}`}>
                      {record.recommendationLabel}
                    </span>
                  </td>
                  <td>{record.decisionAction}</td>
                  <td>
                    <div class="decision-result-cell">
                      <span>{record.outcome || "—"}</span>
                      <button class="icon-button" type="button" aria-label={`编辑${record.decisionDate}择时决策记录`} onclick={() => openDecisionEditor(record)}>
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17l-1 3ZM14.5 7.5l3 3" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              {:else}
                <tr>
                  <td class="decision-empty" colspan="5">暂无决策记录</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </ModuleCard>

      <ModuleCard class="sell-side-section" labelledBy="sell-side-title">
        <PanelHeading id="sell-side-title" title="卖方观点">
          <div class="section-actions">
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
        </PanelHeading>

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
          <div class={`sell-side-grid sell-side-grid--${report.sellSide.views.length}`}>
            {#each report.sellSide.views as view}
              <article class="sell-side-card">
                <div class="sell-side-institution">
                  <InstitutionLogo institution={view.institution} />
                  <strong>{view.institution}</strong>
                </div>
                <p>{sellSideSummaryBody(view.summary, view.institution)}</p>
                <div class="implication">
                  <strong>对发行的含义</strong>
                  <span>{view.implication}</span>
                </div>
              </article>
            {/each}
          </div>
        {:else}
          <div class="research-empty">
            <p>尚未生成卖方观点。</p>
          </div>
        {/if}
      </ModuleCard>

    </section>
  {/if}
{/snippet}

{#if embedded}
  {@render versionActions("#tr-topbar-actions")}
  {@render reportContents()}
{:else}
  <main class="financing-model-page layout-report layout-report--financing">
    {@render standaloneHeader()}
    {@render reportContents()}
  </main>
{/if}

<style>
  .financing-model-page {
    width: 100%;
    max-width: 1080px;
    min-height: 100dvh;
    margin-inline: auto;
    padding: 12px 16px 28px;
    color: var(--text-1);
    background: var(--bg-page);
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
  .model-version-control,
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
  .model-version-control svg {
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

  .model-version-control {
    min-height: 44px;
    gap: 7px;
    padding: 0 12px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-control);
    color: var(--text-2);
    background: var(--surface);
    box-shadow: var(--shadow-card);
  }

  .model-version-control svg {
    width: 18px;
    flex: 0 0 18px;
  }

  .model-version-control span {
    font-weight: bold;
    white-space: nowrap;
  }

  .model-version-control select {
    min-width: 168px;
    height: 42px;
    padding: 0 28px 0 4px;
    border: 0;
    color: var(--text-1);
    background: transparent;
    cursor: pointer;
    font: inherit;
    font-variant-numeric: tabular-nums;
    font-weight: bold;
  }

  .model-version-control select:disabled,
  .primary-button:disabled {
    cursor: wait;
    opacity: 0.62;
  }

  .report-stack {
    display: grid;
    gap: 16px;
  }

  .sell-side-summary-card,
  .sell-side-card {
    border: 1px solid var(--border);
    border-radius: var(--radius-inner);
    background: var(--surface);
  }

  .section-actions {
    justify-content: space-between;
    gap: 10px;
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

  :global(.conclusion-card) form,
  :global(.conclusion-card) label,
  .sell-side-summary-card form,
  .sell-side-summary-card label {
    display: grid;
    gap: 7px;
  }

  :global(.conclusion-card) form,
  .sell-side-summary-card form {
    gap: 11px;
    margin-top: 12px;
  }

  :global(.conclusion-card) label > span,
  .sell-side-summary-card label > span {
    font-size: 0.875rem;
    font-weight: bold;
  }

  :global(.conclusion-card) input,
  :global(.conclusion-card) textarea,
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

  :global(.conclusion-card) textarea,
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

  .decision-grid,
  .driver-grid,
  .product-layout,
  .supporting-grid {
    display: grid;
    gap: 16px;
  }

  .decision-grid {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
  }

  .driver-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .product-layout {
    grid-template-columns: minmax(0, 2.25fr) minmax(260px, 0.75fr);
  }

  .supporting-grid {
    grid-template-columns: minmax(0, 1.75fr) minmax(360px, 0.8fr);
  }

  .window-card-body {
    display: grid;
    min-height: 220px;
    grid-template-columns: minmax(210px, 0.85fr) minmax(0, 1.15fr);
    align-items: center;
    gap: 18px;
  }

  :global(.window-gauge) {
    width: 100%;
    height: 210px;
  }

  .window-decision {
    display: grid;
    justify-items: start;
    gap: 12px;
  }

  .window-decision h3 {
    margin: 0;
    color: var(--text-1);
    font-size: 1.5rem;
    font-weight: bolder;
  }

  .window-decision p,
  :global(.conclusion-card) p,
  :global(.product-result) p {
    margin: 0;
    color: var(--text-2);
    font-size: 1rem;
    line-height: 1.65;
  }

  .window-decision p strong {
    color: #173b78;
    font-weight: bolder;
    white-space: nowrap;
  }

  .recommendation-badge {
    display: inline-flex;
    min-height: 32px;
    align-items: center;
    padding: 5px 12px;
    border: 1px solid currentColor;
    border-radius: 999px;
    font-size: 0.875rem;
    font-weight: bold;
    line-height: 1;
  }

  .recommendation-badge--strong_buy {
    color: #067647;
    background: #ecfdf3;
  }

  .recommendation-badge--neutral {
    color: #b54708;
    background: #fff7ed;
  }

  .recommendation-badge--wait {
    color: #b42318;
    background: #fef3f2;
  }

  .conclusion-card {
    display: grid;
    align-content: start;
    gap: 12px;
    border-color: color-mix(in srgb, var(--brand) 28%, var(--line));
  }

  :global(.conclusion-card) .conclusion-verdict {
    margin-top: 4px;
  }

  .chart-card {
    min-width: 0;
  }

  :global(.driver-radar-chart),
  :global(.driver-contribution-chart) {
    width: 100%;
    height: 320px;
    margin-top: 8px;
  }

  .business-section {
    display: grid;
  }

  .business-metric-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
  }

  :global(.product-comparison-chart) {
    width: 100%;
    height: 280px;
    margin-top: 8px;
  }

  .product-result {
    display: grid;
    align-content: center;
    justify-items: start;
    gap: 14px;
    border-color: color-mix(in srgb, #2f6fed 30%, var(--line));
    background: color-mix(in srgb, #eaf1fd 46%, var(--surface));
  }

  .product-result-name {
    color: #173b78;
    font-size: 1.5rem;
    font-weight: bolder;
  }

  .validation-label {
    display: flex;
    align-items: center;
  }

  .forecast-panel {
    min-width: 0;
  }

  .validation-panel {
    display: grid;
    align-content: start;
    gap: 14px;
  }

  .validation-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    margin: 0;
  }

  .validation-grid > div {
    min-width: 0;
    padding: 12px;
    border: 1px solid color-mix(in srgb, var(--line) 72%, transparent);
    border-radius: 8px;
    background: color-mix(in srgb, var(--panel) 72%, var(--surface));
  }

  .validation-label {
    gap: 4px;
  }

  .validation-grid dt {
    color: var(--text-3);
    font-size: 0.875rem;
    font-weight: bold;
  }

  .validation-grid dd {
    margin: 6px 0 0;
    color: #173b78;
    font-size: 1.125rem;
    font-weight: bolder;
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }

  .info-tip {
    position: relative;
    display: grid;
    width: 44px;
    height: 44px;
    flex: 0 0 44px;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 50%;
    color: var(--text-3);
    cursor: help;
  }

  .info-tip:hover,
  .info-tip:focus-visible {
    color: var(--color-primary);
    background: var(--brand-soft);
  }

  .info-tip svg {
    width: 18px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.7;
  }

  .metric-tooltip {
    position: absolute;
    z-index: 12;
    top: calc(100% + 6px);
    left: 50%;
    display: none;
    width: min(260px, calc(100vw - 40px));
    padding: 8px 10px;
    border-radius: 6px;
    color: #fff;
    background: rgba(23, 32, 51, 0.96);
    box-shadow: 0 8px 24px rgba(23, 32, 51, 0.2);
    font-size: 0.875rem;
    font-weight: normal;
    line-height: 1.45;
    transform: translateX(-50%);
  }

  .info-tip:hover .metric-tooltip,
  .info-tip:focus-visible .metric-tooltip {
    display: block;
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

  .decision-editor {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 14px;
    padding: 14px;
    border: 1px solid color-mix(in srgb, var(--brand) 24%, var(--line));
    border-radius: var(--radius-inner);
    background: color-mix(in srgb, var(--brand-soft) 24%, var(--surface));
  }

  .decision-editor label {
    display: grid;
    gap: 7px;
  }

  .decision-editor label > span {
    font-weight: bold;
  }

  .decision-editor textarea {
    width: 100%;
    min-height: 92px;
    padding: 9px 11px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-control);
    color: var(--text-1);
    background: #fff;
    font: inherit;
    line-height: 1.55;
    resize: vertical;
  }

  .decision-editor .editor-actions {
    grid-column: 1 / -1;
  }

  .decision-table-wrap {
    max-width: 100%;
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: 8px;
  }

  .decision-table {
    width: 100%;
    min-width: 900px;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }

  .decision-table th,
  .decision-table td {
    padding: 11px 12px;
    border-top: 1px solid var(--border);
    text-align: left;
    vertical-align: middle;
  }

  .decision-table thead th {
    border-top: 0;
    color: var(--text-3);
    background: #f4f7fb;
  }

  .decision-table tbody th {
    color: var(--text-2);
    font-weight: normal;
    white-space: nowrap;
  }

  .decision-table th:nth-child(1),
  .decision-table td:nth-child(1) {
    width: 150px;
  }

  .decision-table th:nth-child(2),
  .decision-table td:nth-child(2),
  .decision-table th:nth-child(3),
  .decision-table td:nth-child(3) {
    width: 128px;
  }

  .decision-result-cell {
    display: flex;
    min-width: 220px;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .decision-empty {
    height: 88px;
    color: var(--text-2);
    text-align: center !important;
  }

  .research-button {
    min-width: 158px;
  }

  .sell-side-summary-card {
    padding: 18px;
    border-color: color-mix(in srgb, var(--brand) 24%, var(--line));
    background: color-mix(in srgb, var(--brand-soft) 32%, var(--surface));
  }

  .sell-side-summary-card p {
    width: 100%;
    margin: 0;
    line-height: 1.65;
  }

  .sell-side-summary-card form {
    margin-top: 0;
  }

  .sell-side-grid {
    display: grid;
    grid-template-columns: repeat(var(--sell-side-columns), minmax(0, 1fr));
    gap: 12px;
    margin-top: 14px;
  }

  .sell-side-grid--3 {
    --sell-side-columns: 3;
  }

  .sell-side-grid--4 {
    --sell-side-columns: 4;
  }

  .sell-side-grid--5 {
    --sell-side-columns: 5;
  }

  .sell-side-card {
    display: grid;
    min-width: 0;
    grid-row: span 3;
    grid-template-rows: subgrid;
    gap: 0;
    overflow: hidden;
    border-color: color-mix(in srgb, var(--brand) 22%, var(--line));
    box-shadow: var(--shadow-card);
  }

  .sell-side-institution {
    display: flex;
    min-height: 48px;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border-bottom: 1px solid color-mix(in srgb, var(--brand) 16%, var(--line));
    color: var(--brand-deep);
    background: color-mix(in srgb, var(--brand-soft) 52%, var(--surface));
    font-size: 1rem;
  }

  .sell-side-institution strong {
    min-width: 0;
    line-height: 1.35;
  }

  .sell-side-card p {
    margin: 0;
    padding: 15px 16px 16px;
    line-height: 1.65;
  }

  .implication {
    display: grid;
    align-content: start;
    gap: 5px;
    padding: 13px 16px 15px;
    border-top: 1px solid color-mix(in srgb, var(--brand) 14%, var(--line));
    color: var(--text-2);
    background: color-mix(in srgb, var(--panel) 54%, var(--surface));
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
  select:focus-visible,
  textarea:focus-visible {
    outline: 3px solid color-mix(in srgb, var(--color-primary) 34%, transparent);
    outline-offset: 2px;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @supports not (grid-template-rows: subgrid) {
    .sell-side-card {
      grid-template-rows: auto 1fr auto;
    }
  }

  @media (max-width: 1500px) {
    .sell-side-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .sell-side-grid--3 .sell-side-card:last-child,
    .sell-side-grid--5 .sell-side-card:last-child {
      grid-column: 1 / -1;
    }
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

    .decision-grid,
    .product-layout,
    .supporting-grid {
      grid-template-columns: 1fr;
    }

    .business-metric-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
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
      display: flex;
    }

    .model-version-control {
      width: 100%;
      min-width: 0;
    }

    .model-version-control select {
      min-width: 0;
      flex: 1;
    }

    .driver-grid,
    .business-metric-grid {
      grid-template-columns: 1fr;
    }

    .decision-editor {
      grid-template-columns: 1fr;
    }

    .decision-editor .editor-actions {
      grid-column: auto;
    }

    .window-card-body {
      grid-template-columns: 1fr;
      gap: 0;
    }

    .window-decision {
      justify-items: center;
      text-align: center;
    }

    .section-actions {
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .research-button {
      min-width: 0;
      padding-inline: 12px;
    }

    .sell-side-grid {
      grid-template-columns: 1fr;
    }

    .sell-side-grid .sell-side-card:last-child {
      grid-column: auto;
    }

    :global(.forecast-chart) {
      height: 280px;
    }
  }

  @media (max-width: 520px) {
    .model-version-control span {
      display: none;
    }

    .validation-grid {
      grid-template-columns: 1fr;
    }
  }

  @media print {
    .model-header {
      align-items: center;
      flex-direction: row;
    }

    .decision-grid {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
    }

    .product-layout {
      grid-template-columns: minmax(0, 2.25fr) minmax(260px, 0.75fr);
    }

    .supporting-grid {
      grid-template-columns: minmax(0, 1.75fr) minmax(360px, 0.8fr);
    }

    .business-metric-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .sell-side-grid--3 {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .sell-side-grid--4 {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .sell-side-grid--5 {
      grid-template-columns: repeat(5, minmax(0, 1fr));
    }

    .sell-side-grid .sell-side-card:last-child {
      grid-column: auto;
    }

    .report-stack > section,
    :global(.report-stack > .tr-panel) {
      break-inside: avoid-page;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .model-back,
    .icon-button,
    .window-details-toggle,
    .window-details-toggle svg {
      transition: none;
    }

    .spinner { animation: none; }
  }
</style>
