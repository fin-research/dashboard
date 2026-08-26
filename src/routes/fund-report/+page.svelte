<script lang="ts">
  import "../../styles.css";

  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  function formatReportDate(date: string): string {
    const [year, month, day] = date.split("-");
    return `${year}年${Number(month)}月${Number(day)}日`;
  }

  function formatUploadedAt(value: string): string {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(value));
  }

  function formatSize(size: number): string {
    return size >= 1024 * 1024
      ? `${(size / 1024 / 1024).toFixed(2)} MB`
      : `${Math.max(1, Math.round(size / 1024))} KB`;
  }
</script>

<svelte:head>
  <title>历史资金日报 · 资金管理部</title>
  <meta name="description" content="按日期查看历史资金日报" />
  <meta name="theme-color" content="#f6f8fb" />
</svelte:head>

<div class="fund-report-page">
  <header class="fund-report-header">
    <div class="fund-report-title-block">
      <a class="fund-report-back" href="/" aria-label="返回市场研究门户">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12.5 4-6 6 6 6" /></svg>
      </a>
      <h1>
        <span>资金管理部</span>
        <span class="title-dot" aria-hidden="true">•</span>
        <span class="title-subject">历史资金日报</span>
      </h1>
    </div>
  </header>

  <main>
    <section class="report-panel" aria-labelledby="fund-report-list-title">
      <header class="panel-heading">
        <div>
          <span class="panel-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M5 4h14v16H5zM8 2v4M16 2v4M5 9h14M8 13h3M13 13h3M8 17h3" />
            </svg>
          </span>
          <h2 id="fund-report-list-title">历史资金日报</h2>
        </div>
        {#if !data.loadError}
          <span class="report-count">共 {data.reports.length} 期</span>
        {/if}
      </header>

      {#if data.loadError}
        <div class="report-state report-state--error" role="alert">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 17h.01" /></svg>
          <strong>{data.loadError}</strong>
          <a href="/fund-report">重新加载</a>
        </div>
      {:else if data.reports.length === 0}
        <div class="report-state">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5zM8 2v4M16 2v4M5 9h14" /></svg>
          <strong>暂无历史资金日报</strong>
        </div>
      {:else}
        <ul class="report-list">
          {#each data.reports as report}
            <li>
              <a href={report.url}>
                <span class="report-date">
                  <strong>{formatReportDate(report.date)}</strong>
                  {#if report.date === data.today}<span>今日</span>{/if}
                </span>
                <span class="report-meta">
                  <span>{formatSize(report.size)}</span>
                  <span>发布于 {formatUploadedAt(report.uploadedAt)}</span>
                </span>
                <span class="report-open">
                  打开日报
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5" /></svg>
                </span>
              </a>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </main>
</div>

<style>
  .fund-report-page {
    width: min(100%, 2100px);
    min-height: 100dvh;
    margin-inline: auto;
    padding: 12px 16px 40px;
    color: var(--text-1);
    background: var(--bg-page);
  }

  .fund-report-header {
    display: flex;
    min-height: 64px;
    align-items: center;
    padding: 4px 2px 12px;
    border-bottom: 1px solid var(--line);
  }

  .fund-report-title-block,
  .panel-heading,
  .panel-heading > div,
  .report-date,
  .report-meta,
  .report-open {
    display: flex;
    align-items: center;
  }

  .fund-report-title-block {
    min-width: 0;
    gap: 10px;
  }

  .fund-report-title-block h1 {
    display: flex;
    min-width: 0;
    align-items: baseline;
    gap: 9px;
    margin: 0;
    color: var(--text-2);
    font-size: 1.5rem;
    font-weight: bolder;
    letter-spacing: -0.025em;
  }

  .title-dot {
    color: color-mix(in srgb, var(--brand) 72%, var(--muted));
  }

  .title-subject {
    color: var(--brand-deep);
  }

  .fund-report-back {
    display: grid;
    width: 44px;
    height: 44px;
    flex: 0 0 auto;
    place-items: center;
    border: 1px solid var(--line);
    border-radius: var(--radius-control);
    color: var(--brand-deep);
    background: var(--surface);
    box-shadow: var(--shadow-card);
    text-decoration: none;
    transition:
      border-color 160ms ease,
      background 160ms ease;
  }

  .fund-report-back:hover {
    border-color: var(--brand);
    background: var(--brand-soft);
  }

  .fund-report-back svg,
  .panel-icon svg,
  .report-state svg,
  .report-open svg {
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.9;
  }

  .fund-report-back svg {
    width: 20px;
  }

  main {
    width: min(100%, 1040px);
    margin-inline: auto;
    padding-top: clamp(28px, 5vw, 56px);
  }

  .report-panel {
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: var(--radius-card);
    background: var(--surface);
    box-shadow: var(--shadow-card);
  }

  .panel-heading {
    min-height: 76px;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 20px;
    border-bottom: 1px solid var(--line);
  }

  .panel-heading > div {
    min-width: 0;
    gap: 12px;
  }

  .panel-heading h2 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: bold;
  }

  .panel-icon {
    display: grid;
    width: 44px;
    height: 44px;
    flex: 0 0 auto;
    place-items: center;
    border-radius: var(--radius-control);
    color: var(--brand-deep);
    background: var(--brand-soft);
  }

  .panel-icon svg {
    width: 24px;
  }

  .report-count {
    flex: 0 0 auto;
    padding: 6px 9px;
    border-radius: var(--radius-tag);
    color: var(--brand-deep);
    background: var(--brand-soft);
    font-size: 0.875rem;
    font-weight: bold;
    font-variant-numeric: tabular-nums;
  }

  .report-list {
    display: grid;
    gap: 0;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .report-list li + li {
    border-top: 1px solid var(--line);
  }

  .report-list a {
    display: grid;
    min-height: 88px;
    grid-template-columns: minmax(180px, 1fr) minmax(250px, 1fr) auto;
    align-items: center;
    gap: 24px;
    padding: 16px 20px;
    color: var(--text-2);
    text-decoration: none;
    transition: background 160ms ease;
  }

  .report-list a:hover {
    background: color-mix(in srgb, var(--brand-soft) 48%, var(--surface));
  }

  .report-date {
    min-width: 0;
    gap: 9px;
  }

  .report-date strong {
    font-size: 1.125rem;
    font-weight: bold;
    font-variant-numeric: tabular-nums;
  }

  .report-date > span {
    padding: 4px 7px;
    border-radius: var(--radius-tag);
    color: color-mix(in srgb, var(--green) 76%, #173b31);
    background: color-mix(in srgb, var(--green) 10%, var(--surface));
    font-size: 0.75rem;
    font-weight: bold;
  }

  .report-meta {
    flex-wrap: wrap;
    gap: 6px 18px;
    color: var(--muted);
    font-size: 0.875rem;
    font-variant-numeric: tabular-nums;
  }

  .report-open {
    min-height: 44px;
    gap: 8px;
    padding: 0 13px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-control);
    color: var(--brand-deep);
    background: var(--surface);
    font-size: 0.875rem;
    font-weight: bold;
  }

  .report-open svg {
    width: 18px;
  }

  .report-state {
    display: grid;
    min-height: 240px;
    place-items: center;
    align-content: center;
    gap: 14px;
    padding: 32px;
    color: var(--muted);
    text-align: center;
  }

  .report-state svg {
    width: 40px;
  }

  .report-state strong {
    color: var(--text-2);
    font-size: 1rem;
    font-weight: bold;
  }

  .report-state a {
    min-height: 44px;
    padding: 11px 16px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-control);
    color: var(--brand-deep);
    background: var(--surface);
    font-weight: bold;
    text-decoration: none;
  }

  .report-state--error svg {
    color: var(--red);
  }

  .fund-report-back:focus-visible,
  .report-list a:focus-visible,
  .report-state a:focus-visible {
    position: relative;
    z-index: 1;
    outline: 3px solid color-mix(in srgb, var(--brand) 36%, transparent);
    outline-offset: 2px;
  }

  @media (max-width: 720px) {
    .fund-report-page {
      padding-inline: 12px;
    }

    .fund-report-title-block h1 {
      flex-wrap: wrap;
      gap: 3px 7px;
      font-size: 1.25rem;
    }

    main {
      padding-top: 24px;
    }

    .panel-heading {
      padding-inline: 16px;
    }

    .report-list a {
      min-height: 0;
      grid-template-columns: 1fr auto;
      gap: 10px 12px;
      padding: 16px;
    }

    .report-meta {
      grid-column: 1;
    }

    .report-open {
      grid-column: 2;
      grid-row: 1 / span 2;
    }
  }

  @media (max-width: 460px) {
    .title-dot,
    .fund-report-title-block h1 > span:first-child {
      display: none;
    }

    .panel-heading {
      align-items: flex-start;
    }

    .report-list a {
      grid-template-columns: 1fr;
    }

    .report-meta,
    .report-open {
      grid-column: 1;
      grid-row: auto;
    }

    .report-open {
      width: fit-content;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .fund-report-back,
    .report-list a {
      transition: none;
    }
  }
</style>
