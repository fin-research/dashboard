<script lang="ts">
  import { buildTextReportLines } from "../text-report";
  import type { ReportData } from "../types";

  export let data: ReportData;
  export let focusText = "";

  $: lines = buildTextReportLines(data, focusText);
</script>

<article class="text-report" aria-label="文字版境内市场点评">
  <pre>{#each lines as line, index}{#if line.bold}<strong>{line.text}</strong>{:else}{line.text}{/if}{#if index < lines.length - 1}{"\n"}{/if}{/each}</pre>
</article>
