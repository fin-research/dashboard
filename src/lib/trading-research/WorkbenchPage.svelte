<script lang="ts">
  import { afterNavigate } from "$app/navigation";

  import BondLedgerPage from "$lib/pages/BondLedgerPage.svelte";
  import FinancingModelPage from "$lib/pages/FinancingModelPage.svelte";
  import CreditView from "./CreditView.svelte";
  import OverviewView from "./OverviewView.svelte";
  import ResearchView from "./ResearchView.svelte";
  import TradingView from "./TradingView.svelte";
  import WorkbenchIcon from "./WorkbenchIcon.svelte";
  import WorkflowView from "./WorkflowView.svelte";
  import {
    demoMeta,
    normalizeWorkbenchView,
    workbenchViewPath,
    workbenchViews,
    type WorkbenchViewId,
  } from "./demo-data";
  import "./workbench.css";

  let { viewId = "overview" }: { viewId?: string | null } = $props();

  let desktopCollapsed = $state(false);
  let mobileDrawerOpen = $state(false);
  let mainRegion: HTMLElement;

  const activeViewId = $derived(normalizeWorkbenchView(viewId));
  const activeView = $derived(
    workbenchViews.find((view) => view.id === activeViewId) ?? workbenchViews[0],
  );
  const activeDate = $derived.by(() => {
    if (activeViewId === "trading") return demoMeta.tradingAsOf;
    if (activeViewId === "credit") return demoMeta.creditAsOf;
    if (activeViewId === "research") {
      return `${demoMeta.researchStart}—${demoMeta.researchEnd}`;
    }
    if (activeViewId === "overview") return "多基准日";
    return null;
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

  function isIntegratedView(value: WorkbenchViewId): boolean {
    return value === "bond" || value === "financing-model";
  }
</script>

<svelte:head>
  <title>{activeView?.label} · 交易研究工作台</title>
  <meta
    name="description"
    content="资金管理部交易管理、授信管理、研究辅助、流程、二级池与融资择时工作台"
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
          href={workbenchViewPath(view.id)}
          aria-current={activeViewId === view.id ? "page" : undefined}
          title={view.label}
          onclick={() => (mobileDrawerOpen = false)}
        >
          <span class="tr-nav-icon" aria-hidden="true"><WorkbenchIcon name={view.icon} /></span>
          <span class="tr-nav-label">{view.label}</span>
        </a>
      {/each}
    </nav>
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
        {#if activeDate}
          <span class="tr-as-of"><WorkbenchIcon name="calendar" /><span>数据截至</span><strong>{activeDate}</strong></span>
        {/if}
        <div id="tr-topbar-actions" class="tr-topbar__actions"></div>
      </div>
    </header>

    <div
      id="tr-workbench-main"
      class:tr-integrated-page={isIntegratedView(activeViewId)}
      bind:this={mainRegion}
      role="main"
      tabindex="-1"
    >
      {#if activeViewId === "overview"}
        <OverviewView />
      {:else if activeViewId === "trading"}
        <TradingView />
      {:else if activeViewId === "credit"}
        <CreditView />
      {:else if activeViewId === "research"}
        <ResearchView />
      {:else if activeViewId === "workflow"}
        <WorkflowView />
      {:else if activeViewId === "bond"}
        <BondLedgerPage embedded />
      {:else}
        <FinancingModelPage embedded />
      {/if}
    </div>
  </section>
</div>
