<script lang="ts">
  import type { PageData } from './$types';
  import InvestorChartTable from '$lib/financing/InvestorChartTable.svelte';
  import { investorBondTypes, investorShare, type InvestorAmounts } from '$lib/financing/bond-investors';
  import { investorRankingOption, investorStructureOption } from '../../../charts/bond-investors';
  import { financingCompositionOption } from '../../../charts/financing-dashboard';
  let { data }: { data: PageData } = $props();
  let totalType = $state<keyof InvestorAmounts>('total');
  let outstandingType = $state<keyof InvestorAmounts>('total');
  let investorType = $state<keyof InvestorAmounts>('total');
  let sort = $state<'total' | 'outstanding'>('total');
  const report = $derived(data.report);
  const columns = ['机构类型', ...investorBondTypes, '合计'];
  const amounts = (row: InvestorAmounts) => [...investorBondTypes.map(type => row[type]), row.total];
  const totalDistribution = $derived(report.categories.map(row => ({ name: row.category, values: [row.total[totalType], investorShare(row.total[totalType], report.total[totalType])] })));
  const outstandingDistribution = $derived(report.categories.map(row => ({ name: row.category, values: [row.outstanding[outstandingType], investorShare(row.outstanding[outstandingType], report.outstanding[outstandingType])] })));
  const ranking = $derived(report.investors.map(row => ({ name: row.name, total: row.total[investorType], outstanding: row.outstanding[investorType] })).filter(row => row.total > 0).sort((a, b) => b[sort] - a[sort] || a.name.localeCompare(b.name, 'zh-CN')));
</script>

<svelte:head><title>债券投资人 · 融资工作台</title></svelte:head>

<div class="investor-page">
  <form method="GET" class="investor-toolbar">
    <label for="investor-date">统计日</label><input id="investor-date" class="input input-bordered" type="date" name="date" min="2020-01-01" value={report.asOfDate} required />
    <button class="btn btn-primary" type="submit">查询</button><span>金额单位：亿元</span>
  </form>
  {#if report.coverage.missingBonds > 0}<div class="alert" role="status">已登记 {report.coverage.coveredBonds} 只债券的投资人；另有 {report.coverage.missingBonds} 只已发行债券尚无投资人明细，发行本金合计 {report.coverage.missingAmountYi.toFixed(2)} 亿元，未纳入下方统计。</div>{/if}
  {#if report.coverage.mismatchedBonds > 0}<div class="alert alert-warning" role="status">{report.coverage.mismatchedBonds} 只债券的投资人合计与发行本金不一致，请核对台账。</div>{/if}
  {#if report.investors.length === 0}
    <div class="alert" role="status">截至所选统计日暂无债券投资人数据。</div>
  {:else}
    <InvestorChartTable id="investor-total" title="累计债券融资情况" option={investorStructureOption(report.categories, 'total')} headers={columns}
      rows={report.categories.map(row => ({ name: row.category, values: amounts(row.total) }))} total={amounts(report.total)} />
    <InvestorChartTable id="investor-outstanding" title="存续债券融资情况" empty={report.outstanding.total === 0} option={investorStructureOption(report.categories, 'outstanding')} headers={columns}
      rows={report.categories.map(row => ({ name: row.category, values: amounts(row.outstanding) }))} total={amounts(report.outstanding)} />
    <InvestorChartTable id="investor-total-distribution" title="累计投资机构类型分布" empty={report.total[totalType] === 0} option={financingCompositionOption(totalDistribution.map(row => ({ type: row.name, amountYi: row.values[0] ?? 0 })))}
      headers={['机构类型', '累计规模', '占比']} rows={totalDistribution} total={[report.total[totalType], investorShare(report.total[totalType], report.total[totalType])]} percentages={[1]}>
      {#snippet controls()}<label for="total-bond-type">债券品种</label><select id="total-bond-type" class="select select-bordered" bind:value={totalType}><option value="total">全部品种</option>{#each investorBondTypes as type}<option value={type}>{type}</option>{/each}</select>{/snippet}
    </InvestorChartTable>
    <InvestorChartTable id="investor-outstanding-distribution" title="存续投资机构类型分布" empty={report.outstanding[outstandingType] === 0} option={financingCompositionOption(outstandingDistribution.map(row => ({ type: row.name, amountYi: row.values[0] ?? 0 })))}
      headers={['机构类型', '存续规模', '占比']} rows={outstandingDistribution} total={[report.outstanding[outstandingType], investorShare(report.outstanding[outstandingType], report.outstanding[outstandingType])]} percentages={[1]}>
      {#snippet controls()}<label for="outstanding-bond-type">债券品种</label><select id="outstanding-bond-type" class="select select-bordered" bind:value={outstandingType}><option value="total">全部品种</option>{#each investorBondTypes as type}<option value={type}>{type}</option>{/each}</select>{/snippet}
    </InvestorChartTable>
    <InvestorChartTable id="investor-ranking" title="具体投资人情况" empty={ranking.length === 0} option={investorRankingOption(ranking)} scroll chartHeight={Math.max(27, ranking.length * 3.8 + 6)}
      headers={['投资机构', '累计规模', '累计占比', '存续规模', '存续占比']} percentages={[1, 3]}
      rows={ranking.map(row => ({ name: row.name, values: [row.total, investorShare(row.total, report.total[investorType]), row.outstanding, investorShare(row.outstanding, report.outstanding[investorType])] }))}
      total={[report.total[investorType], investorShare(report.total[investorType], report.total[investorType]), report.outstanding[investorType], investorShare(report.outstanding[investorType], report.outstanding[investorType])]}>
      {#snippet controls()}
        <label for="investor-bond-type">债券品种</label><select id="investor-bond-type" class="select select-bordered" bind:value={investorType}><option value="total">全部品种</option>{#each investorBondTypes as type}<option value={type}>{type}</option>{/each}</select>
        <label for="investor-sort">排序</label><select id="investor-sort" class="select select-bordered" bind:value={sort}><option value="total">累计规模</option><option value="outstanding">存续规模</option></select>
      {/snippet}
    </InvestorChartTable>
  {/if}
  <details><summary>统计口径</summary><p>累计规模汇总2020年起至统计日已起息债券的一级发行认购金额。存续规模为其中统计日尚未到期、结清或关闭的债券认购金额，不反映二级市场转让。机构分类读取客户主表；“未知”保留来源未明确的实际投资人。到期日当天不计存续，分母为零时占比显示“—”。</p></details>
</div>

<style>
  .investor-page { display: grid; gap: 1.25rem; min-width: 0; }
  .investor-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; }
  .investor-toolbar input { width: auto; }
  .investor-toolbar span { margin-left: auto; }
  details p { line-height: 1.6; }
  @media (max-width: 720px) { .investor-toolbar span { margin-left: 0; } }
</style>
