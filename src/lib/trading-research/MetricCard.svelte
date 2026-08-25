<script lang="ts">
  import WorkbenchIcon from "./WorkbenchIcon.svelte";
  import type { WorkbenchIconName } from "./demo-data";

  let {
    label,
    value,
    unit = "",
    detail,
    icon = "funds",
    tone = "blue",
  }: {
    label: string;
    value: string;
    unit?: string;
    detail: string;
    icon?: WorkbenchIconName;
    tone?: "blue" | "green" | "orange" | "purple" | "red";
  } = $props();
</script>

<article class="tr-metric-card">
  <div class="tr-metric-card__head">
    <span>{label}</span>
    <span class={`tr-metric-icon tr-metric-icon--${tone}`} aria-hidden="true">
      <WorkbenchIcon name={icon} />
    </span>
  </div>
  <div class="tr-metric-card__value">
    <strong>{value}</strong>
    {#if unit}<span>{unit}</span>{/if}
  </div>
  <p>{detail}</p>
</article>
