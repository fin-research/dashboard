<script lang="ts">
  import type { Snippet } from 'svelte';
  import ModuleCard from '../../components/ModuleCard.svelte';
  import ChartHost from '../../components/ChartHost.svelte';
  import PanelHeading from '../trading-research/PanelHeading.svelte';
  import type { ChartOption } from '../../charts/charting';
  let { id, title, option, headers, rows, total, percentages = [], chartHeight = 27, scroll = false, empty = false, controls }: {
    id: string; title: string; option: ChartOption;
    headers: string[]; rows: { name: string; values: (number | null)[] }[];
    total: (number | null)[]; percentages?: number[]; chartHeight?: number; scroll?: boolean; empty?: boolean; controls?: Snippet;
  } = $props();
  const number = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const display = (value: number | null, column: number) => value == null ? '—' : percentages.includes(column) ? `${(value * 100).toFixed(2)}%` : number.format(value);
</script>

<ModuleCard labelledBy={id}>
  <PanelHeading {id} {title} controlsInline>
    {#if controls}{@render controls()}{/if}
  </PanelHeading>
  <div class="investor-pair">
    <div class:scroll class="investor-chart" role="region" aria-label={`${title}图表滚动区域`}>
      {#if empty}<p class="empty-chart" role="status">所选范围暂无投资金额</p>{:else}<ChartHost {option} height={chartHeight} ariaLabel={`${title}，金额单位亿元，完整数值见右侧表格`} />{/if}
    </div>
    <div class:scroll class="investor-table" role="region" aria-label={`${title}数据表格`}>
      <table class="table">
        <caption class="sr-only">{title}，金额单位亿元</caption>
        <thead><tr>{#each headers as header, index}<th scope="col" class:numeric={index > 0}>{header}</th>{/each}</tr></thead>
        <tbody>
          {#each rows as row}<tr><th scope="row">{row.name}</th>{#each row.values as value, index}<td class="numeric">{display(value, index)}</td>{/each}</tr>{/each}
        </tbody>
        <tfoot><tr><th scope="row">合计</th>{#each total as value, index}<td class="numeric">{display(value, index)}</td>{/each}</tr></tfoot>
      </table>
    </div>
  </div>
</ModuleCard>

<style>
  .investor-pair { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr); align-items: start; gap: 1.5rem; }
  .investor-chart, .investor-table { min-width: 0; overflow: auto; }
  .scroll { max-height: 34rem; }
  .empty-chart { min-height: 20rem; display: grid; place-items: center; }
  table { width: 100%; font-size: 0.875rem; }
  th { text-align: left; }
  .numeric { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  thead { position: sticky; top: 0; background: var(--color-base-100); z-index: 1; }
  tfoot { font-weight: bold; background: var(--color-base-200); }
  tbody th { font-weight: normal; min-width: 6rem; }
  @media (max-width: 1050px) { .investor-pair { grid-template-columns: minmax(0, 1fr); } }
</style>
