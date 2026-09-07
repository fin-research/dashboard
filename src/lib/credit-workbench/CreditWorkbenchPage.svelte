<script lang="ts">
  import WorkbenchShell from "../workbench/WorkbenchShell.svelte";
  import CreditView from "../trading-research/CreditView.svelte";
  import CreditAssistantView from "../credit-assistant/CreditAssistantView.svelte";
  import { creditWorkbenchViews, type CreditWorkbenchViewId } from "./navigation";

  let { viewId = "overview" }: { viewId?: CreditWorkbenchViewId } = $props();
</script>

<WorkbenchShell title="授信工作台" homeHref="/credit-workbench" views={creditWorkbenchViews}
  activeViewId={viewId} chat={viewId === "assistant"}>
  {#if viewId === "assistant"}
    <CreditAssistantView />
  {:else}
    <CreditView tab={viewId} />
  {/if}
</WorkbenchShell>
