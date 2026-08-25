<script lang="ts">
  import { afterNavigate } from "$app/navigation";
  import { page } from "$app/state";

  import CreditView from "$lib/trading-research/CreditView.svelte";
  import OverviewView from "$lib/trading-research/OverviewView.svelte";
  import ResearchView from "$lib/trading-research/ResearchView.svelte";
  import TradingView from "$lib/trading-research/TradingView.svelte";
  import WorkbenchIcon from "$lib/trading-research/WorkbenchIcon.svelte";
  import WorkflowView from "$lib/trading-research/WorkflowView.svelte";
  import {
    demoMeta,
    normalizeWorkbenchView,
    workbenchViews,
  } from "$lib/trading-research/demo-data";
  import "$lib/trading-research/workbench.css";

  let desktopCollapsed = $state(false);
  let mobileDrawerOpen = $state(false);
  let mainRegion: HTMLElement;

  const activeViewId = $derived(
    normalizeWorkbenchView(page.url.searchParams.get("view")),
  );
  const activeView = $derived(
    workbenchViews.find((view) => view.id === activeViewId) ?? workbenchViews[0],
  );
  const activeDate = $derived.by(() => {
    if (activeViewId === "trading") return demoMeta.tradingAsOf;
    if (activeViewId === "credit") return demoMeta.creditAsOf;
    if (activeViewId === "research") {
      return `${demoMeta.researchStart}—${demoMeta.researchEnd}`;
    }
    if (activeViewId === "workflow") return "静态演示";
    return "多基准日";
  });

  afterNavigate(() => {
    mobileDrawerOpen = false;
    requestAnimationFrame(() => mainRegion?.focus({ preventScroll: true }));
  });

  function toggleDrawer(): void {
    if (window.matchMedia("(max-width: 900px)").matches) {
      mobileDrawerOpen = !mobileDrawerOpen;
      return;
    }
    desktopCollapsed = !desktopCollapsed;
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && mobileDrawerOpen) mobileDrawerOpen = false;
  }
</script>

<svelte:head>
  <title>{activeView?.label} · 交易研究工作台</title>
  <meta
    name="description"
    content="资金管理部交易管理、授信管理、研究辅助与流程中心静态工作台"
  />
  <meta name="theme-color" content="#f6f8fb" />
</svelte:head>

<svelte:window onkeydown={handleWindowKeydown} />

<div
  class:tr-shell--collapsed={desktopCollapsed}
  class:tr-shell--mobile-open={mobileDrawerOpen}
  class="tr-workbench tr-shell"
>
  <a class="tr-skip-link" href="#tr-workbench-main">跳至工作台内容</a>

  <aside id="tr-workbench-drawer" class="tr-drawer" aria-label="交易研究工作台导航">
    <div class="tr-drawer__head">
      <a class="tr-brand" href="/trading-research" aria-label="交易研究工作台总览">
        <span class="tr-brand__mark" aria-hidden="true"><i></i><i></i></span>
        <span class="tr-brand__copy"><strong>资金管理部</strong><small>交易研究工作台</small></span>
      </a>
      <button
        class="tr-drawer__collapse"
        type="button"
        aria-label={desktopCollapsed ? "展开侧边导航" : "收窄侧边导航"}
        aria-expanded={!desktopCollapsed}
        aria-controls="tr-workbench-drawer"
        onclick={toggleDrawer}
      >
        <WorkbenchIcon name="chevron" />
      </button>
    </div>

    <nav class="tr-drawer__nav" aria-label="业务模块">
      {#each workbenchViews as view}
        <a
          class:active={activeViewId === view.id}
          href={`/trading-research?view=${view.id}`}
          aria-current={activeViewId === view.id ? "page" : undefined}
          title={view.label}
          onclick={() => (mobileDrawerOpen = false)}
        >
          <span class="tr-nav-icon" aria-hidden="true"><WorkbenchIcon name={view.icon} /></span>
          <span class="tr-nav-label">{view.label}</span>
        </a>
      {/each}
    </nav>

    <div class="tr-drawer__foot">
      <span class="tr-drawer__status"><i aria-hidden="true"></i><b>静态演示</b></span>
      <small>导入版本 · 2026-08-25</small>
    </div>
  </aside>

  <button
    class="tr-drawer-backdrop"
    type="button"
    aria-label="关闭导航菜单"
    tabindex={mobileDrawerOpen ? 0 : -1}
    onclick={() => (mobileDrawerOpen = false)}
  ></button>

  <section class="tr-workspace">
    <header class="tr-topbar">
      <div class="tr-topbar__title">
        <button
          class="tr-mobile-menu"
          type="button"
          aria-label={mobileDrawerOpen ? "关闭导航菜单" : "打开导航菜单"}
          aria-expanded={mobileDrawerOpen}
          aria-controls="tr-workbench-drawer"
          onclick={toggleDrawer}
        >
          <WorkbenchIcon name="menu" />
        </button>
        <a class="tr-back-link" href="/" aria-label="返回市场研究门户">
          <WorkbenchIcon name="back" />
        </a>
        <div>
          <span>东方财富证券 · 资金管理部</span>
          <div><h1>交易研究工作台</h1><b aria-hidden="true">/</b><strong>{activeView?.label}</strong></div>
        </div>
      </div>
      <div class="tr-topbar__meta">
        <span class="tr-demo-pill"><i aria-hidden="true"></i>静态演示</span>
        <span class="tr-as-of"><WorkbenchIcon name="calendar" /><span>数据截至</span><strong>{activeDate}</strong></span>
      </div>
    </header>

    <div class="tr-context-strip">
      <div><WorkbenchIcon name={activeView?.icon ?? "overview"} /><strong>{activeView?.label}</strong><span>{activeView?.context}</span></div>
      <span><WorkbenchIcon name="database" />未来统一由数据库与同源 /data API 提供</span>
    </div>

    <main id="tr-workbench-main" bind:this={mainRegion} tabindex="-1">
      {#if activeViewId === "overview"}
        <OverviewView />
      {:else if activeViewId === "trading"}
        <TradingView />
      {:else if activeViewId === "credit"}
        <CreditView />
      {:else if activeViewId === "research"}
        <ResearchView />
      {:else}
        <WorkflowView />
      {/if}
    </main>

    <footer class="tr-page-footer">
      当前页面使用迁入项目的冻结演示数据，不用于实时交易、授信审批或研究发布。
    </footer>
  </section>
</div>
