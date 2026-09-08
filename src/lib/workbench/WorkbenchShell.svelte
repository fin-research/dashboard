<script lang="ts">
  import { type Snippet } from "svelte";
  import { afterNavigate } from "$app/navigation";
  import AuthMenu from "$lib/AuthMenu.svelte";
  import WorkbenchIcon from "../trading-research/WorkbenchIcon.svelte";
  import type { WorkbenchIconName } from "../trading-research/demo-data";
  import "../../layout-report.css";
  import "../trading-research/workbench.css";
  import "./workspace.css";

  let { title, homeHref, views, activeViewId, activeLabel = "", children, chat = false, canvas = false,
    class: className = '', actions, account, status,
    integrated = false, layoutReport = false, reportKind = null, visualVariant = 'workspace', tone = 'blue' }: {
    title: string; homeHref: string;
    class?: string; actions?: Snippet; account?: Snippet; status?: Snippet;
    views: ReadonlyArray<{ id: string; label: string; icon: WorkbenchIconName; href: string }>;
    activeViewId: string; activeLabel?: string; children: Snippet; chat?: boolean; canvas?: boolean;
    integrated?: boolean; layoutReport?: boolean; reportKind?: "secondary" | "financing" | "liability" | null;
    visualVariant?: 'workspace' | 'report'; tone?: 'blue' | 'teal' | 'orange' | 'purple';
  } = $props();
  let desktopCollapsed = $state(false);
  let mobileDrawerOpen = $state(false);
  let mainRegion: HTMLElement;
  let workspaceRegion: HTMLElement;
  let keyboardNavigation = false;
  let topbarHeight = $state(72);
  function measureTopbar(element: HTMLElement) {
    const resize = () => (topbarHeight = Math.ceil(element.getBoundingClientRect().height));
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    return { destroy: () => observer.disconnect() };
  }
  const activeView = $derived(views.find(view => view.id === activeViewId) ?? { label: activeLabel });
  const currentLabel = $derived(activeLabel || activeView.label);

  afterNavigate(({ from, to, type }) => {
    mobileDrawerOpen = false;
    if (type !== "popstate" && from?.url?.pathname !== to?.url?.pathname) {
      workspaceRegion?.scrollTo({ top: 0, left: 0 });
    }
    if (keyboardNavigation) requestAnimationFrame(() => mainRegion?.focus({ preventScroll: true }));
  });
  function toggleDesktopSidebar() { desktopCollapsed = !desktopCollapsed; }
  function toggleMobileDrawer() { mobileDrawerOpen = !mobileDrawerOpen; }
  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === "Tab" || event.key === "Enter") keyboardNavigation = true;
    if (event.key === "Escape") mobileDrawerOpen = false;
  }
</script>

<svelte:head>
  <title>{currentLabel} · {title}</title>
  <meta
    name="description"
    content={`${title}业务模块`}
  />
  <meta name="theme-color" content="#f6f8fb" />
</svelte:head>

<svelte:window onkeydown={handleWindowKeydown} onpointerdown={() => (keyboardNavigation = false)} />

<div
  class:tr-shell--collapsed={desktopCollapsed}
  class:tr-shell--mobile-open={mobileDrawerOpen}
  class:tr-shell--workspace={!layoutReport && !integrated && visualVariant === 'workspace'}
  class={`tr-workbench tr-shell ${className}`}
  data-workspace-tone={tone}
  style:--tr-topbar-height={`${topbarHeight}px`}
>
  <a class="tr-skip-link" href="#tr-workbench-main">跳至工作台内容</a>

  <header class="navbar tr-topbar" use:measureTopbar>
    <div class="tr-topbar__title">
      <button
        class="btn btn-ghost btn-square tr-sidebar-toggle"
        type="button"
        aria-label={desktopCollapsed ? "展开侧边导航" : "折叠侧边导航"}
        aria-expanded={!desktopCollapsed}
        aria-controls="tr-workbench-drawer"
        onclick={toggleDesktopSidebar}
      >
        <WorkbenchIcon name="sidebar" />
      </button>
      <button
        class="btn btn-ghost btn-square tr-mobile-menu"
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
            <li aria-current="page"><h1>{currentLabel}</h1></li>
          </ol>
        </nav>
      </div>
    </div>
    <div class="tr-topbar__meta">
      {#if account}{@render account()}{:else}<AuthMenu />{/if}
      <div id="tr-topbar-actions" class="tr-topbar__actions">{#if actions}{@render actions()}{/if}</div>
    </div>
  </header>

  <aside id="tr-workbench-drawer" class="tr-drawer" aria-label={`${title}导航`}>
    <nav class="tr-drawer__nav" aria-label="业务模块" data-sveltekit-preload-data="hover">
      <ul class="menu tr-navigation-list">
      {#each views as view}
        <li><a
          class:active={activeViewId === view.id}
          href={view.href}
          aria-current={activeViewId === view.id ? "page" : undefined}
          title={view.label}
          onclick={() => (mobileDrawerOpen = false)}
        >
          <span class="tr-nav-icon" aria-hidden="true"><WorkbenchIcon name={view.icon} /></span>
          <span class="tr-nav-label">{view.label}</span>
        </a></li>
      {/each}
      </ul>
    </nav>
  </aside>

  <button
    class="tr-drawer-backdrop"
    type="button"
    aria-label="关闭导航菜单"
    tabindex={mobileDrawerOpen ? 0 : -1}
    onclick={() => (mobileDrawerOpen = false)}
  ></button>

  <section class="tr-workspace" bind:this={workspaceRegion}>
    {#if status}{@render status()}{/if}
    <main
      id="tr-workbench-main"
      class:tr-chat-page={chat}
      class:tr-canvas-page={canvas}
      class:tr-integrated-page={integrated}
      class:layout-report={layoutReport}
      class:layout-report--secondary={reportKind === "secondary"}
      class:layout-report--financing={reportKind === "financing"}
      class:layout-report--liability={reportKind === "liability"}
      class:secondary-weekly-report={reportKind === "secondary"}
      class:secondary-weekly-report--embedded={reportKind === "secondary"}
      bind:this={mainRegion}
      tabindex="-1"
    >
      {@render children()}
    </main>
  </section>
</div>
