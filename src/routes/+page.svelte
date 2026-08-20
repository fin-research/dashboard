<svelte:head>
  <title>市场研究 · 资金管理部</title>
  <meta name="description" content="市场点评与市场热点入口" />
  <meta name="theme-color" content="#fffbf4" />
</svelte:head>

<div class="home-page">
  <header class="site-header">
    <a href="/" aria-label="市场研究首页">
      <span class="brand-mark" aria-hidden="true"><i></i><i></i></span>
      <span>资金管理部</span>
    </a>
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
          <p>每日市场可视化与文字报告</p>
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
          <p>研报热点与跨资产传导分析</p>
        </span>
        <span class="tool-action">
          打开市场热点
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14m-5-5 5 5-5 5" />
          </svg>
        </span>
      </a>
    </nav>
  </main>
</div>

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
      "PingFang SC", "Microsoft YaHei", ui-sans-serif, system-ui, sans-serif;
  }

  .home-page {
    --ink: #15243b;
    --background: #fffbf4;
    --yellow: #ffda6a;
    --blue: #91ceff;
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
    width: min(1040px, calc(100% - 48px));
    margin-inline: auto;
  }

  .site-header {
    display: flex;
    min-height: 80px;
    align-items: center;
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
    grid-template-columns: minmax(0, 1.08fr) minmax(0, 0.92fr);
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

  .tool-copy h2,
  .tool-copy p {
    margin: 0;
  }

  .tool-copy h2 {
    color: var(--ink);
    font-size: clamp(1.9rem, 4vw, 2.5rem);
    font-weight: 780;
    line-height: 1.16;
    letter-spacing: -0.035em;
  }

  .tool-copy p {
    color: #263b58;
    font-size: 1rem;
    line-height: 1.65;
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
</style>
