<script lang="ts">
  import { buildTextReport } from "../text-report";
  import type { ReportData } from "../types";

  export let data: ReportData;
  export let focusText = "";

  $: report = buildTextReport(data, focusText);
</script>

<article class="text-report" aria-labelledby="text-report-title">
  <header class="text-report__header">
    <p>资金管理部</p>
    <h2 id="text-report-title">{report.title}</h2>
  </header>

  <div class="text-report__body">
    {#each report.sections as section}
      <section class="text-report__section">
        <h3>【{section.title}】</h3>
        {#each section.paragraphs as paragraph}
          <p class:text-report__focus={section.title === "今日聚焦"}>
            {paragraph}
          </p>
        {/each}
        {#each section.groups as group}
          <div class="text-report__group">
            <p class="text-report__group-label">{group.label}</p>
            {#each group.entries as entry}
              <p class="text-report__entry">
                {#if entry.strong}<strong>{entry.text}</strong>{:else}{entry.text}{/if}
              </p>
            {/each}
          </div>
        {/each}
      </section>
    {/each}
  </div>
</article>
