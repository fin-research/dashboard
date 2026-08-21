<script lang="ts">
  import { onMount } from "svelte";

  import {
    readPreferences,
    savePreferences,
    type MarketColorConvention,
  } from "$lib/preferences";

  let settingsDialog: HTMLDialogElement;
  let marketColorConvention: MarketColorConvention = "red-up-green-down";

  onMount(() => {
    marketColorConvention = readPreferences().marketColorConvention;
  });

  function openSettings(): void {
    marketColorConvention = readPreferences().marketColorConvention;
    settingsDialog.showModal();
  }

  function persistSettings(): void {
    savePreferences({ marketColorConvention });
    settingsDialog.close();
  }
</script>

<svelte:head>
  <title>市场研究 · 资金管理部</title>
  <meta name="description" content="市场点评、市场热点与二级池周报入口" />
  <meta name="theme-color" content="#fffbf4" />
</svelte:head>

<div class="home-page">
  <header class="site-header">
    <a href="/" aria-label="市场研究首页">
      <span class="brand-mark" aria-hidden="true"><i></i><i></i></span>
      <span>资金管理部</span>
    </a>
    <button class="settings-entry" type="button" onclick={openSettings}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19 13.5v-3l-2-.7a7.6 7.6 0 0 0-.7-1.7l.9-1.9-2.1-2.1-1.9.9a7.6 7.6 0 0 0-1.7-.7L10.5 2h-3l-.7 2.3a7.6 7.6 0 0 0-1.7.7l-1.9-.9-2.1 2.1.9 1.9a7.6 7.6 0 0 0-.7 1.7L-1 10.5v3l2.3.7a7.6 7.6 0 0 0 .7 1.7l-.9 1.9 2.1 2.1 1.9-.9a7.6 7.6 0 0 0 1.7.7l.7 2.3h3l.7-2.3a7.6 7.6 0 0 0 1.7-.7l1.9.9 2.1-2.1-.9-1.9a7.6 7.6 0 0 0 .7-1.7z" transform="translate(3) scale(.75)" />
      </svg>
      <span>个性化</span>
    </button>
  </header>

  <main>
    <h1 class="sr-only">市场研究</h1>
    <nav class="tool-grid" aria-label="市场研究内容">
      <a class="tool-card tool-card--briefing" href="/market-briefing">
        <span class="tool-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M5 3h10l4 4v14H5z" />
            <path d="M15 3v5h5M8 12h8M8 16h6" />
          </svg>
        </span>
        <span class="card-visual card-visual--briefing" aria-hidden="true">
          <svg viewBox="0 0 180 100">
            <path d="M12 80h156M28 78V58M64 78V43M100 78V64M136 78V27" />
            <path d="m18 57 38-18 39 14 51-34" />
            <circle cx="18" cy="57" r="3" />
            <circle cx="56" cy="39" r="3" />
            <circle cx="95" cy="53" r="3" />
            <circle cx="146" cy="19" r="3" />
          </svg>
        </span>
        <span class="tool-copy">
          <h2>市场点评</h2>
        </span>
        <span class="tool-action">
          打开市场点评
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14m-5-5 5 5-5 5" />
          </svg>
        </span>
      </a>

      <a class="tool-card tool-card--hotspots" href="/rag/hotspots">
        <span class="tool-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <circle cx="6" cy="12" r="2.5" />
            <circle cx="17" cy="6" r="2.5" />
            <circle cx="18" cy="17" r="2.5" />
            <path d="m8.3 10.8 6.4-3.6M8.4 13.1l7.2 2.8" />
          </svg>
        </span>
        <span class="card-visual card-visual--hotspots" aria-hidden="true">
          <svg viewBox="0 0 180 100">
            <path d="m26 66 41-38 39 30 47-39M67 28l-8 57m47-27 42 23" />
            <circle cx="26" cy="66" r="7" />
            <circle cx="67" cy="28" r="10" />
            <circle cx="59" cy="85" r="5" />
            <circle cx="106" cy="58" r="12" />
            <circle cx="153" cy="19" r="6" />
            <circle cx="148" cy="81" r="8" />
          </svg>
        </span>
        <span class="tool-copy">
          <h2>市场热点</h2>
        </span>
        <span class="tool-action">
          打开市场热点
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14m-5-5 5 5-5 5" />
          </svg>
        </span>
      </a>

      <a class="tool-card tool-card--ledger" href="/dashboard/bond-ledger">
        <span class="tool-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M4 4h16v16H4zM8 16v-4m4 4V8m4 8v-6" />
          </svg>
        </span>
        <span class="card-visual card-visual--ledger" aria-hidden="true">
          <svg viewBox="0 0 180 100">
            <path d="M12 82h156M27 80V55h22v25M67 80V36h22v44M107 80V49h22v31M147 80V20h18v60" />
            <path d="m20 49 39-18 39 13 58-30" />
            <circle cx="20" cy="49" r="3" />
            <circle cx="59" cy="31" r="3" />
            <circle cx="98" cy="44" r="3" />
            <circle cx="156" cy="14" r="3" />
          </svg>
        </span>
        <span class="tool-copy">
          <h2>二级池周报</h2>
        </span>
        <span class="tool-action">
          打开二级池周报
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14m-5-5 5 5-5 5" />
          </svg>
        </span>
      </a>
    </nav>
  </main>
</div>

<dialog bind:this={settingsDialog} class="settings-dialog" aria-labelledby="settings-title">
  <form method="dialog" onsubmit={(event) => event.preventDefault()}>
    <header>
      <h2 id="settings-title">个性化配置</h2>
      <button type="button" aria-label="关闭个性化配置" onclick={() => settingsDialog.close()}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
    </header>
    <fieldset>
      <legend>行情颜色逻辑</legend>
      <label>
        <input type="radio" bind:group={marketColorConvention} value="red-up-green-down" />
        <span><strong>红涨绿跌</strong><small>默认</small></span>
      </label>
      <label>
        <input type="radio" bind:group={marketColorConvention} value="green-up-red-down" />
        <span><strong>绿涨红跌</strong></span>
      </label>
    </fieldset>
    <footer>
      <button type="button" class="settings-cancel" onclick={() => settingsDialog.close()}>取消</button>
      <button type="button" class="settings-save" onclick={persistSettings}>保存</button>
    </footer>
  </form>
</dialog>

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(html) {
    min-width: 0;
    min-height: 100%;
    background: #fffbf4;
    color-scheme: light;
  }

  :global(body) {
    min-width: 0;
    min-height: 100%;
    margin: 0;
    background: #fffbf4;
    color: #15243b;
    font-family:
      ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
      sans-serif;
  }

  .home-page {
    --ink: #15243b;
    --background: #fffbf4;
    --yellow: #ffda6a;
    --blue: #91ceff;
    --mint: #bce9d9;
    min-height: 100dvh;
    background: var(--background);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .site-header,
  main {
    width: min(1280px, calc(100% - 48px));
    margin-inline: auto;
  }

  .site-header {
    display: flex;
    min-height: 80px;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid rgba(21, 36, 59, 0.16);
  }

  .site-header a {
    display: inline-flex;
    min-height: 48px;
    align-items: center;
    gap: 11px;
    border-radius: 8px;
    color: var(--ink);
    font-size: 1rem;
    font-weight: 750;
    letter-spacing: 0.05em;
    text-decoration: none;
  }

  .settings-entry {
    display: inline-flex;
    min-height: 44px;
    align-items: center;
    gap: 8px;
    padding: 0 13px;
    border: 1px solid rgba(21, 36, 59, 0.16);
    border-radius: 10px;
    color: var(--ink);
    background: #fff;
    cursor: pointer;
    font: inherit;
    font-weight: 700;
  }

  .settings-entry svg {
    width: 20px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.8;
  }

  .brand-mark {
    display: grid;
    width: 34px;
    height: 34px;
    grid-template-columns: 1fr 1fr;
    gap: 3px;
    padding: 5px;
    border: 1px solid rgba(21, 36, 59, 0.16);
    border-radius: 10px;
    background: #ffffff;
  }

  .brand-mark i {
    display: block;
    border-radius: 4px;
  }

  .brand-mark i:first-child {
    background: var(--yellow);
  }

  .brand-mark i:last-child {
    background: var(--blue);
  }

  main {
    padding-block: clamp(64px, 12vh, 112px);
  }

  .tool-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 24px;
  }

  .tool-card {
    position: relative;
    display: grid;
    min-height: 320px;
    grid-template-rows: auto 1fr auto;
    gap: 30px;
    padding: 32px;
    overflow: hidden;
    border: 1px solid rgba(21, 36, 59, 0.08);
    border-radius: 24px;
    color: var(--ink);
    text-decoration: none;
    cursor: pointer;
    transition:
      box-shadow 180ms ease,
      transform 180ms ease;
  }

  .tool-card::before,
  .tool-card::after {
    position: absolute;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.22);
    content: "";
    pointer-events: none;
  }

  .tool-card::before {
    top: -76px;
    right: -48px;
    width: 220px;
    height: 220px;
  }

  .tool-card::after {
    top: 90px;
    right: 128px;
    width: 46px;
    height: 46px;
  }

  .tool-card--briefing {
    background: var(--yellow);
    box-shadow: 0 24px 54px rgba(195, 139, 27, 0.16);
  }

  .tool-card--hotspots {
    background: var(--blue);
    box-shadow: 0 24px 54px rgba(31, 119, 183, 0.16);
  }

  .tool-card--ledger {
    background: var(--mint);
    box-shadow: 0 24px 54px rgba(30, 128, 94, 0.14);
  }

  .tool-card:hover {
    box-shadow: 0 30px 64px rgba(21, 36, 59, 0.18);
    transform: translateY(-4px);
  }

  .tool-card:active {
    box-shadow: 0 18px 40px rgba(21, 36, 59, 0.14);
    transform: translateY(-1px);
  }

  .tool-card:focus-visible,
  .site-header a:focus-visible {
    outline: 3px solid #1d4ed8;
    outline-offset: 4px;
  }

  .tool-icon {
    position: relative;
    z-index: 2;
    display: grid;
    width: 56px;
    height: 56px;
    place-items: center;
    border: 1px solid rgba(21, 36, 59, 0.15);
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.7);
    box-shadow: 0 8px 20px rgba(21, 36, 59, 0.08);
  }

  .tool-icon svg,
  .tool-action svg {
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.9;
  }

  .tool-icon svg {
    width: 28px;
  }

  .card-visual {
    position: absolute;
    z-index: 1;
    top: 28px;
    right: 24px;
    width: min(42%, 188px);
    color: var(--ink);
    opacity: 0.33;
    pointer-events: none;
  }

  .card-visual svg {
    width: 100%;
    overflow: visible;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 2;
  }

  .card-visual circle {
    fill: rgba(255, 255, 255, 0.72);
  }

  .tool-copy {
    position: relative;
    z-index: 2;
    display: grid;
    align-content: start;
    gap: 12px;
  }

  .tool-copy h2 {
    margin: 0;
  }

  .tool-copy h2 {
    color: var(--ink);
    font-size: clamp(1.9rem, 4vw, 2.5rem);
    font-weight: 780;
    line-height: 1.16;
    letter-spacing: -0.035em;
  }

  .tool-action {
    position: relative;
    z-index: 2;
    display: flex;
    width: fit-content;
    min-height: 48px;
    align-items: center;
    justify-content: flex-start;
    gap: 16px;
    border-radius: 12px;
    padding: 0 17px;
    border: 1px solid rgba(21, 36, 59, 0.12);
    color: var(--ink);
    background: rgba(255, 255, 255, 0.72);
    box-shadow: 0 7px 18px rgba(21, 36, 59, 0.08);
    font-size: 0.9rem;
    font-weight: 700;
  }

  .tool-action svg {
    width: 19px;
  }

  @media (max-width: 1080px) {
    .tool-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .tool-card--ledger {
      grid-column: 1 / -1;
    }
  }

  @media (max-width: 720px) {
    .site-header,
    main {
      width: min(100% - 32px, 1040px);
    }

    .site-header {
      min-height: 68px;
    }

    main {
      padding-block: 48px;
    }

    .tool-grid {
      grid-template-columns: 1fr;
      gap: 18px;
    }

    .tool-card--ledger {
      grid-column: 1;
    }

    .tool-card {
      min-height: 272px;
      gap: 24px;
      padding: 24px;
      border-radius: 20px;
    }

    .card-visual {
      width: 150px;
      opacity: 0.24;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .tool-card {
      transition: none;
    }

    .tool-card:hover,
    .tool-card:active {
      transform: none;
    }
  }

  :global(.settings-dialog) {
    width: min(520px, calc(100% - 32px));
    max-height: calc(100dvh - 32px);
    padding: 0;
    overflow: hidden;
    border: 1px solid rgba(21, 36, 59, 0.14);
    border-radius: 18px;
    color: #15243b;
    background: #fff;
    box-shadow: 0 28px 72px rgba(21, 36, 59, 0.24);
  }

  :global(.settings-dialog::backdrop) {
    background: rgba(15, 23, 42, 0.38);
    backdrop-filter: blur(3px);
  }

  :global(.settings-dialog form) {
    display: grid;
    gap: 22px;
    padding: 24px;
  }

  :global(.settings-dialog header),
  :global(.settings-dialog footer) {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  :global(.settings-dialog h2) {
    margin: 0;
    font-size: 1.25rem;
  }

  :global(.settings-dialog header button) {
    display: grid;
    width: 44px;
    height: 44px;
    place-items: center;
    border: 0;
    border-radius: 10px;
    background: #f4f6f9;
    cursor: pointer;
  }

  :global(.settings-dialog header svg) {
    width: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
  }

  :global(.settings-dialog fieldset) {
    display: grid;
    gap: 10px;
    margin: 0;
    padding: 0;
    border: 0;
  }

  :global(.settings-dialog legend) {
    margin-bottom: 10px;
    font-weight: 750;
  }

  :global(.settings-dialog fieldset label) {
    display: flex;
    min-height: 56px;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border: 1px solid #d8e2f0;
    border-radius: 10px;
    cursor: pointer;
  }

  :global(.settings-dialog fieldset label:has(input:checked)) {
    border-color: #2f6fd6;
    background: #eef4ff;
  }

  :global(.settings-dialog input) {
    width: 20px;
    height: 20px;
    accent-color: #2f6fd6;
  }

  :global(.settings-dialog fieldset span) {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  :global(.settings-dialog small) {
    padding: 2px 6px;
    border-radius: 5px;
    color: #175cd3;
    background: #eff4ff;
    font-size: 0.75rem;
    font-weight: 750;
  }

  :global(.settings-dialog footer) {
    justify-content: flex-end;
    gap: 10px;
  }

  :global(.settings-dialog footer button) {
    min-width: 88px;
    min-height: 44px;
    border-radius: 9px;
    cursor: pointer;
    font: inherit;
    font-weight: 750;
  }

  :global(.settings-cancel) {
    border: 1px solid #d0d5dd;
    background: #fff;
  }

  :global(.settings-save) {
    border: 1px solid #2f6fd6;
    color: #fff;
    background: #2f6fd6;
  }

  :global(.settings-entry:focus-visible),
  :global(.settings-dialog button:focus-visible),
  :global(.settings-dialog input:focus-visible) {
    outline: 3px solid rgba(47, 111, 214, 0.28);
    outline-offset: 2px;
  }
</style>
