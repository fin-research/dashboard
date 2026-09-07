<script lang="ts">
  import BondLedgerPage from "$lib/pages/BondLedgerPage.svelte";
  import FinancingModelPage from "$lib/pages/FinancingModelPage.svelte";
  import SecondaryBondPoolWeeklyPage from "$lib/pages/SecondaryBondPoolWeeklyPage.svelte";
  import MarketHotspotsPage from "$lib/pages/MarketHotspotsPage.svelte";
  import PolicyTrackingPage from "$lib/pages/PolicyTrackingPage.svelte";
  import WorkbenchShell from "../workbench/WorkbenchShell.svelte";
  import OverviewView from "./OverviewView.svelte";
  import ResearchView from "./ResearchView.svelte";
  import TradingView from "./TradingView.svelte";
  import WorkflowView from "./WorkflowView.svelte";
  import { normalizeWorkbenchView, workbenchViewPath, workbenchRoutes, workbenchViews, type WorkbenchViewId } from "./demo-data";

  let { viewId = "overview" }: { viewId?: string | null } = $props();
  const activeViewId = $derived(normalizeWorkbenchView(viewId));
  const views = workbenchViews.map(view => ({ ...view, href: workbenchViewPath(view.id) }));
  function isIntegratedView(value: WorkbenchViewId) {
    return value === "bond" || value === "secondary-bond-pool" || value === "financing-model";
  }
  function isLayoutReport(value: WorkbenchViewId) {
    return value === "secondary-bond-pool" || value === "financing-model";
  }
</script>

<WorkbenchShell title="交易研究工作台" homeHref="/trading-research" {views} {activeViewId}
  activeLabel={workbenchRoutes.find(view => view.id === activeViewId)?.label}
  integrated={isIntegratedView(activeViewId)} layoutReport={isLayoutReport(activeViewId)}
  canvas={activeViewId === "market-hotspots"}
  reportKind={activeViewId === "secondary-bond-pool" ? "secondary" : activeViewId === "financing-model" ? "financing" : null}>
  {#if activeViewId === "overview"}
    <OverviewView />
  {:else if activeViewId === "trading"}
    <TradingView />
  {:else if activeViewId === "market-hotspots"}
    <MarketHotspotsPage embedded />
  {:else if activeViewId === "policy-tracking"}
    <PolicyTrackingPage embedded />
  {:else if activeViewId === "research"}
    <ResearchView />
  {:else if activeViewId === "workflow"}
    <WorkflowView />
  {:else if activeViewId === "bond"}
    <BondLedgerPage embedded />
  {:else if activeViewId === "secondary-bond-pool"}
    <SecondaryBondPoolWeeklyPage embedded />
  {:else}
    <FinancingModelPage embedded />
  {/if}
</WorkbenchShell>
