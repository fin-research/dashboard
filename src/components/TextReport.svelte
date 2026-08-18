<script lang="ts">
  import { buildTextReport } from "../text-report";
  import type { ReportData } from "../types";

  export let data: ReportData;
  export let focusText = "";

  $: content = buildTextReport(data, focusText);
</script>

<article class="text-report" aria-label="文字版境内市场点评">
  <pre>{content}</pre>
</article>
