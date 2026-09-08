<script lang="ts">
  import { type Snippet } from "svelte";
  import { afterNavigate } from "$app/navigation";
  import AuthMenu from "$lib/AuthMenu.svelte";
  import WorkbenchIcon from "../trading-research/WorkbenchIcon.svelte";
  import type { WorkbenchIconName } from "../trading-research/demo-data";
  import "../../app.css";
  import "../../styles.css";
  import "../../layout-report.css";
  import "../trading-research/workbench.css";

  let { title, homeHref, views, activeViewId, activeLabel = "", children, chat = false, canvas = false,
    integrated = false, layoutReport = false, reportKind = null }: {
    title: string; homeHref: string;
    views: ReadonlyArray<{ id: string; label: string; icon: WorkbenchIconName; href: string }>;
    activeViewId: string; activeLabel?: string; children: Snippet; chat?: boolean; canvas?: boolean;
    integrated?: boolean; layoutReport?: boolean; reportKind?: "secondary" | "financing" | null;
  } = $props();
  let desktopCollapsed = $state(false);
  let mobileDrawerOpen = $state(false);
  let mainRegion: HTMLElement;
  const activeView = $derived(views.find(view => view.id === activeViewId) ?? { label: activeLabel });

  afterNavigate(() => {
    mobileDrawerOpen = false;
    requestAnimationFrame(() => mainRegion?.focus({ preventScroll: true }));
  });
  function toggleDesktopSidebar() { desktopCollapsed = !desktopCollapsed; }
  function toggleMobileDrawer() { mobileDrawerOpen = !mobileDrawerOpen; }
  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") mobileDrawerOpen = false;
  }
</script>

<svelte:head>
  <title>{activeView?.label} · {title}</title>
  <meta
    name="description"
    content={`${title}业务模块`}
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
            <li><a href={homeHref}>{title}</a></li>
            <li class="tr-breadcrumb__separator" aria-hidden="true">/</li>
            <li aria-current="page"><h1>{activeView?.label}</h1></li>
          </ol>
        </nav>
      </div>
    </div>
    <div class="tr-topbar__meta">
      <AuthMenu />
      <div id="tr-topbar-actions" class="tr-topbar__actions"></div>
    </div>
  </header>

  <aside id="tr-workbench-drawer" class="tr-drawer" aria-label={`${title}导航`}>
    <nav class="tr-drawer__nav" aria-label="业务模块">
      {#each views as view}
        <a
          class:active={activeViewId === view.id}
          href={view.href}
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
    <main
      id="tr-workbench-main"
      class:tr-chat-page={chat}
      class:tr-canvas-page={canvas}
      class:tr-integrated-page={integrated}
      class:layout-report={layoutReport}
      class:layout-report--secondary={reportKind === "secondary"}
      class:layout-report--financing={reportKind === "financing"}
      class:secondary-weekly-report={reportKind === "secondary"}
      class:secondary-weekly-report--embedded={reportKind === "secondary"}
      bind:this={mainRegion}
      tabindex="-1"
    >
      {@render children()}
    </main>
  </section>
</div>
