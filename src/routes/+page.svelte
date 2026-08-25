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
  <meta name="description" content="资金日报、市场研究工作台与管理入口" />
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
      <a class="tool-card tool-card--fund-report" href="/fund-report">
        <span class="tool-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M4 4h16v16H4zM7 8h10M7 12h4M7 16h6" />
            <path d="m14 15 2-2 2 2" />
          </svg>
        </span>
        <span class="card-visual card-visual--fund-report" aria-hidden="true">
          <svg viewBox="0 0 180 100">
            <path d="M22 14h136v72H22zM22 34h136M58 34v52" />
            <path d="M31 48h18M31 61h18M31 74h18M72 69l18-18 17 11 31-30" />
            <circle cx="72" cy="69" r="3" />
            <circle cx="90" cy="51" r="3" />
            <circle cx="107" cy="62" r="3" />
            <circle cx="138" cy="32" r="3" />
          </svg>
        </span>
        <span class="tool-copy">
          <h2>资金日报</h2>
        </span>
        <span class="tool-action">
          打开今日资金日报
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14m-5-5 5 5-5 5" />
          </svg>
        </span>
      </a>

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

      <a class="tool-card tool-card--hotspots" href="/market-hotspots">
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

      <a class="tool-card tool-card--trading-research" href="/trading-research">
        <span class="tool-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <rect x="4" y="4" width="16" height="16" rx="2" />
            <path d="M9 4v16M9 9h11M9 15h11M13 12h3m-1.5-1.5v3" />
          </svg>
        </span>
        <span class="card-visual card-visual--trading-research" aria-hidden="true">
          <svg viewBox="0 0 180 100">
            <path d="M18 18h144v68H18zM18 37h144M58 37v49" />
            <path d="M29 51h18M29 62h18M29 73h18M72 55h25M72 69h45M130 52h19v19h-19z" />
            <path d="m133 62 5 5 9-11" />
          </svg>
        </span>
        <span class="tool-copy">
          <h2>交易研究工作台</h2>
        </span>
        <span class="tool-action">
          打开交易研究工作台
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14m-5-5 5 5-5 5" />
          </svg>
        </span>
      </a>

      <a class="tool-card tool-card--workspace" href="/financing/">
        <span class="tool-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M4 7h16v13H4zM8 7V4h8v3M8 12h8M8 16h5" />
          </svg>
        </span>
        <span class="card-visual card-visual--workspace" aria-hidden="true">
          <svg viewBox="0 0 180 100">
            <path d="M18 18h144v68H18zM18 37h144M61 37v49" />
            <path d="m30 53 6 6 12-14M30 73l6 6 12-14M75 52h67M75 70h49" />
          </svg>
        </span>
        <span class="tool-copy">
          <h2>融资工作台</h2>
        </span>
        <span class="tool-action">
          打开融资工作台
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14m-5-5 5 5-5 5" />
          </svg>
        </span>
      </a>

      <a class="tool-card tool-card--management" href="/management">
        <span class="tool-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M4 7h16v13H4zM8 7V4h8v3M8 12h8M8 16h5" />
            <circle cx="17" cy="16" r="2" />
          </svg>
        </span>
        <span class="card-visual card-visual--management" aria-hidden="true">
          <svg viewBox="0 0 180 100">
            <path d="M22 18h136v68H22zM22 37h136M62 37v49" />
            <path d="M33 52h18M33 65h18M33 78h18M76 51h62M76 66h44" />
            <circle cx="141" cy="70" r="13" />
            <path d="M141 63v14M134 70h14" />
          </svg>
        </span>
        <span class="tool-copy">
          <h2>管理</h2>
        </span>
        <span class="tool-action">
          打开管理
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

  .home-page {
    --ink: #15243b;
    --background: #fffbf4;
    --yellow: #ffda6a;
    --blue: #91ceff;
    --slate-blue: #d6e4f3;
    --peach: #ffc9a9;
    --mint: #a9e8d2;
    --lilac: #dfceff;
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
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 380px));
    justify-content: center;
    gap: 24px;
  }

  .tool-card {
    position: relative;
    display: grid;
    width: 100%;
    min-width: 0;
    max-width: 380px;
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

  .tool-card--fund-report {
    background: var(--mint);
    box-shadow: 0 24px 54px rgba(22, 163, 148, 0.16);
  }

  .tool-card--hotspots {
    background: var(--blue);
    box-shadow: 0 24px 54px rgba(31, 119, 183, 0.16);
  }

  .tool-card--workspace {
    background: var(--peach);
    box-shadow: 0 24px 54px rgba(184, 91, 43, 0.14);
  }

  .tool-card--trading-research {
    background: var(--slate-blue);
    box-shadow: 0 24px 54px rgba(47, 111, 214, 0.14);
  }

  .tool-card--management {
    background: var(--lilac);
    box-shadow: 0 24px 54px rgba(105, 65, 198, 0.14);
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
    overflow-wrap: anywhere;
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
