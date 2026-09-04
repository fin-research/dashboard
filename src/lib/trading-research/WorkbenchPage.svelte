<script lang="ts">
  import { afterNavigate } from "$app/navigation";

  import BondLedgerPage from "$lib/pages/BondLedgerPage.svelte";
  import FinancingModelPage from "$lib/pages/FinancingModelPage.svelte";
  import SecondaryBondPoolWeeklyPage from "$lib/pages/SecondaryBondPoolWeeklyPage.svelte";
  import CreditView from "./CreditView.svelte";
  import OverviewView from "./OverviewView.svelte";
  import ResearchView from "./ResearchView.svelte";
  import TradingView from "./TradingView.svelte";
  import WorkbenchIcon from "./WorkbenchIcon.svelte";
  import WorkflowView from "./WorkflowView.svelte";
  import {
    normalizeWorkbenchView,
    workbenchRoutes,
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
    workbenchRoutes.find((view) => view.id === activeViewId) ?? workbenchRoutes[0],
  );

  afterNavigate(() => {
    mobileDrawerOpen = false;
    requestAnimationFrame(() => mainRegion?.focus({ preventScroll: true }));
  });

  function toggleDesktopSidebar(): void {
    desktopCollapsed = !desktopCollapsed;
  }

  function toggleMobileDrawer(): void {
    mobileDrawerOpen = !mobileDrawerOpen;
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && mobileDrawerOpen) mobileDrawerOpen = false;
  }

  function isIntegratedView(value: WorkbenchViewId): boolean {
    return value === "bond" || value === "secondary-bond-pool" || value === "financing-model";
  }
</script>

<svelte:head>
  <title>{activeView?.label} · 交易研究工作台</title>
  <meta
    name="description"
    content="资金管理部交易管理、授信管理、研究辅助、流程、二级池周报与融资择时工作台"
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

  <header class="tr-topbar">
    <div class="tr-topbar__title">
      <button
        class="tr-sidebar-toggle"
        type="button"
        aria-label={desktopCollapsed ? "展开侧边导航" : "折叠侧边导航"}
        aria-expanded={!desktopCollapsed}
        aria-controls="tr-workbench-drawer"
        onclick={toggleDesktopSidebar}
      >
        <WorkbenchIcon name="sidebar" />
      </button>
      <button
        class="tr-mobile-menu"
        type="button"
        aria-label={mobileDrawerOpen ? "关闭导航菜单" : "打开导航菜单"}
        aria-expanded={mobileDrawerOpen}
        aria-controls="tr-workbench-drawer"
        onclick={toggleMobileDrawer}
      >
        <WorkbenchIcon name="menu" />
      </button>
      <div class="tr-topbar__heading">
        <a class="tr-portal-link" href="/" aria-label="返回市场研究门户">
          东方财富证券 · 资金管理部
        </a>
        <nav class="tr-breadcrumb" aria-label="当前位置">
          <ol>
            <li><a href="/trading-research">交易研究工作台</a></li>
            <li class="tr-breadcrumb__separator" aria-hidden="true">/</li>
            <li aria-current="page"><h1>{activeView?.label}</h1></li>
          </ol>
        </nav>
      </div>
    </div>
    <div class="tr-topbar__meta">
      <div id="tr-topbar-actions" class="tr-topbar__actions"></div>
    </div>
  </header>

  <aside id="tr-workbench-drawer" class="tr-drawer" aria-label="交易研究工作台导航">
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
      {:else if activeViewId === "secondary-bond-pool"}
        <SecondaryBondPoolWeeklyPage embedded />
      {:else}
        <FinancingModelPage embedded />
      {/if}
    </div>
  </section>
</div>
