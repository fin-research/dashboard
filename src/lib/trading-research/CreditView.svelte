<script lang="ts">
  import { onDestroy, onMount } from "svelte";

  import MetricCard from "../../components/MetricCard.svelte";
  import { portal } from "../portal.ts";
  import {
    fetchCreditReport,
    updateCreditInstitution,
  } from "../credit/client.ts";
  import {
    creditItemLabels,
    type CreditAmountChange,
    type CreditCalendarEvent,
    type CreditInstitutionView,
    type CreditItemType,
    type CreditReportResponse,
    type CreditStatus,
  } from "../credit/types.ts";
  import { formatCreditWeeklyNews } from "../credit/weekly-news.ts";
  import type {
    CreditInstitutionChanges,
    CreditInstitutionUpdateInput,
    CreditItemChanges,
  } from "../credit/update.ts";
  import Badge from "./Badge.svelte";
  import PanelHeading from "./PanelHeading.svelte";
  import SectionHeading from "./SectionHeading.svelte";
  import WorkbenchIcon from "./WorkbenchIcon.svelte";

  type CreditTab = "overview" | "calendar" | "weekly";
  type CalendarFilter = "all" | CreditCalendarEvent["type"];
  type SortKey =
    | "sourceRow"
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

  let activeTab = $state<CreditTab>("overview");
  let report = $state<CreditReportResponse | null>(null);
  let loading = $state(true);
  let errorMessage = $state("");
  let query = $state("");
  let statusFilter = $state<CreditStatus | "all">("all");
  let riskFilter = $state("all");
  let expandedInstitution = $state<string | null>(null);
  let editor = $state<CreditInstitutionView | null>(null);
  let editorVersion = $state(0);
  let savedEditorVersion = $state(0);
  let editorSession = 0;
  let saveState = $state<"idle" | "pending" | "saving" | "saved" | "error">("idle");
  let saveMessage = $state("");
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let saveInFlight = false;
  let pendingInstitutionChanges: CreditInstitutionChanges = {};
  let pendingItemChanges = new Map<CreditItemType, CreditItemChanges>();
  let sortKey = $state<SortKey>("sourceRow");
  let sortDirection = $state<"ascending" | "descending">("ascending");
  let calendarFilter = $state<CalendarFilter>("all");
  let calendarMonth = $state("");

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
      })
      .sort(compareInstitutions);
  });

  const weeklyNews = $derived.by(() => {
    return report?.weeklyNews.map(formatCreditWeeklyNews) ?? [];
  });

  const calendarCells = $derived.by(() => {
    if (!calendarMonth) return [];
    const first = new Date(`${calendarMonth}-01T00:00:00Z`);
    const mondayOffset = (first.getUTCDay() + 6) % 7;
    first.setUTCDate(first.getUTCDate() - mondayOffset);
    const visibleEvents = (report?.calendarEvents ?? []).filter(
      (event) => calendarFilter === "all" || event.type === calendarFilter,
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

  onDestroy(() => {
    if (saveTimer) clearTimeout(saveTimer);
  });

  async function loadReport(reportDate: string | null = null): Promise<void> {
    loading = true;
    errorMessage = "";
    clearEditor();
    try {
      report = await fetchCreditReport(reportDate);
      calendarMonth = report.summary.reportDate.slice(0, 7);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "授信数据加载失败";
    } finally {
      loading = false;
    }
  }

  function handleReportDateChange(event: Event): void {
    void loadReport((event.currentTarget as HTMLSelectElement).value);
  }

  function toggleInstitution(institution: CreditInstitutionView): void {
    if (expandedInstitution === institution.institutionName) {
      if (editorVersion > savedEditorVersion) void flushEditor();
      editorSession += 1;
      expandedInstitution = null;
      editor = null;
      resetPendingChanges();
      return;
    }
    if (editor && editorVersion > savedEditorVersion) void flushEditor();
    if (saveTimer) clearTimeout(saveTimer);
    editorSession += 1;
    expandedInstitution = institution.institutionName;
    editor = cloneInstitution(institution);
    editorVersion = 0;
    savedEditorVersion = 0;
    saveState = "idle";
    saveMessage = "";
    resetPendingChanges();
  }

  function clearEditor(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    editorSession += 1;
    expandedInstitution = null;
    editor = null;
    editorVersion = 0;
    savedEditorVersion = 0;
    saveState = "idle";
    saveMessage = "";
    resetPendingChanges();
  }

  function scheduleEditorSave(immediate = false): void {
    if (!editor) return;
    editorVersion += 1;
    saveState = "pending";
    saveMessage = "待保存";
    if (saveTimer) clearTimeout(saveTimer);
    if (immediate) {
      saveTimer = null;
      void flushEditor();
      return;
    }
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void flushEditor();
    }, 650);
  }

  async function flushEditor(): Promise<void> {
    if (saveInFlight || !editor || !hasPendingChanges()) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    const target = {
      reportDate: editor.reportDate,
      institutionName: editor.institutionName,
    };
    const changes = takePendingChanges();
    const version = editorVersion;
    const session = editorSession;
    saveInFlight = true;
    saveState = "saving";
    saveMessage = "保存中";
    let failed = false;
    try {
      const input: CreditInstitutionUpdateInput = {
        ...target,
        changes,
      };
      const result = await updateCreditInstitution(input);
      if (report) {
        report = {
          ...report,
          summary: result.summary,
          weeklySummary: result.weeklySummary,
          weeklyNews: result.weeklyNews,
          limitChanges: result.limitChanges,
          usageChanges: result.usageChanges,
          calendarEvents: result.calendarEvents,
          institutions: report.institutions.map((institution) =>
            institution.institutionName === result.institution.institutionName
              ? result.institution
              : institution,
          ),
        };
      }
      if (editorSession === session) {
        savedEditorVersion = version;
      }
      if (
        editorSession === session &&
        editor?.institutionName === result.institution.institutionName
      ) {
        if (editorVersion === version) editor = cloneInstitution(result.institution);
        else editor.updatedAt = result.institution.updatedAt;
        saveState = editorVersion === version ? "saved" : "pending";
        saveMessage = editorVersion === version ? "已保存" : "待保存";
      }
    } catch (error) {
      failed = true;
      if (editorSession === session) {
        requeueChanges(changes);
        saveState = "error";
        saveMessage = error instanceof Error ? error.message : "保存失败";
      }
    } finally {
      saveInFlight = false;
      if (
        editor &&
        hasPendingChanges() &&
        (!failed || editorSession !== session)
      ) {
        void flushEditor();
      }
    }
  }

  function setEditorText(
    field: "institutionType" | "bankOffice" | "applyingDepartment" | "handler" | "notes" | "bondPreference" | "usageDetails",
    event: Event,
  ): void {
    if (!editor) return;
    const value = (event.currentTarget as HTMLInputElement | HTMLTextAreaElement).value;
    if (field === "institutionType") editor[field] = value;
    else editor[field] = value === "" ? null : value;
    queueInstitutionChange(field, editor[field]);
    scheduleEditorSave();
  }

  function setEditorAmount(
    field: "totalLimit" | "totalUsed",
    event: Event,
  ): void {
    if (!editor) return;
    editor[field] = inputAmount(event);
    queueInstitutionChange(field, editor[field]);
    scheduleEditorSave();
  }

  function setEditorDate(
    field: "effectiveDate" | "expiryDate",
    event: Event,
  ): void {
    if (!editor) return;
    editor[field] = (event.currentTarget as HTMLInputElement).value || null;
    queueInstitutionChange(field, editor[field]);
    scheduleEditorSave(true);
  }

  function setEditorStatus(event: Event): void {
    if (!editor) return;
    editor.status = (event.currentTarget as HTMLSelectElement).value as CreditStatus;
    queueInstitutionChange("status", editor.status);
    scheduleEditorSave(true);
  }

  function setEditorConfidentiality(event: Event): void {
    if (!editor) return;
    editor.confidentialityStatus = (event.currentTarget as HTMLSelectElement)
      .value as CreditInstitutionView["confidentialityStatus"];
    queueInstitutionChange("confidentialityStatus", editor.confidentialityStatus);
    scheduleEditorSave(true);
  }

  function setEditorWeekly(event: Event): void {
    if (!editor) return;
    editor.includedInWeeklyReport = (event.currentTarget as HTMLInputElement).checked;
    queueInstitutionChange(
      "includedInWeeklyReport",
      editor.includedInWeeklyReport,
    );
    scheduleEditorSave(true);
  }

  function setItemAmount(
    index: number,
    field: "limitAmount" | "usedAmount",
    event: Event,
  ): void {
    if (!editor?.items[index]) return;
    editor.items[index][field] = inputAmount(event);
    queueItemChange(index, field);
    scheduleEditorSave();
  }

  function setItemDetails(index: number, event: Event): void {
    if (!editor?.items[index]) return;
    const value = (event.currentTarget as HTMLInputElement).value;
    editor.items[index].details = value === "" ? null : value;
    queueItemChange(index, "details");
    scheduleEditorSave();
  }

  function queueInstitutionChange<K extends keyof CreditInstitutionChanges>(
    field: K,
    value: CreditInstitutionChanges[K],
  ): void {
    pendingInstitutionChanges = {
      ...pendingInstitutionChanges,
      [field]: value,
    };
  }

  function queueItemChange(
    index: number,
    field: "limitAmount" | "usedAmount" | "details",
  ): void {
    const item = editor?.items[index];
    if (!item) return;
    pendingItemChanges.set(item.type, {
      ...pendingItemChanges.get(item.type),
      type: item.type,
      [field]: item[field],
    });
  }

  function hasPendingChanges(): boolean {
    return (
      Object.keys(pendingInstitutionChanges).length > 0 ||
      pendingItemChanges.size > 0
    );
  }

  function takePendingChanges(): CreditInstitutionUpdateInput["changes"] {
    const institution = { ...pendingInstitutionChanges };
    const items = [...pendingItemChanges.values()].map((item) => ({ ...item }));
    resetPendingChanges();
    return {
      ...(Object.keys(institution).length ? { institution } : {}),
      ...(items.length ? { items } : {}),
    };
  }

  function requeueChanges(
    changes: CreditInstitutionUpdateInput["changes"],
  ): void {
    pendingInstitutionChanges = {
      ...(changes.institution ?? {}),
      ...pendingInstitutionChanges,
    };
    for (const item of changes.items ?? []) {
      const current = pendingItemChanges.get(item.type);
      pendingItemChanges.set(item.type, {
        ...item,
        ...current,
        type: item.type,
      });
    }
  }

  function resetPendingChanges(): void {
    pendingInstitutionChanges = {};
    pendingItemChanges = new Map();
  }

  function inputAmount(event: Event): number | null {
    const value = (event.currentTarget as HTMLInputElement).value;
    return value === "" ? null : Number(value);
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
    if (key === "status") return statusLabel(institution.status);
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
    calendarMonth = date.toISOString().slice(0, 7);
  }

  function calendarMonthLabel(month: string): string {
    const [year, monthNumber] = month.split("-");
    return `${year}年${Number(monthNumber)}月`;
  }

  function printWeeklyReport(): void {
    window.print();
  }

  function statusLabel(status: CreditStatus): string {
    return {
      approved: "已获批",
      applying: "申请中",
      revoked: "已撤销",
    }[status];
  }

  function statusTone(status: CreditStatus): "success" | "warning" | "neutral" {
    if (status === "approved") return "success";
    if (status === "applying") return "warning";
    return "neutral";
  }

  function formatAmount(value: number | null | undefined): string {
    return value == null ? "—" : value.toFixed(2);
  }

  function cloneInstitution(
    institution: CreditInstitutionView,
  ): CreditInstitutionView {
    return {
      ...institution,
      items: institution.items.map((item) => ({ ...item })),
    };
  }

  function formatDelta(value: number): string {
    return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
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
  <div
    class="tr-credit-toolbar"
    aria-label="授信报表控制"
    use:portal={"#tr-topbar-actions"}
  >
    <div class="tr-credit-tabs" role="tablist" aria-label="授信报表">
      <button class:active={activeTab === "overview"} type="button" role="tab" aria-selected={activeTab === "overview"} onclick={() => (activeTab = "overview")}>授信一览表</button>
      <button class:active={activeTab === "calendar"} type="button" role="tab" aria-selected={activeTab === "calendar"} onclick={() => (activeTab = "calendar")}>授信日历</button>
      <button class:active={activeTab === "weekly"} type="button" role="tab" aria-selected={activeTab === "weekly"} onclick={() => (activeTab = "weekly")}>授信周报</button>
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
          <button class="tr-credit-print" type="button" onclick={printWeeklyReport}>打印 / 导出 PDF</button>
        {/if}
      </div>
    {/if}
  </div>

  {#if loading}
    <section class="tr-empty-panel" aria-live="polite">
      <WorkbenchIcon name="database" />
      <h2>正在读取授信数据</h2>
    </section>
  {:else if errorMessage || !report}
    <section class="tr-empty-panel" role="alert">
      <WorkbenchIcon name="warning" />
      <div><h2>授信数据暂不可用</h2><p>{errorMessage || "暂无授信记录"}</p></div>
      <button class="tr-credit-retry" type="button" onclick={() => void loadReport()}>重新加载</button>
    </section>
  {:else if activeTab === "overview"}
    <section aria-labelledby="credit-metrics-title">
      <SectionHeading id="credit-metrics-title" title="授信总览" />
      <div class="tr-metric-grid">
        <MetricCard label="授信总额" value={formatAmount(report.summary.totalLimit)} unit="亿元" iconComponent={WorkbenchIcon} iconProps={{ name: "credit" }} tone="blue" />
        <MetricCard label="已用额度" value={formatAmount(report.summary.totalUsed)} unit="亿元" iconComponent={WorkbenchIcon} iconProps={{ name: "funds" }} tone="orange" />
        <MetricCard label="可用额度" value={formatAmount(report.summary.totalAvailable)} unit="亿元" iconComponent={WorkbenchIcon} iconProps={{ name: "check" }} tone="green" />
      </div>
    </section>

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
              <option value="revoked">已撤销</option>
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
        </div>
      </PanelHeading>
      <div class="tr-table-scroll">
        <table class="tr-data-table tr-credit-table">
          <caption class="sr-only">授信一览表</caption>
          <thead>
            <tr>
              <th aria-sort={ariaSort("sourceRow")}><button class="tr-sort-button" type="button" onclick={() => toggleSort("sourceRow")}>序号<span aria-hidden="true">{sortIndicator("sourceRow")}</span></button></th>
              <th aria-sort={ariaSort("institutionName")}><button class="tr-sort-button" type="button" onclick={() => toggleSort("institutionName")}>授信主体<span aria-hidden="true">{sortIndicator("institutionName")}</span></button></th>
              <th aria-sort={ariaSort("institutionType")}><button class="tr-sort-button" type="button" onclick={() => toggleSort("institutionType")}>机构性质<span aria-hidden="true">{sortIndicator("institutionType")}</span></button></th>
              <th aria-sort={ariaSort("status")}><button class="tr-sort-button" type="button" onclick={() => toggleSort("status")}>状态<span aria-hidden="true">{sortIndicator("status")}</span></button></th>
              <th class="is-numeric" aria-sort={ariaSort("totalLimit")}><button class="tr-sort-button tr-sort-button--numeric" type="button" onclick={() => toggleSort("totalLimit")}>总额度<span aria-hidden="true">{sortIndicator("totalLimit")}</span></button></th>
              <th class="is-numeric" aria-sort={ariaSort("totalUsed")}><button class="tr-sort-button tr-sort-button--numeric" type="button" onclick={() => toggleSort("totalUsed")}>已使用<span aria-hidden="true">{sortIndicator("totalUsed")}</span></button></th>
              <th class="is-numeric" aria-sort={ariaSort("availableAmount")}><button class="tr-sort-button tr-sort-button--numeric" type="button" onclick={() => toggleSort("availableAmount")}>可用<span aria-hidden="true">{sortIndicator("availableAmount")}</span></button></th>
              <th class="is-numeric" aria-sort={ariaSort("utilization")}><button class="tr-sort-button tr-sort-button--numeric" type="button" onclick={() => toggleSort("utilization")}>使用率<span aria-hidden="true">{sortIndicator("utilization")}</span></button></th>
              <th aria-sort={ariaSort("effectiveDate")}><button class="tr-sort-button" type="button" onclick={() => toggleSort("effectiveDate")}>生效日<span aria-hidden="true">{sortIndicator("effectiveDate")}</span></button></th>
              <th aria-sort={ariaSort("expiryDate")}><button class="tr-sort-button" type="button" onclick={() => toggleSort("expiryDate")}>到期日<span aria-hidden="true">{sortIndicator("expiryDate")}</span></button></th>
              <th><span class="sr-only">操作</span></th>
            </tr>
          </thead>
          <tbody>
            {#each filteredInstitutions as institution, index (institution.institutionName)}
              <tr>
                <td>{index + 1}</td>
                <th scope="row">{institution.institutionName}</th>
                <td>{institution.institutionType}</td>
                <td><Badge tone={statusTone(institution.status)}>{statusLabel(institution.status)}</Badge></td>
                <td class="is-numeric">{formatAmount(institution.totalLimit)}</td>
                <td class="is-numeric">{formatAmount(institution.totalUsed)}</td>
                <td class="is-numeric">{formatAmount(institution.availableAmount)}</td>
                <td class="is-numeric">{institution.utilization == null ? "—" : `${institution.utilization.toFixed(1)}%`}</td>
                <td>{institution.effectiveDate ?? "—"}</td>
                <td>{institution.expiryDate ?? "—"}</td>
                <td><button class="tr-credit-detail-toggle" type="button" aria-expanded={expandedInstitution === institution.institutionName} onclick={() => toggleInstitution(institution)}>{expandedInstitution === institution.institutionName ? "收起" : "详情"}</button></td>
              </tr>
              {#if expandedInstitution === institution.institutionName && editor}
                <tr class="tr-credit-detail-row">
                  <td colspan="11">
                    <div class="tr-credit-detail">
                      <div class="tr-credit-editor-head">
                        <strong>{editor.institutionName}</strong>
                        <span class:error={saveState === "error"} aria-live="polite">{saveMessage}</span>
                      </div>
                      <div class="tr-credit-editor-grid">
                        <label><span>机构性质</span><input value={editor.institutionType} oninput={(event) => setEditorText("institutionType", event)} onblur={() => void flushEditor()} /></label>
                        <label><span>授信状态</span><select value={editor.status} onchange={setEditorStatus}><option value="approved">已获批</option><option value="applying">申请中</option><option value="revoked">已撤销</option></select></label>
                        <label><span>保密协议</span><select value={editor.confidentialityStatus} onchange={setEditorConfidentiality}><option value="signed">已签署</option><option value="not_signed">未签署</option><option value="unknown">未标记</option></select></label>
                        <label class="tr-credit-checkbox"><input type="checkbox" checked={editor.includedInWeeklyReport} onchange={setEditorWeekly} /><span>纳入周报名单</span></label>
                        <label><span>授信总额（亿元）</span><input type="number" step="0.000001" min="0" value={editor.totalLimit ?? ""} oninput={(event) => setEditorAmount("totalLimit", event)} onblur={() => void flushEditor()} /></label>
                        <label><span>已用额度（亿元）</span><input type="number" step="0.000001" value={editor.totalUsed ?? ""} oninput={(event) => setEditorAmount("totalUsed", event)} onblur={() => void flushEditor()} /></label>
                        <label><span>可用额度（亿元）</span><input readonly value={formatAmount(editor.totalLimit == null ? null : editor.totalLimit - (editor.totalUsed ?? 0))} /></label>
                        <label><span>生效日</span><input type="date" value={editor.effectiveDate ?? ""} onchange={(event) => setEditorDate("effectiveDate", event)} /></label>
                        <label><span>到期日</span><input type="date" value={editor.expiryDate ?? ""} onchange={(event) => setEditorDate("expiryDate", event)} /></label>
                        <label><span>银行经办机构</span><input value={editor.bankOffice ?? ""} oninput={(event) => setEditorText("bankOffice", event)} onblur={() => void flushEditor()} /></label>
                        <label><span>我司申请部门</span><input value={editor.applyingDepartment ?? ""} oninput={(event) => setEditorText("applyingDepartment", event)} onblur={() => void flushEditor()} /></label>
                        <label><span>我司经办人</span><input value={editor.handler ?? ""} oninput={(event) => setEditorText("handler", event)} onblur={() => void flushEditor()} /></label>
                      </div>
                      <div class="tr-credit-item-grid">
                        {#each editor.items as item, itemIndex (item.type)}
                          <fieldset>
                            <legend>{creditItemLabels[item.type]}</legend>
                            {#if item.type !== "other"}<label><span>额度（亿元）</span><input type="number" step="0.000001" min="0" value={item.limitAmount ?? ""} oninput={(event) => setItemAmount(itemIndex, "limitAmount", event)} onblur={() => void flushEditor()} /></label>{/if}
                            <label><span>已用（亿元）</span><input type="number" step="0.000001" value={item.usedAmount ?? ""} oninput={(event) => setItemAmount(itemIndex, "usedAmount", event)} onblur={() => void flushEditor()} /></label>
                            {#if item.type !== "other"}<label><span>可用（亿元）</span><input readonly value={formatAmount(item.limitAmount == null ? null : item.limitAmount - (item.usedAmount ?? 0))} /></label>{/if}
                            <label><span>说明</span><input value={item.details ?? ""} oninput={(event) => setItemDetails(itemIndex, event)} onblur={() => void flushEditor()} /></label>
                          </fieldset>
                        {/each}
                      </div>
                      <div class="tr-credit-notes-grid">
                        <label><span>备注</span><textarea rows="3" oninput={(event) => setEditorText("notes", event)} onblur={() => void flushEditor()}>{editor.notes ?? ""}</textarea></label>
                        <label><span>债券投资偏好</span><textarea rows="3" oninput={(event) => setEditorText("bondPreference", event)} onblur={() => void flushEditor()}>{editor.bondPreference ?? ""}</textarea></label>
                        <label><span>已用授信具体情况</span><textarea rows="3" oninput={(event) => setEditorText("usageDetails", event)} onblur={() => void flushEditor()}>{editor.usageDetails ?? ""}</textarea></label>
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
    </section>
  {:else if activeTab === "calendar"}
    <section aria-labelledby="credit-calendar-title">
      <SectionHeading id="credit-calendar-title" title="授信日历" />
      <div class="tr-panel tr-credit-calendar-panel">
        <div class="tr-credit-calendar-toolbar">
          <div class="tr-credit-calendar-filter" role="group" aria-label="授信日历事件类型">
            <button class:active={calendarFilter === "all"} type="button" onclick={() => (calendarFilter = "all")}>全部</button>
            <button class:active={calendarFilter === "expiry"} type="button" onclick={() => (calendarFilter = "expiry")}>到期</button>
            <button class:active={calendarFilter === "added"} type="button" onclick={() => (calendarFilter = "added")}>新增</button>
          </div>
          <div class="tr-credit-calendar-nav">
            <button type="button" aria-label="上一个月" onclick={() => shiftCalendarMonth(-1)}>‹</button>
            <strong>{calendarMonthLabel(calendarMonth)}</strong>
            <button type="button" aria-label="下一个月" onclick={() => shiftCalendarMonth(1)}>›</button>
          </div>
        </div>
        <div class="tr-credit-calendar" role="grid" aria-label={`${calendarMonthLabel(calendarMonth)}授信事件`}>
          {#each weekdays as weekday}<div class="tr-credit-calendar-weekday" role="columnheader">{weekday}</div>{/each}
          {#each calendarCells as cell (cell.date)}
            <div class:outside={cell.outside} class:report-date={cell.reportDate} class="tr-credit-calendar-cell" role="gridcell" aria-label={cell.date}>
              <time datetime={cell.date}>{cell.day}</time>
              <div class="tr-credit-calendar-events">
                {#each cell.events.slice(0, 3) as event (event.id)}
                  <article class={`tr-credit-calendar-event tr-credit-calendar-event--${event.type} tr-credit-calendar-event--${event.status}`} title={`${event.institutionName} · ${event.label} · ${event.statusLabel}`}>
                    <strong>{event.institutionName}</strong>
                    <span>{event.label} · {event.statusLabel}</span>
                  </article>
                {/each}
                {#if cell.events.length > 3}<span class="tr-credit-calendar-more">另 {cell.events.length - 3} 项</span>{/if}
              </div>
            </div>
          {/each}
        </div>
      </div>
    </section>
  {:else}
    <div class="tr-credit-weekly-report">
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

      <section class="tr-panel" aria-labelledby="credit-news-title">
        <PanelHeading id="credit-news-title" title="本周授信快讯"><Badge>{weeklyNews.length} 项</Badge></PanelHeading>
        {#if !report.previousDate}
          <p class="tr-credit-muted">需要至少两个报表日才能生成本周变化。</p>
        {:else if weeklyNews.length === 0}
          <p class="tr-credit-muted">本期无新增授信、扩额或续签事项。</p>
        {:else}
          <ol class="tr-credit-news-list">{#each weeklyNews as news}<li>{news}。</li>{/each}</ol>
        {/if}
      </section>

      <section class="tr-panel" aria-labelledby="credit-limit-changes-title">
        <PanelHeading id="credit-limit-changes-title" title="授信额度变动"><Badge tone={report.limitChanges.length ? "warning" : "success"}>{report.limitChanges.length} 家</Badge></PanelHeading>
        <div class="tr-table-scroll">
          <table class="tr-data-table tr-credit-change-table">
            <caption class="sr-only">本周相对上周的授信额度变动</caption>
            <thead><tr><th>机构</th><th>性质</th><th>类型</th><th class="is-numeric">上期总额</th><th class="is-numeric">本期总额</th><th class="is-numeric">变化</th><th>变化说明</th></tr></thead>
            <tbody>
              {#each report.limitChanges as change (change.institutionName)}
                <tr><th scope="row">{change.institutionName}</th><td>{change.institutionType}</td><td>{changeKindLabel(change.kind)}</td><td class="is-numeric">{formatAmount(change.previousAmount)}</td><td class="is-numeric">{formatAmount(change.currentAmount)}</td><td class={`is-numeric tr-change ${change.deltaAmount > 0 ? "tr-change--up" : change.deltaAmount < 0 ? "tr-change--down" : ""}`}>{formatDelta(change.deltaAmount)}</td><td class="tr-credit-change-details">{change.details.join("；")}</td></tr>
              {:else}
                <tr><td class="tr-empty-cell" colspan="7">本期无新增授信、扩额或续签事项</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  {/if}
</div>
