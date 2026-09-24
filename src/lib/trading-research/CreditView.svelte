<script lang="ts">
  import { Input } from "$lib/components/ui/input/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { NativeSelect } from "$lib/components/ui/native-select/index.js";
  import { onMount } from "svelte";

  import ChartHost from "../../components/ChartHost.svelte";
  import MetricCard from "../../components/MetricCard.svelte";
  import ModuleCard from "../../components/ModuleCard.svelte";
  import { renderWorkbenchBarChart } from "../../charts/trading-research";
  import MultiSelectFilter from "../financing/MultiSelectFilter.svelte";
  import { creditLimitFilterLabels, matchesCreditCalendarEvent } from "../credit/calendar.ts";
  import { portal } from "../portal.ts";
  import { scrollableRegion } from "../scrollable-region";
  import { fetchCreditReport } from "../credit/client.ts";
  import {
    creditItemLabels,
    creditItemTypes,
    type CreditInstitutionView,
    type CreditItemType,
    type CreditReportResponse,
    type CreditWeeklyNewsItem,
  } from "../credit/types.ts";
  import { compareCreditInstitutionOrder, matchesCreditStatus } from "../credit/presentation.ts";
  import { creditEffectiveStatus, isCreditEffective, type CreditEffectiveStatus } from "../credit/validity.ts";
  import { formatCreditWeeklyNews } from "../credit/weekly-news.ts";
  import CreditApplicationDialog from "./CreditApplicationDialog.svelte";
  import Badge from "./Badge.svelte";
  import PanelHeading from "./PanelHeading.svelte";
  import SectionHeading from "./SectionHeading.svelte";
  import WorkbenchIcon from "./WorkbenchIcon.svelte";

  type CreditTab = "overview" | "calendar" | "weekly";
  type CreditAlert = {
    id: string;
    level: "critical" | "high" | "medium" | "low";
    label: string;
    meta: string;
    text: string;
  };
  type SortKey =
    | "institutionName"
    | "institutionType"
    | "status"
    | "totalLimit"
    | "totalUsed"
    | "availableAmount"
    | "utilization"
    | "effectiveDate"
    | "expiryDate";

  const weekdays = ["一", "二", "三", "四", "五", "六", "日"];

  let { tab = "overview", onreport }: { tab?: CreditTab; onreport?: (report: CreditReportResponse) => void } = $props();
  const activeTab = $derived(tab);
  let report = $state<CreditReportResponse | null>(null);
  $effect(() => { if (report) onreport?.(report); });
  let loading = $state(true);
  let errorMessage = $state("");
  let query = $state("");
  let statusFilter = $state<CreditEffectiveStatus | "active" | "all">("active");
  let riskFilter = $state("all");
  let expandedInstitution = $state<string | null>(null);
  let sortKey = $state<SortKey>("institutionType");
  let sortDirection = $state<"ascending" | "descending">("ascending");
  let calendarLimitFilters = $state<string[]>([]);
  let calendarUsageFilters = $state<string[]>([]);
  let calendarMonth = $state("");
  let applicationDialog = $state<CreditApplicationDialog | null>(null);
  let loadSequence = 0;

  const filteredInstitutions = $derived.by(() => {
    const currentReport = report;
    if (!currentReport) return [];
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return currentReport.institutions
      .filter((institution) => {
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
          matchesCreditStatus(creditEffectiveStatus(institution), statusFilter);
        const matchesRisk =
          riskFilter === "all" ||
          (riskFilter === "attention" && isCreditEffective(institution) && (institution.utilization ?? 0) >= 60) ||
          (riskFilter === "warning" && isCreditEffective(institution) && (institution.utilization ?? 0) >= 80) ||
          (riskFilter === "expiry" && isCreditEffective(institution) &&
            Boolean(
              institution.expiryDate &&
                daysBetween(currentReport.summary.reportDate, institution.expiryDate) >= 0 &&
                daysBetween(currentReport.summary.reportDate, institution.expiryDate) <= 30,
            ));
        return matchesQuery && matchesStatus && matchesRisk;
      })
      .sort(compareInstitutions);
  });

  const weeklyNews = $derived.by(() => {
    return report?.weeklyNews.map(formatCreditWeeklyNews) ?? [];
  });

  const weeklyCreditDetailGroups = $derived.by(() => {
    const groups = new Map<string, CreditInstitutionView[]>();
    const institutions = (report?.institutions ?? [])
      .filter(
        (institution) =>
          institution.status !== "revoked",
      )
      .sort(compareCreditInstitutionOrder);
    for (const institution of institutions) {
      const group = groups.get(institution.institutionType) ?? [];
      group.push(institution);
      groups.set(institution.institutionType, group);
    }
    return [...groups].map(([institutionType, groupedInstitutions]) => ({
      institutionType,
      institutions: groupedInstitutions,
    }));
  });

  const creditUsageRows = $derived.by(() =>
    (report?.institutions ?? [])
      .filter(
        (institution) =>
          isCreditEffective(institution) &&
          institution.utilization != null &&
          institution.totalLimit != null &&
          institution.totalLimit > 0,
      )
      .sort((left, right) =>
        (right.utilization ?? 0) - (left.utilization ?? 0),
      )
      .slice(0, 10)
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

  const creditAlerts = $derived.by(() => {
    const currentReport = report;
    if (!currentReport) return [];
    const alerts: CreditAlert[] = [];
    for (const institution of currentReport.institutions) {
      const utilization = institution.utilization ?? 0;
      if (isCreditEffective(institution) && utilization >= 60) {
        alerts.push({
          id: `usage-${institution.institutionName}`,
          level: utilization >= 80 ? "critical" : "medium",
          label: utilization >= 80 ? "额度预警" : "额度关注",
          meta: `${utilization.toFixed(1)}%`,
          text: `${institution.institutionName}授信额度使用率达到${utilization.toFixed(1)}%，${utilization >= 80 ? "已超过80%预警线" : "已超过60%关注线"}`,
        });
      }
      if (institution.expiryDate && isCreditEffective(institution)) {
        const remainingDays = daysBetween(
          currentReport.summary.reportDate,
          institution.expiryDate,
        );
        if (remainingDays >= 0 && remainingDays <= 30) {
          alerts.push({
            id: `expiry-${institution.institutionName}`,
            level: remainingDays <= 7 ? "critical" : "high",
            label: "到期预警",
            meta: `${remainingDays}天`,
            text: `${institution.institutionName}授信将在${remainingDays}天内到期，需安排续作材料`,
          });
        }
      }
    }
    const order = { critical: 0, high: 1, medium: 2, low: 3 } as const;
    return alerts.sort((left, right) => order[left.level] - order[right.level]);
  });

  const calendarCells = $derived.by(() => {
    if (!calendarMonth) return [];
    const first = new Date(`${calendarMonth}-01T00:00:00Z`);
    const mondayOffset = (first.getUTCDay() + 6) % 7;
    first.setUTCDate(first.getUTCDate() - mondayOffset);
    const visibleEvents = (report?.calendarEvents ?? []).filter(
      (event) => matchesCreditCalendarEvent(event, calendarLimitFilters, calendarUsageFilters),
    );
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(first);
      date.setUTCDate(date.getUTCDate() + index);
      const dateKey = date.toISOString().slice(0, 10);
      return {
        date: dateKey,
        day: date.getUTCDate(),
        outside: dateKey.slice(0, 7) !== calendarMonth,
        reportDate: dateKey === report?.summary.reportDate,
        events: visibleEvents.filter((event) => event.date === dateKey),
      };
    });
  });

  onMount(() => {
    void loadReport();
  });

  async function loadReport(reportDate: string | null = null, month?: string): Promise<void> {
    const sequence = ++loadSequence;
    loading = true;
    errorMessage = "";
    expandedInstitution = null;
    try {
      const result = await fetchCreditReport(reportDate,fetch,month);
      if (sequence !== loadSequence) return;
      report = result;
      calendarMonth = month ?? report.summary.reportDate.slice(0, 7);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "授信数据加载失败";
    } finally {
      if (sequence === loadSequence) loading = false;
    }
  }

  function handleReportDateChange(event: Event): void {
    void loadReport((event.currentTarget as HTMLSelectElement).value);
  }

  function toggleInstitution(institution: CreditInstitutionView): void {
    expandedInstitution = expandedInstitution === institution.institutionName ? null : institution.institutionName;
  }

  function toggleSort(key: SortKey): void {
    if (sortKey === key) {
      sortDirection = sortDirection === "ascending" ? "descending" : "ascending";
    } else {
      sortKey = key;
      sortDirection = "ascending";
    }
  }

  function compareInstitutions(
    left: CreditInstitutionView,
    right: CreditInstitutionView,
  ): number {
    if (sortKey === "institutionType") {
      const result = compareCreditInstitutionOrder(left, right);
      return sortDirection === "ascending" ? result : -result;
    }
    const leftValue = sortValue(left, sortKey);
    const rightValue = sortValue(right, sortKey);
    if (leftValue == null && rightValue == null) return 0;
    if (leftValue == null) return 1;
    if (rightValue == null) return -1;
    const result = typeof leftValue === "number" && typeof rightValue === "number"
      ? leftValue - rightValue
      : String(leftValue).localeCompare(String(rightValue), "zh-CN", {
          numeric: true,
        });
    return sortDirection === "ascending" ? result : -result;
  }

  function sortValue(
    institution: CreditInstitutionView,
    key: SortKey,
  ): string | number | null {
    if (key === "status") return statusLabel(creditEffectiveStatus(institution));
    return institution[key];
  }

  function sortIndicator(key: SortKey): string {
    if (sortKey !== key) return "⇅";
    return sortDirection === "ascending" ? "↑" : "↓";
  }

  function ariaSort(key: SortKey): "ascending" | "descending" | "none" {
    return sortKey === key ? sortDirection : "none";
  }

  function shiftCalendarMonth(offset: number): void {
    const date = new Date(`${calendarMonth}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + offset);
    void loadReport(report?.summary.reportDate ?? null,date.toISOString().slice(0, 7));
  }

  function calendarMonthLabel(month: string): string {
    const [year, monthNumber] = month.split("-");
    return `${year}年${Number(monthNumber)}月`;
  }

  function printWeeklyReport(): void {
    window.print();
  }

  function statusLabel(status: CreditEffectiveStatus): string {
    return {
      approved: "已获批",
      applying: "申请中",
      revoked: "已撤销",
      expired: "已到期",
      pending: "未生效",
    }[status];
  }

  function statusTone(status: CreditEffectiveStatus): "success" | "warning" | "neutral" {
    if (status === "approved") return "success";
    if (status === "applying" || status === "expired") return "warning";
    return "neutral";
  }

  function formatAmount(value: number | null | undefined): string {
    return value == null ? "—" : value.toFixed(2);
  }

  function creditEventLabel(eventType: CreditWeeklyNewsItem["eventType"]): string {
    return {
      new: "新增",
      renewal: "续作",
      renewal_increase: "续作及扩额",
      increase: "扩额",
      expiry: "到期",
      revocation: "撤销",
      decrease: "缩额",
      amendment: "调整",
    }[eventType];
  }

  function creditEventTone(
    eventType: CreditWeeklyNewsItem["eventType"],
  ): "info" | "success" | "warning" | "neutral" {
    if (eventType === "new") return "success";
    if (eventType === "increase" || eventType === "renewal_increase") return "warning";
    if (eventType === "renewal") return "info";
    return "neutral";
  }

  function formatCreditPeriod(event: CreditWeeklyNewsItem): string {
    const start = event.currentEffectiveDate ?? event.previousEffectiveDate ?? "—";
    const end = event.currentExpiryDate ?? event.previousExpiryDate ?? "—";
    return `${start} 至 ${end}`;
  }

  function formatApprovalDetails(event: CreditWeeklyNewsItem): string {
    const details = event.creditDetails.map((item) => {
      const amount = item.limitAmount == null ? "" : `${formatAmount(item.limitAmount)}亿`;
      const note = item.details?.trim() ? `（${item.details.trim()}）` : "";
      return `${creditItemLabels[item.type]}${amount ? ` ${amount}` : ""}${note}`;
    });
    return details.length ? details.join("；") : "—";
  }

  function daysBetween(start: string, end: string): number {
    return Math.round(
      (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
        86_400_000,
    );
  }
</script>

<div class="tr-view-stack tr-credit-view">
  <div
    class="tr-credit-toolbar"
    aria-label="授信报表控制"
    use:portal={"#tr-topbar-actions"}
  >
    {#if report}
      <div class="tr-credit-toolbar__actions">
        <label>
          <span>数据日期</span>
          <Input data-ui-owner="lib-trading-research-CreditView-svelte" class={"ui-input"} type="date" min={report.availableDates[0]} value={report.summary.reportDate} onchange={handleReportDateChange} />
        </label>
        {#if activeTab === "weekly"}
          <Button data-ui-owner="lib-trading-research-CreditView-svelte" variant="outline" class={"ui-button tr-credit-print"} type="button" onclick={printWeeklyReport}>打印 / 导出 PDF</Button>
        {/if}
      </div>
    {/if}
    {#if report && activeTab === "overview"}<Button permission="credit.institution:update" data-ui-owner="lib-trading-research-CreditView-svelte" variant="default" class={"ui-button"} type="button" onclick={() => applicationDialog?.open()}>授信申请</Button>{/if}
  </div>

  {#if report && activeTab === "overview"}
    <CreditApplicationDialog bind:this={applicationDialog} institutions={report.institutions} reportDate={report.summary.reportDate} onapplied={async (date) => loadReport(date)} />
  {/if}

  {#if loading}
    <section class="tr-empty-panel" aria-live="polite">
      <WorkbenchIcon name="database" />
      <h2>正在读取授信数据</h2>
    </section>
  {:else if errorMessage || !report}
    <section class="tr-empty-panel" role="alert">
      <WorkbenchIcon name="warning" />
      <div><h2>授信数据暂不可用</h2><p>{errorMessage || "暂无授信记录"}</p></div>
      <Button data-ui-owner="lib-trading-research-CreditView-svelte" variant="outline" class={"ui-button tr-credit-retry"} type="button" onclick={() => void loadReport()}>重新加载</Button>
    </section>
  {:else if activeTab === "overview"}
    <section aria-labelledby="credit-metrics-title">
      <SectionHeading id="credit-metrics-title" title="授信总览" />
      <div class="tr-metric-grid tr-metric-grid--five tr-credit-metric-grid">
        <MetricCard label="授信总额" value={report.summary.totalLimit.toFixed(1)} unit="亿元" detail={`${report.summary.institutionCount}家机构`} iconComponent={WorkbenchIcon} iconProps={{ name: "credit" }} tone="blue" compact />
        <MetricCard label="已用额度" value={report.summary.totalUsed.toFixed(1)} unit="亿元" iconComponent={WorkbenchIcon} iconProps={{ name: "funds" }} tone="orange" compact />
        <MetricCard label="可用额度" value={report.summary.totalAvailable.toFixed(1)} unit="亿元" iconComponent={WorkbenchIcon} iconProps={{ name: "check" }} tone="green" compact />
        <MetricCard label="30日内到期" value={String(report.summary.expiringWithin30Days)} unit="笔" iconComponent={WorkbenchIcon} iconProps={{ name: "calendar" }} tone="red" compact />
        <MetricCard label="额度使用率" value={report.summary.utilization.toFixed(1)} unit="%" detail={report.previousSummary ? `${report.summary.utilization - report.previousSummary.utilization >= 0 ? "+" : ""}${(report.summary.utilization - report.previousSummary.utilization).toFixed(1)}个百分点较上期` : `${report.summary.approvedCount}家已获批`} iconComponent={WorkbenchIcon} iconProps={{ name: "warning" }} tone="purple" compact />
      </div>
    </section>

    <div class="tr-two-column tr-two-column--credit">
      <ModuleCard labelledBy="credit-usage-title">
        <PanelHeading id="credit-usage-title" title="授信额度使用率">
          <Badge tone="warning">60%关注 · 80%预警</Badge>
        </PanelHeading>
        {#if creditUsageRows.length}
          <ChartHost
            renderer={renderWorkbenchBarChart}
            args={[creditUsageRows, "授信机构额度使用率及60%和80%阈值", "%", 100, [60, 80]]}
            ariaLabel="授信机构额度使用率及60%和80%阈值横向柱状图"
            className="tr-chart-host"
          />
        {:else}
          <p class="tr-empty-state">暂无可展示的已获批授信使用率</p>
        {/if}
      </ModuleCard>

      <ModuleCard labelledBy="credit-alerts-title">
        <PanelHeading id="credit-alerts-title" title="授信预警">
          <Badge tone={creditAlerts.length ? "warning" : "success"}>{creditAlerts.length} 项</Badge>
        </PanelHeading>
        <div class="tr-alert-list tr-credit-alert-list">
          {#each creditAlerts as alert (alert.id)}
            <article class={`tr-alert tr-alert--${alert.level}`}>
              <span class="tr-alert__icon" aria-hidden="true"><WorkbenchIcon name="warning" /></span>
              <div>
                <div class="tr-alert__meta"><strong>{alert.label}</strong><span>{alert.meta}</span></div>
                <p>{alert.text}</p>
              </div>
            </article>
          {:else}
            <p class="tr-empty-state">当前无额度使用率或30日内到期预警</p>
          {/each}
        </div>
      </ModuleCard>
    </div>

    <ModuleCard labelledBy="credit-table-title">
      <PanelHeading id="credit-table-title" title="授信一览表" wrap>
        <div class="tr-table-controls" role="search">
          <label class="tr-search-control">
            <span class="sr-only">搜索授信机构</span>
            <WorkbenchIcon name="search" />
            <Input data-ui-owner="lib-trading-research-CreditView-svelte" class={"ui-input"} bind:value={query} type="search" />
          </label>
          <label>
            <span class="sr-only">授信状态</span>
            <NativeSelect data-ui-owner="lib-trading-research-CreditView-svelte" class={"ui-select"} bind:value={statusFilter}>
              <option value="active">未撤销</option>
              <option value="all">全部状态</option>
              <option value="approved">已获批</option>
              <option value="expired">已到期</option>
              <option value="pending">未生效</option>
              <option value="applying">申请中</option>
              <option value="revoked">已撤销</option>
            </NativeSelect>
          </label>
          <label>
            <span class="sr-only">授信风险</span>
            <NativeSelect data-ui-owner="lib-trading-research-CreditView-svelte" class={"ui-select"} bind:value={riskFilter}>
              <option value="all">全部风险</option>
              <option value="attention">使用率60%及以上</option>
              <option value="warning">使用率80%及以上</option>
              <option value="expiry">近30日到期</option>
            </NativeSelect>
          </label>
        </div>
      </PanelHeading>
      <div class="tr-table-scroll" role="region" aria-label="授信机构记录" use:scrollableRegion>
        <table class="tr-data-table tr-credit-table">
          <caption class="sr-only">授信一览表</caption>
          <thead>
            <tr>
              <th>序号</th>
              <th aria-sort={ariaSort("institutionName")}><Button data-ui-owner="lib-trading-research-CreditView-svelte" variant="ghost" class={"ui-button tr-sort-button"} type="button" onclick={() => toggleSort("institutionName")}>授信主体<span aria-hidden="true">{sortIndicator("institutionName")}</span></Button></th>
              <th aria-sort={ariaSort("institutionType")}><Button data-ui-owner="lib-trading-research-CreditView-svelte" variant="ghost" class={"ui-button tr-sort-button"} type="button" onclick={() => toggleSort("institutionType")}>机构性质<span aria-hidden="true">{sortIndicator("institutionType")}</span></Button></th>
              <th aria-sort={ariaSort("status")}><Button data-ui-owner="lib-trading-research-CreditView-svelte" variant="ghost" class={"ui-button tr-sort-button"} type="button" onclick={() => toggleSort("status")}>状态<span aria-hidden="true">{sortIndicator("status")}</span></Button></th>
              <th class="is-numeric" aria-sort={ariaSort("totalLimit")}><Button data-ui-owner="lib-trading-research-CreditView-svelte" variant="ghost" class={"ui-button tr-sort-button tr-sort-button--numeric"} type="button" onclick={() => toggleSort("totalLimit")}>总额度<span aria-hidden="true">{sortIndicator("totalLimit")}</span></Button></th>
              <th class="is-numeric" aria-sort={ariaSort("totalUsed")}><Button data-ui-owner="lib-trading-research-CreditView-svelte" variant="ghost" class={"ui-button tr-sort-button tr-sort-button--numeric"} type="button" onclick={() => toggleSort("totalUsed")}>已使用<span aria-hidden="true">{sortIndicator("totalUsed")}</span></Button></th>
              <th class="is-numeric" aria-sort={ariaSort("availableAmount")}><Button data-ui-owner="lib-trading-research-CreditView-svelte" variant="ghost" class={"ui-button tr-sort-button tr-sort-button--numeric"} type="button" onclick={() => toggleSort("availableAmount")}>可用<span aria-hidden="true">{sortIndicator("availableAmount")}</span></Button></th>
              <th class="is-numeric" aria-sort={ariaSort("utilization")}><Button data-ui-owner="lib-trading-research-CreditView-svelte" variant="ghost" class={"ui-button tr-sort-button tr-sort-button--numeric"} type="button" onclick={() => toggleSort("utilization")}>使用率<span aria-hidden="true">{sortIndicator("utilization")}</span></Button></th>
              <th aria-sort={ariaSort("effectiveDate")}><Button data-ui-owner="lib-trading-research-CreditView-svelte" variant="ghost" class={"ui-button tr-sort-button"} type="button" onclick={() => toggleSort("effectiveDate")}>生效日<span aria-hidden="true">{sortIndicator("effectiveDate")}</span></Button></th>
              <th aria-sort={ariaSort("expiryDate")}><Button data-ui-owner="lib-trading-research-CreditView-svelte" variant="ghost" class={"ui-button tr-sort-button"} type="button" onclick={() => toggleSort("expiryDate")}>到期日<span aria-hidden="true">{sortIndicator("expiryDate")}</span></Button></th>
              <th><span class="sr-only">操作</span></th>
            </tr>
          </thead>
          <tbody>
            {#each filteredInstitutions as institution, index (institution.institutionName)}
              <tr>
                <td>{index + 1}</td>
                <th scope="row">{institution.institutionName}</th>
                <td>{institution.institutionType}</td>
                <td><Badge tone={statusTone(creditEffectiveStatus(institution))}>{statusLabel(creditEffectiveStatus(institution))}</Badge></td>
                <td class="is-numeric">{formatAmount(institution.totalLimit)}</td>
                <td class="is-numeric">{formatAmount(institution.totalUsed)}</td>
                <td class="is-numeric">{formatAmount(institution.availableAmount)}</td>
                <td class="is-numeric">{institution.utilization == null ? "—" : `${institution.utilization.toFixed(1)}%`}</td>
                <td>{institution.effectiveDate ?? "—"}</td>
                <td>{institution.expiryDate ?? "—"}</td>
                <td><Button data-ui-owner="lib-trading-research-CreditView-svelte" variant="ghost" class={"ui-button tr-credit-detail-toggle"} type="button" aria-expanded={expandedInstitution === institution.institutionName} onclick={() => toggleInstitution(institution)}>{expandedInstitution === institution.institutionName ? "收起" : "详情"}</Button></td>
              </tr>
              {#if expandedInstitution === institution.institutionName}
                <tr class="tr-credit-detail-row">
                  <td colspan="11">
                    <div class="tr-credit-detail">
                      <div class="tr-credit-editor-head"><strong>{institution.institutionName} · {institution.reportDate}</strong></div>
                      <div class="tr-credit-editor-grid">
                        <label><span>机构性质</span><Input readonly value={institution.institutionType} /></label>
                        <label><span>审批状态</span><Input readonly value={statusLabel(institution.status)} /></label>
                        <label><span>截至所选日状态</span><Input readonly value={statusLabel(creditEffectiveStatus(institution))} /></label>
                        <label><span>保密协议</span><Input readonly value={institution.confidentialityStatus ? '已签署' : '未签署'} /></label>
                        <label><span>授信总额（亿元）</span><Input readonly value={formatAmount(institution.totalLimit)} /></label>
                        <label><span>已用额度（亿元）</span><Input readonly value={formatAmount(institution.totalUsed)} /></label>
                        <label><span>可用额度（亿元）</span><Input readonly value={formatAmount(institution.availableAmount)} /></label>
                        <label><span>生效日</span><Input readonly value={institution.effectiveDate ?? '—'} /></label>
                        <label><span>到期日</span><Input readonly value={institution.expiryDate ?? '—'} /></label>
                        <label><span>关联客户</span><Input readonly value={institution.clients?.map(client => client.name).join('、') || '—'} /></label>
                        <label><span>银行经办机构</span><Input readonly value={institution.bankOffice ?? '—'} /></label>
                        <label><span>我司申请部门</span><Input readonly value={institution.applyingDepartment ?? '—'} /></label>
                        <label><span>我司经办人</span><Input readonly value={institution.handler ?? '—'} /></label>
                      </div>
                      <div class="tr-credit-item-grid">
                        {#each institution.items as item (item.type)}
                          <fieldset>
                            <legend>{creditItemLabels[item.type]}</legend>
                            <label><span>额度（亿元）</span><Input readonly value={formatAmount(item.limitAmount)} /></label>
                            <label><span>{item.type === 'bond_investment' ? '已用合计（亿元）' : '已用（亿元）'}</span><Input readonly value={formatAmount(item.usedAmount)} /></label>
                            {#if item.type === 'bond_investment'}
                              <label><span>一级发行存续额（亿元）</span><Input readonly value={formatAmount(item.primaryUsedAmount)} /></label>
                              <label><span>二级买卖净余额（亿元）</span><Input readonly value={formatAmount(item.secondaryUsedAmount)} /></label>
                            {/if}
                            <label><span>可用（亿元）</span><Input readonly value={formatAmount(item.remainingAmount)} /></label>
                            <label><span>说明</span><Input readonly value={item.details ?? '—'} /></label>
                          </fieldset>
                        {/each}
                      </div>
                      <div class="tr-credit-notes-grid">
                        <label><span>授信额度描述</span><Input readonly value={institution.detail ?? '—'} /></label>
                        <label><span>债券投资偏好</span><Input readonly value={institution.bondPreference ?? '—'} /></label>
                        <label><span>备注</span><Input readonly value={institution.notes ?? '—'} /></label>
                      </div>
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
    </ModuleCard>
  {:else if activeTab === "calendar"}
    <section aria-labelledby="credit-calendar-title">
      <SectionHeading id="credit-calendar-title" title="授信日历" />
      <ModuleCard class="tr-credit-calendar-panel" labelledBy="credit-calendar-title">
        <div class="tr-credit-calendar-toolbar">
          <div class="tr-credit-calendar-filter" role="group" aria-label="授信日历筛选">
            <MultiSelectFilter label="额度" options={Object.keys(creditLimitFilterLabels)} optionLabels={creditLimitFilterLabels} bind:values={calendarLimitFilters} />
            <MultiSelectFilter label="已用" options={[...creditItemTypes]} optionLabels={creditItemLabels} bind:values={calendarUsageFilters} />
          </div>
          <div class="tr-credit-calendar-nav">
            <Button data-ui-owner="lib-trading-research-CreditView-svelte" variant="outline" class={"ui-button"} type="button" aria-label="上一个月" onclick={() => shiftCalendarMonth(-1)}>‹</Button>
            <strong>{calendarMonthLabel(calendarMonth)}</strong>
            <Button data-ui-owner="lib-trading-research-CreditView-svelte" variant="outline" class={"ui-button"} type="button" aria-label="下一个月" onclick={() => shiftCalendarMonth(1)}>›</Button>
          </div>
        </div>
        <div class="tr-credit-calendar-scroll" role="region" aria-label="授信日历，左右滚动查看完整日期" use:scrollableRegion>
        <div class="tr-credit-calendar" role="grid" aria-label={`${calendarMonthLabel(calendarMonth)}授信事件`}>
          {#each weekdays as weekday}<div class="tr-credit-calendar-weekday" role="columnheader">{weekday}</div>{/each}
          {#each calendarCells as cell (cell.date)}
            <div class:outside={cell.outside} class:report-date={cell.reportDate} class="tr-credit-calendar-cell" role="gridcell" aria-label={cell.date}>
              <time datetime={cell.date}>{cell.day}</time>
              <div class="tr-credit-calendar-events">
                {#each cell.events as event (event.id)}
                  <article class={`tr-credit-calendar-event tr-credit-calendar-event--${event.type} tr-credit-calendar-event--${event.status}`} title={`${event.institutionName} · ${event.label} · ${event.statusLabel}`} aria-label={`${event.institutionName} · ${event.label} · ${event.statusLabel}`}>
                    <strong>{event.institutionName}</strong>
                    <span>{event.label}</span>
                  </article>
                {/each}
              </div>
            </div>
          {/each}
        </div>
        </div>
      </ModuleCard>
    </section>
  {:else}
    <div class="tr-credit-weekly-report layout-report layout-report--credit">
      <section aria-labelledby="credit-weekly-title">
        <SectionHeading id="credit-weekly-title" title="授信周报" />
        <div class="tr-metric-grid tr-metric-grid--five">
          <MetricCard label="授信总额" value={formatAmount(report.weeklySummary.totalLimit)} unit="亿元" iconComponent={WorkbenchIcon} iconProps={{ name: "credit" }} tone="blue" />
          <MetricCard label="已用额度" value={formatAmount(report.weeklySummary.totalUsed)} unit="亿元" iconComponent={WorkbenchIcon} iconProps={{ name: "funds" }} tone="orange" />
          <MetricCard label="可用额度" value={formatAmount(report.weeklySummary.totalAvailable)} unit="亿元" iconComponent={WorkbenchIcon} iconProps={{ name: "check" }} tone="green" />
          <MetricCard label="新增授信" value={String(report.weeklySummary.addedInstitutionCount)} unit="家" iconComponent={WorkbenchIcon} iconProps={{ name: "calendar" }} tone="purple" />
          <MetricCard label="到期" value={String(report.weeklySummary.expiredInstitutionCount)} unit="家" iconComponent={WorkbenchIcon} iconProps={{ name: "warning" }} tone="red" />
        </div>
      </section>

      <ModuleCard labelledBy="credit-news-title">
        <PanelHeading id="credit-news-title" title="本周授信快讯" />
        {#if weeklyNews.length === 0}
          <p class="tr-credit-muted">{report.previousDate ? '本期无新增、续作、扩额、到期或撤销事项。' : '暂无周度变化'}</p>
        {:else}
          <ol class="tr-credit-news-list">{#each weeklyNews as news}<li>{news}</li>{/each}</ol>
        {/if}
      </ModuleCard>

      <ModuleCard labelledBy="credit-recent-approvals-title">
        <PanelHeading id="credit-recent-approvals-title" title="近期新增授信批复（近6个月）" />
        <div class="tr-table-scroll">
          <table class="tr-data-table tr-credit-approval-table">
            <caption class="sr-only">所选报表日前近6个月新增、续作和扩额授信批复</caption>
            <thead><tr><th>银行名称</th><th>起始到期日</th><th class="is-numeric">授信额度（亿）</th><th>授信明细</th></tr></thead>
            <tbody>
              {#each report.recentApprovals as approval (`${approval.reportDate}:${approval.institutionName}`)}
                <tr>
                  <th scope="row"><span class="tr-credit-bank-event"><span>{approval.institutionName}</span><Badge tone={creditEventTone(approval.eventType)}>{creditEventLabel(approval.eventType)}</Badge></span></th>
                  <td>{formatCreditPeriod(approval)}</td>
                  <td class="is-numeric">{formatAmount(approval.currentAmount)}</td>
                  <td class="tr-credit-approval-details">{formatApprovalDetails(approval)}</td>
                </tr>
              {:else}
                <tr><td class="tr-empty-cell" colspan="4">近6个月无新增、续作或扩额授信批复</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      </ModuleCard>

      <ModuleCard labelledBy="credit-detail-title">
        <PanelHeading id="credit-detail-title" title="授信明细" />
        <div class="tr-table-scroll">
          <table class="tr-data-table tr-credit-weekly-detail-table">
            <caption class="sr-only">授信额度明细</caption>
            <thead>
              <tr><th rowspan="2">银行性质</th><th rowspan="2">银行名称</th><th colspan="3" class="is-centered">授信额度</th></tr>
              <tr><th class="is-numeric">总额度（亿）</th><th class="is-numeric">可用额度（亿）</th><th class="is-numeric">使用率</th></tr>
            </thead>
            <tbody>
              {#each weeklyCreditDetailGroups as group (group.institutionType)}
                {#each group.institutions as institution, index (institution.institutionName)}
                  <tr>
                    {#if index === 0}<th rowspan={group.institutions.length} scope="rowgroup">{group.institutionType}</th>{/if}
                    <th scope="row">{institution.institutionName}</th>
                    <td class="is-numeric">{formatAmount(institution.totalLimit)}</td>
                    <td class="is-numeric">{formatAmount(institution.availableAmount)}</td>
                    <td class="is-numeric">{institution.utilization == null ? "—" : `${institution.utilization.toFixed(1)}%`}</td>
                  </tr>
                {/each}
              {:else}
                <tr><td class="tr-empty-cell" colspan="5">暂无已获批的周报授信明细</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      </ModuleCard>
    </div>
  {/if}
</div>
