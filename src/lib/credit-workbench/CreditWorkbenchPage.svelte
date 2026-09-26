<script lang="ts">
  import WorkbenchShell from "../workbench/WorkbenchShell.svelte";
  import CreditView from "../trading-research/CreditView.svelte";
  import { creditWorkbenchViews, type CreditWorkbenchViewId } from "./navigation";

  let { viewId = "overview" }: { viewId?: CreditWorkbenchViewId } = $props();
</script>

<WorkbenchShell title="授信工作台" homeHref="/credit-workbench" views={creditWorkbenchViews}
  activeViewId={viewId} tone="teal"
  visualVariant={viewId === "weekly" ? "report" : "workspace"}>
  <CreditView tab={viewId} />
</WorkbenchShell>
