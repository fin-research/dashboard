<script lang="ts">
  import WorkbenchShell from "../workbench/WorkbenchShell.svelte";
  import CreditView from "../trading-research/CreditView.svelte";
  import CreditAssistantView from "../credit-assistant/CreditAssistantView.svelte";
  import { creditWorkbenchViews, type CreditWorkbenchViewId } from "./navigation";
  import type { CreditCustomer } from "../credit-assistant/types";
  import type { CreditReportResponse } from "../credit/types";

  let { viewId = "overview" }: { viewId?: CreditWorkbenchViewId } = $props();
  // Component-scoped display data: shared between tabs, never SSR/global storage.
  let customerOptions = $state<CreditCustomer[] | null>(null);
  function rememberCustomers(report: CreditReportResponse) {
    customerOptions = report.institutions.map(institution => ({ name: institution.institutionName,
      confidentialityStatus: institution.confidentialityStatus, reportDate: report.summary.reportDate }));
  }
</script>

<WorkbenchShell title="授信工作台" homeHref="/credit-workbench" views={creditWorkbenchViews}
  activeViewId={viewId} chat={viewId === "assistant"} tone="teal"
  visualVariant={viewId === "weekly" ? "report" : "workspace"}>
  {#if viewId === "assistant"}
    <CreditAssistantView bind:customerOptions />
  {:else}
    <CreditView tab={viewId} onreport={rememberCustomers} />
  {/if}
</WorkbenchShell>
