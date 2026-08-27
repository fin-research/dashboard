<script lang="ts">
  import { onMount } from "svelte";

  import ChartHost from "../../components/ChartHost.svelte";
  import MetricCard from "../../components/MetricCard.svelte";
  import { renderWorkbenchBarChart } from "../../charts/trading-research";
  import { fetchCreditReport } from "../credit/client.ts";
  import {
    creditItemLabels,
    type CreditAmountChange,
    type CreditInstitutionView,
    type CreditReportResponse,
    type CreditStatus,
  } from "../credit/types.ts";
  import Badge from "./Badge.svelte";
  import PanelHeading from "./PanelHeading.svelte";
  import SectionHeading from "./SectionHeading.svelte";
  import WorkbenchIcon from "./WorkbenchIcon.svelte";

  type CreditTab = "overview" | "weekly";

  let activeTab = $state<CreditTab>("overview");
  let report = $state<CreditReportResponse | null>(null);
  let loading = $state(true);
  let errorMessage = $state("");
  let query = $state("");
  let statusFilter = $state<CreditStatus | "all">("all");
  let riskFilter = $state("all");
  let expandedInstitution = $state<string | null>(null);

  const filteredInstitutions = $derived.by(() => {
    const currentReport = report;
    if (!currentReport) return [];
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return currentReport.institutions.filter((institution) => {
      const matchesQuery =
        !normalizedQuery ||
        [
          institution.institutionName,
          institution.institutionType,
          institution.bankOffice,
          institution.applyingDepartment,
          institution.handler,
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("zh-CN")
          .includes(normalizedQuery);
      const matchesStatus =
        statusFilter === "all" || institution.status === statusFilter;
      const matchesRisk =
        riskFilter === "all" ||
        (riskFilter === "attention" && (institution.utilization ?? 0) >= 60) ||
        (riskFilter === "warning" && (institution.utilization ?? 0) >= 80) ||
        (riskFilter === "expiry" &&
          Boolean(
            institution.expiryDate &&
              daysBetween(currentReport.summary.reportDate, institution.expiryDate) >= 0 &&
              daysBetween(currentReport.summary.reportDate, institution.expiryDate) <= 30,
          ));
      return matchesQuery && matchesStatus && matchesRisk;
    });
  });

  const highUtilizationLines = $derived.by(() =>
    (report?.institutions ?? [])
      .filter(
        (institution) =>
          institution.status === "approved" && institution.utilization != null,
      )
      .sort((left, right) => (right.utilization ?? 0) - (left.utilization ?? 0))
      .slice(0, 8)
      .map((institution) => ({
        label: institution.institutionName,
        value: institution.utilization ?? 0,
        color:
          (institution.utilization ?? 0) >= 80
            ? "#d92d20"
            : (institution.utilization ?? 0) >= 60
              ? "#f79009"
              : "#2f6fed",
      })),
  );

  const weeklyNews = $derived.by(() => {
    if (!report?.previousDate) return [];
    const limitNews = report.limitChanges.map(
      (change) =>
        `${change.institutionName}授信额度${directionText(change.deltaAmount)}${formatAbsAmount(change.deltaAmount)}亿元`,
    );
    const usageNews = report.usageChanges.map(
      (change) =>
        `${change.institutionName}使用额度${directionText(change.deltaAmount)}${formatAbsAmount(change.deltaAmount)}亿元`,
    );
    return [...limitNews, ...usageNews];
  });

  onMount(() => {
    void loadReport();
  });

  async function loadReport(reportDate: string | null = null): Promise<void> {
    loading = true;
    errorMessage = "";
    expandedInstitution = null;
    try {
      report = await fetchCreditReport(reportDate);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "授信数据加载失败";
    } finally {
      loading = false;
    }
  }

  function handleReportDateChange(event: Event): void {
    void loadReport((event.currentTarget as HTMLSelectElement).value);
  }

  function toggleInstitution(institutionName: string): void {
    expandedInstitution =
      expandedInstitution === institutionName ? null : institutionName;
  }

  function printWeeklyReport(): void {
    window.print();
  }

  function statusLabel(status: CreditStatus): string {
    return {
      approved: "已获批",
      applying: "申请中",
      revoked: "已撤销",
      unknown: "未标记",
    }[status];
  }

  function statusTone(status: CreditStatus): "success" | "warning" | "neutral" {
    if (status === "approved") return "success";
    if (status === "applying") return "warning";
    return "neutral";
  }

  function confidentialityLabel(
    status: CreditInstitutionView["confidentialityStatus"],
  ): string {
    if (status === "signed") return "已签署";
    if (status === "not_signed") return "未签署";
    return "未标记";
  }

  function utilizationTone(value: number | null): string {
    if ((value ?? 0) >= 80) return "danger";
    if ((value ?? 0) >= 60) return "warning";
    return "normal";
  }

  function formatAmount(value: number | null | undefined): string {
    return value == null ? "—" : value.toFixed(2);
  }

  function formatDelta(value: number): string {
    return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
  }

  function formatAbsAmount(value: number): string {
    return Math.abs(value).toFixed(2);
  }

  function directionText(value: number): string {
    if (value > 0) return "增加";
    if (value < 0) return "减少";
    return "保持";
  }

  function summaryDelta(
    current: number,
    previous: number | undefined,
  ): string {
    return previous == null ? "暂无上期记录" : `较上期 ${formatDelta(current - previous)} 亿元`;
  }

  function changeKindLabel(kind: CreditAmountChange["kind"]): string {
    if (kind === "added") return "新增";
    if (kind === "removed") return "移出";
    return "变更";
  }

  function daysBetween(start: string, end: string): number {
    return Math.round(
      (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
        86_400_000,
    );
  }
</script>

<div class="tr-view-stack tr-credit-view">
  <section class="tr-credit-toolbar" aria-label="授信报表控制">
    <div class="tr-credit-tabs" role="tablist" aria-label="授信报表">
      <button
        class:active={activeTab === "overview"}
        type="button"
        role="tab"
        aria-selected={activeTab === "overview"}
        onclick={() => (activeTab = "overview")}
      >授信一览表</button>
      <button
        class:active={activeTab === "weekly"}
        type="button"
        role="tab"
        aria-selected={activeTab === "weekly"}
        onclick={() => (activeTab = "weekly")}
      >授信周报</button>
    </div>
    {#if report}
      <div class="tr-credit-toolbar__actions">
        <label>
          <span>报表日</span>
          <select value={report.summary.reportDate} onchange={handleReportDateChange}>
            {#each [...report.availableDates].reverse() as date}
              <option value={date}>{date}</option>
            {/each}
          </select>
        </label>
        {#if activeTab === "weekly"}
          <button class="tr-credit-print" type="button" onclick={printWeeklyReport}>
            打印 / 导出 PDF
          </button>
        {/if}
      </div>
    {/if}
  </section>

  {#if loading}
    <section class="tr-empty-panel" aria-live="polite">
      <WorkbenchIcon name="database" />
      <div><h2>正在读取授信数据</h2><p>从 Neon 的 credit schema 加载报表日记录。</p></div>
    </section>
  {:else if errorMessage || !report}
    <section class="tr-empty-panel" role="alert">
      <WorkbenchIcon name="warning" />
      <div><h2>授信数据暂不可用</h2><p>{errorMessage || "暂无授信记录"}</p></div>
      <button class="tr-credit-retry" type="button" onclick={() => void loadReport()}>重新加载</button>
    </section>
  {:else if activeTab === "overview"}
    <section aria-labelledby="credit-metrics-title">
      <SectionHeading
        id="credit-metrics-title"
        title="授信总览"
        meta={`数据截至 ${report.summary.reportDate} · 一览表全口径 ${report.summary.institutionCount} 家机构`}
      />
      <div class="tr-metric-grid tr-metric-grid--five">
        <MetricCard
          label="授信总额度"
          value={formatAmount(report.summary.totalLimit)}
          unit="亿元"
          detail={`${report.summary.approvedCount} 家已获批`}
          iconComponent={WorkbenchIcon}
          iconProps={{ name: "credit" }}
          tone="blue"
        />
        <MetricCard
          label="已使用额度"
          value={formatAmount(report.summary.totalUsed)}
          unit="亿元"
          detail={`使用率 ${report.summary.utilization.toFixed(1)}%`}
          iconComponent={WorkbenchIcon}
          iconProps={{ name: "funds" }}
          tone="orange"
        />
        <MetricCard
          label="可用额度"
          value={formatAmount(report.summary.totalAvailable)}
          unit="亿元"
          detail="已获批总额减已使用额度"
          iconComponent={WorkbenchIcon}
          iconProps={{ name: "check" }}
          tone="green"
        />
        <MetricCard
          label="近30日到期"
          value={String(report.summary.expiringWithin30Days)}
          unit="家"
          detail="按报表日向后30个自然日"
          iconComponent={WorkbenchIcon}
          iconProps={{ name: "calendar" }}
          tone="purple"
        />
        <MetricCard
          label="风险提示"
          value={String(report.summary.warningCount)}
          unit="项"
          detail="使用率≥80%或近30日到期"
          iconComponent={WorkbenchIcon}
          iconProps={{ name: "warning" }}
          tone="red"
        />
      </div>
    </section>

    <div class="tr-two-column tr-two-column--credit">
      <section class="tr-panel" aria-labelledby="credit-risk-title">
        <PanelHeading id="credit-risk-title" title="高使用率机构">
          <Badge>前 {highUtilizationLines.length} 家</Badge>
        </PanelHeading>
        <ChartHost
          renderer={renderWorkbenchBarChart}
          args={[highUtilizationLines, "授信使用率及百分之六十和百分之八十阈值", "%", 100, [60, 80]]}
          ariaLabel="授信使用率最高机构横向柱状图，标注60%关注线和80%预警线"
          className="tr-chart-host tr-chart-host--credit"
        />
      </section>

      <section class="tr-panel" aria-labelledby="credit-alert-title">
        <PanelHeading id="credit-alert-title" title="授信预警">
          <Badge tone="warning">{report.alerts.length} 项</Badge>
        </PanelHeading>
        <div class="tr-compact-alerts">
          {#each report.alerts.slice(0, 10) as alert (alert.id)}
            <article>
              <span aria-hidden="true"><WorkbenchIcon name="warning" /></span>
              <div><p><strong>{alert.institutionName}</strong>：{alert.message}</p></div>
            </article>
          {:else}
            <p class="tr-credit-muted">当前报表日无高使用率或近30日到期预警。</p>
          {/each}
        </div>
      </section>
    </div>

    <section class="tr-panel" aria-labelledby="credit-table-title">
      <PanelHeading id="credit-table-title" title="授信一览表" wrap>
        <div class="tr-table-controls" role="search">
          <label class="tr-search-control">
            <span class="sr-only">搜索授信机构</span>
            <WorkbenchIcon name="search" />
            <input bind:value={query} type="search" placeholder="机构、性质、经办部门或人员" />
          </label>
          <label>
            <span class="sr-only">授信状态</span>
            <select bind:value={statusFilter}>
              <option value="all">全部状态</option>
              <option value="approved">已获批</option>
              <option value="applying">申请中</option>
              <option value="unknown">未标记</option>
            </select>
          </label>
          <label>
            <span class="sr-only">授信风险</span>
            <select bind:value={riskFilter}>
              <option value="all">全部风险</option>
              <option value="attention">使用率60%及以上</option>
              <option value="warning">使用率80%及以上</option>
              <option value="expiry">近30日到期</option>
            </select>
          </label>
          <span class="tr-result-count">{filteredInstitutions.length} 家</span>
        </div>
      </PanelHeading>
      <div class="tr-table-scroll">
        <table class="tr-data-table tr-credit-table">
          <caption class="sr-only">授信一览表</caption>
          <thead>
            <tr><th>授信主体</th><th>机构性质</th><th>状态</th><th>周报</th><th class="is-numeric">总额度</th><th class="is-numeric">已使用</th><th class="is-numeric">可用</th><th class="is-numeric">使用率</th><th>生效日</th><th>到期日</th><th><span class="sr-only">操作</span></th></tr>
          </thead>
          <tbody>
            {#each filteredInstitutions as institution (institution.institutionName)}
              <tr>
                <th scope="row">{institution.institutionName}</th>
                <td>{institution.institutionType}</td>
                <td><Badge tone={statusTone(institution.status)}>{statusLabel(institution.status)}</Badge></td>
                <td>{institution.includedInWeeklyReport ? "纳入" : "不纳入"}</td>
                <td class="is-numeric">{formatAmount(institution.totalLimit)}</td>
                <td class="is-numeric">{formatAmount(institution.totalUsed)}</td>
                <td class="is-numeric">{formatAmount(institution.availableAmount)}</td>
                <td class="is-numeric"><span class={`tr-utilization tr-utilization--${utilizationTone(institution.utilization)}`}>{institution.utilization == null ? "—" : `${institution.utilization.toFixed(1)}%`}</span></td>
                <td>{institution.effectiveDate ?? "—"}</td>
                <td>{institution.expiryDate ?? "—"}</td>
                <td><button class="tr-credit-detail-toggle" type="button" aria-expanded={expandedInstitution === institution.institutionName} onclick={() => toggleInstitution(institution.institutionName)}>{expandedInstitution === institution.institutionName ? "收起" : "详情"}</button></td>
              </tr>
              {#if expandedInstitution === institution.institutionName}
                <tr class="tr-credit-detail-row">
                  <td colspan="11">
                    <div class="tr-credit-detail">
                      <div class="tr-credit-item-grid">
                        {#each institution.items as item (item.type)}
                          <article>
                            <strong>{creditItemLabels[item.type]}</strong>
                            <span>额度 {formatAmount(item.limitAmount)} 亿</span>
                            <span>已用 {formatAmount(item.usedAmount)} 亿</span>
                            <span>剩余 {formatAmount(item.remainingAmount)} 亿</span>
                            {#if item.details}<small>{item.details}</small>{/if}
                          </article>
                        {/each}
                      </div>
                      <dl class="tr-credit-meta-grid">
                        <div><dt>保密协议</dt><dd>{confidentialityLabel(institution.confidentialityStatus)}</dd></div>
                        <div><dt>银行经办机构</dt><dd>{institution.bankOffice ?? "—"}</dd></div>
                        <div><dt>我司申请部门</dt><dd>{institution.applyingDepartment ?? "—"}</dd></div>
                        <div><dt>我司经办人</dt><dd>{institution.handler ?? "—"}</dd></div>
                        <div class="is-wide"><dt>备注</dt><dd>{institution.notes ?? "—"}</dd></div>
                        <div class="is-wide"><dt>债券投资偏好</dt><dd>{institution.bondPreference ?? "—"}</dd></div>
                        <div class="is-wide"><dt>已用授信具体情况</dt><dd>{institution.usageDetails ?? "—"}</dd></div>
                      </dl>
                    </div>
                  </td>
                </tr>
              {/if}
            {:else}
              <tr><td class="tr-empty-cell" colspan="11">没有符合当前筛选条件的授信记录</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    {#if report.source.warnings.length > 0}
      <section class="tr-panel tr-credit-quality" aria-labelledby="credit-quality-title">
        <PanelHeading id="credit-quality-title" title="源表数据提醒">
          <Badge tone="warning">{report.source.warnings.length} 项</Badge>
        </PanelHeading>
        <ul>{#each report.source.warnings as warning}<li>{warning}</li>{/each}</ul>
      </section>
    {/if}
  {:else}
    <div class="tr-credit-weekly-report">
      <section aria-labelledby="credit-weekly-title">
        <SectionHeading
          id="credit-weekly-title"
          title="授信周报"
          meta={report.previousDate ? `${report.weeklySummary.reportDate} 对比 ${report.previousDate} · 周报名单口径` : `${report.weeklySummary.reportDate} · 暂无上期可比记录`}
        />
        <div class="tr-metric-grid tr-metric-grid--five">
          <MetricCard
            label="周报授信总额"
            value={formatAmount(report.weeklySummary.totalLimit)}
            unit="亿元"
            detail={summaryDelta(report.weeklySummary.totalLimit, report.previousWeeklySummary?.totalLimit)}
            iconComponent={WorkbenchIcon}
            iconProps={{ name: "credit" }}
            tone="blue"
          />
          <MetricCard
            label="周报已使用"
            value={formatAmount(report.weeklySummary.totalUsed)}
            unit="亿元"
            detail={summaryDelta(report.weeklySummary.totalUsed, report.previousWeeklySummary?.totalUsed)}
            iconComponent={WorkbenchIcon}
            iconProps={{ name: "funds" }}
            tone="orange"
          />
          <MetricCard
            label="周报可用余额"
            value={formatAmount(report.weeklySummary.totalAvailable)}
            unit="亿元"
            detail={summaryDelta(report.weeklySummary.totalAvailable, report.previousWeeklySummary?.totalAvailable)}
            iconComponent={WorkbenchIcon}
            iconProps={{ name: "check" }}
            tone="green"
          />
          <MetricCard
            label="授信额度变动"
            value={String(report.limitChanges.length)}
            unit="家"
            detail="含新增、移出、状态和分项额度变化"
            iconComponent={WorkbenchIcon}
            iconProps={{ name: "calendar" }}
            tone="purple"
          />
          <MetricCard
            label="使用额度变动"
            value={String(report.usageChanges.length)}
            unit="家"
            detail="总已用或任一分项已用发生变化"
            iconComponent={WorkbenchIcon}
            iconProps={{ name: "warning" }}
            tone="red"
          />
        </div>
      </section>

      <section class="tr-panel" aria-labelledby="credit-news-title">
        <PanelHeading id="credit-news-title" title="一、本周授信快讯">
          <Badge>{weeklyNews.length} 项</Badge>
        </PanelHeading>
        {#if !report.previousDate}
          <p class="tr-credit-muted">需要至少两个不同报表日，才能生成本周相对上周的变化。</p>
        {:else if weeklyNews.length === 0}
          <p class="tr-credit-muted">本期授信额度及使用额度较上期无变化。</p>
        {:else}
          <ol class="tr-credit-news-list">
            {#each weeklyNews as news}<li>{news}。</li>{/each}
          </ol>
        {/if}
      </section>

      <section class="tr-panel" aria-labelledby="credit-limit-changes-title">
        <PanelHeading id="credit-limit-changes-title" title="二、授信额度变动">
          <Badge tone={report.limitChanges.length ? "warning" : "success"}>{report.limitChanges.length} 家</Badge>
        </PanelHeading>
        <div class="tr-table-scroll">
          <table class="tr-data-table tr-credit-change-table">
            <caption class="sr-only">本周相对上周的授信额度变动</caption>
            <thead><tr><th>机构</th><th>性质</th><th>类型</th><th class="is-numeric">上期总额</th><th class="is-numeric">本期总额</th><th class="is-numeric">变化</th><th>变化说明</th></tr></thead>
            <tbody>
              {#each report.limitChanges as change (change.institutionName)}
                <tr><th scope="row">{change.institutionName}</th><td>{change.institutionType}</td><td>{changeKindLabel(change.kind)}</td><td class="is-numeric">{formatAmount(change.previousAmount)}</td><td class="is-numeric">{formatAmount(change.currentAmount)}</td><td class={`is-numeric tr-change ${change.deltaAmount > 0 ? "tr-change--up" : change.deltaAmount < 0 ? "tr-change--down" : ""}`}>{formatDelta(change.deltaAmount)}</td><td class="tr-credit-change-details">{change.details.join("；")}</td></tr>
              {:else}
                <tr><td class="tr-empty-cell" colspan="7">本期授信额度较上期无变化</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>

      <section class="tr-panel" aria-labelledby="credit-usage-changes-title">
        <PanelHeading id="credit-usage-changes-title" title="三、使用额度变动">
          <Badge tone={report.usageChanges.length ? "warning" : "success"}>{report.usageChanges.length} 家</Badge>
        </PanelHeading>
        <div class="tr-table-scroll">
          <table class="tr-data-table tr-credit-change-table">
            <caption class="sr-only">本周相对上周的使用额度变动</caption>
            <thead><tr><th>机构</th><th>性质</th><th class="is-numeric">上期已用</th><th class="is-numeric">本期已用</th><th class="is-numeric">变化</th><th>变化说明</th></tr></thead>
            <tbody>
              {#each report.usageChanges as change (change.institutionName)}
                <tr><th scope="row">{change.institutionName}</th><td>{change.institutionType}</td><td class="is-numeric">{formatAmount(change.previousAmount)}</td><td class="is-numeric">{formatAmount(change.currentAmount)}</td><td class={`is-numeric tr-change ${change.deltaAmount > 0 ? "tr-change--up" : "tr-change--down"}`}>{formatDelta(change.deltaAmount)}</td><td class="tr-credit-change-details">{change.details.join("；")}</td></tr>
              {:else}
                <tr><td class="tr-empty-cell" colspan="6">本期使用额度较上期无变化</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>

      <footer class="tr-credit-report-source">
        数据来源：{report.source.fileName} · 导入时间 {report.source.importedAt}
      </footer>
    </div>
  {/if}
</div>
