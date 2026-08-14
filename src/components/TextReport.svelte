<script lang="ts">
  import { buildTextReport } from "../text-report";
  import type { TextReportData } from "../types";

  export let data: TextReportData;

  $: content = buildTextReport(data);
</script>

<article class="text-report" aria-label="文字版境内市场点评">
  <pre>{content}</pre>
</article>
