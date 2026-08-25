<script lang="ts">
  import ChartHost from "../../components/ChartHost.svelte";
  import { renderWorkbenchBarChart } from "../../charts/trading-research";
  import MetricCard from "./MetricCard.svelte";
  import WorkbenchIcon from "./WorkbenchIcon.svelte";
  import { demoMeta, demoTrades, tradingSummary } from "./demo-data";

  let query = $state("");
  let product = $state("all");
  let status = $state("all");

  const filteredTrades = $derived.by(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return demoTrades.filter((trade) => {
      const matchesQuery =
        !normalizedQuery ||
        [trade.id, trade.counterparty, trade.product, trade.term]
          .join(" ")
          .toLocaleLowerCase("zh-CN")
          .includes(normalizedQuery);
      const matchesProduct = product === "all" || trade.product === product;
      const matchesStatus = status === "all" || trade.status === status;
      return matchesQuery && matchesProduct && matchesStatus;
    });
  });

  const counterparties = Array.from(
    demoTrades.reduce((totals, trade) => {
      totals.set(
        trade.counterparty,
        (totals.get(trade.counterparty) ?? 0) + trade.amount,
      );
      return totals;
    }, new Map<string, number>()),
  )
    .map(([label, amount]) => ({
      label,
      amount,
      share: (amount / tradingSummary.totalAmount) * 100,
    }))
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 5);

  const productDistribution = [
    {
      label: "同业拆借",
      value: tradingSummary.interbankAmount,
      color: "#2f6fed",
    },
    {
      label: "质押式回购",
      value: tradingSummary.repoLendAmount,
      color: "#f79009",
    },
  ];

  function productLabel(productName: string): string {
    return productName === "同业拆借" ? "同业拆借（纯信用）" : "拆出（质押式回购）";
  }
</script>

<div class="tr-view-stack">
  <section aria-labelledby="trading-metrics-title">
    <div class="tr-section-heading">
      <div><span class="tr-section-mark" aria-hidden="true"></span><h2 id="trading-metrics-title">当日交易概况</h2></div>
      <span>截至 {demoMeta.tradingAsOf}</span>
    </div>
    <div class="tr-metric-grid tr-metric-grid--five">
      <MetricCard label="交易笔数" value={String(tradingSummary.tradeCount)} unit="笔" detail="两类业务合计" icon="trading" tone="orange" />
      <MetricCard label="同业拆借" value={tradingSummary.interbankAmount.toFixed(1)} unit="亿元" detail="纯信用 · 当日成交" icon="funds" tone="blue" />
      <MetricCard label="质押回购拆出" value={tradingSummary.repoLendAmount.toFixed(1)} unit="亿元" detail="当日成交" icon="credit" tone="purple" />
      <MetricCard label="成交加权利率" value={tradingSummary.weightedRate.toFixed(2)} unit="%" detail="按成交金额加权" icon="research" tone="green" />
      <MetricCard label="待确认" value={String(tradingSummary.pendingCount)} unit="笔" detail="需人工复核" icon="warning" tone="red" />
    </div>
  </section>

  <div class="tr-two-column tr-two-column--trading">
    <section class="tr-panel" aria-labelledby="product-structure-title">
      <div class="tr-panel-heading">
        <div><h2 id="product-structure-title">业务品种分布</h2></div>
        <span class="tr-badge tr-badge--neutral">按当日成交金额</span>
      </div>
      <ChartHost
        renderer={renderWorkbenchBarChart}
        args={[productDistribution, "按当日成交金额统计的业务品种分布", "亿元"]}
        ariaLabel="按当日成交金额统计的业务品种分布横向柱状图"
        className="tr-chart-host tr-chart-host--compact"
      />
    </section>

    <section class="tr-panel" aria-labelledby="counterparty-title">
      <div class="tr-panel-heading">
        <div><h2 id="counterparty-title">交易对手集中度</h2></div>
        <span class="tr-badge tr-badge--neutral">前五名</span>
      </div>
      <ol class="tr-ranking-list">
        {#each counterparties as counterparty, index}
          <li>
            <span>{index + 1}</span>
            <div><strong>{counterparty.label}</strong><small>{counterparty.share.toFixed(1)}%</small></div>
            <b>{counterparty.amount.toFixed(1)} 亿元</b>
          </li>
        {/each}
      </ol>
    </section>
  </div>

  <section class="tr-panel" aria-labelledby="trade-table-title">
    <div class="tr-panel-heading tr-panel-heading--wrap">
      <div><h2 id="trade-table-title">交易记录</h2></div>
      <div class="tr-table-controls" role="search">
        <label class="tr-search-control">
          <span class="sr-only">搜索交易</span>
          <WorkbenchIcon name="search" />
          <input bind:value={query} type="search" placeholder="编号、对手、品种或期限" />
        </label>
        <label>
          <span class="sr-only">业务品种</span>
          <select bind:value={product}>
            <option value="all">全部业务</option>
            <option value="同业拆借">同业拆借</option>
            <option value="质押式回购">质押式回购</option>
          </select>
        </label>
        <label>
          <span class="sr-only">交易状态</span>
          <select bind:value={status}>
            <option value="all">全部状态</option>
            <option value="已成交">已成交</option>
            <option value="待确认">待确认</option>
          </select>
        </label>
        <span class="tr-result-count">{filteredTrades.length} 笔</span>
      </div>
    </div>
    <div class="tr-table-scroll">
      <table class="tr-data-table">
        <caption class="sr-only">交易研究工作台交易记录</caption>
        <thead>
          <tr><th>交易编号</th><th>时间</th><th>方向</th><th>业务类型</th><th>交易对手</th><th class="is-numeric">金额（亿元）</th><th>期限</th><th class="is-numeric">利率</th><th>质押券</th><th>状态</th></tr>
        </thead>
        <tbody>
          {#each filteredTrades as trade (trade.id)}
            <tr>
              <th scope="row">{trade.id}</th>
              <td>{trade.time}</td>
              <td><span class={`tr-direction tr-direction--${trade.direction === "融出" ? "out" : "in"}`}>{trade.direction}</span></td>
              <td>{productLabel(trade.product)}</td>
              <td>{trade.counterparty}</td>
              <td class="is-numeric">{trade.amount.toFixed(1)}</td>
              <td>{trade.term}</td>
              <td class="is-numeric">{trade.rate.toFixed(2)}%</td>
              <td>{trade.collateral}</td>
              <td><span class={`tr-badge ${trade.status === "待确认" ? "tr-badge--warning" : "tr-badge--success"}`}>{trade.status}</span></td>
            </tr>
          {:else}
            <tr><td class="tr-empty-cell" colspan="10">没有符合当前筛选条件的交易记录</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
</div>
