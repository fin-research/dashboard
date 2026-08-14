<script lang="ts">
  import { onDestroy, onMount } from "svelte";

  import WordCloud from "$lib/components/WordCloud.svelte";
  import type { Hotspot, HotspotApiResponse } from "$lib/hotspots";

  let scopeMode: "rolling" | "range" = "rolling";
  let rollingCount = 20;
  let startDate = offsetShanghaiDate(-7);
  let endDate = shanghaiDate(new Date());
  let appliedScope:
    | { mode: "rolling"; rollingCount: number }
    | { mode: "range"; startDate: string; endDate: string } = {
    mode: "rolling",
    rollingCount: 20,
  };
  let data: HotspotApiResponse | null = null;
  let selected: Hotspot | null = null;
  let loading = true;
  let regenerating = false;
  let errorMessage = "";
  let request: AbortController | null = null;
  let configurationOpen = false;

  $: scopeLabel =
    appliedScope.mode === "rolling"
      ? `最近 ${appliedScope.rollingCount} 篇`
      : `${appliedScope.startDate} 至 ${appliedScope.endDate}`;

  onMount(() => loadHotspots(false));
  onDestroy(() => request?.abort());

  async function loadHotspots(refresh: boolean): Promise<void> {
    request?.abort();
    request = new AbortController();
    loading = !data || !refresh;
    regenerating = refresh;
    errorMessage = "";
    try {
      const query = new URLSearchParams({ mode: appliedScope.mode });
      if (appliedScope.mode === "rolling") {
        query.set("count", String(appliedScope.rollingCount));
      } else {
        query.set("startDate", appliedScope.startDate);
        query.set("endDate", appliedScope.endDate);
      }
      if (refresh) query.set("refresh", "1");
      const response = await fetch(`/api/rag/hotspots?${query}`, {
        signal: request.signal,
        headers: { Accept: "application/json" },
      });
      const payload = (await response.json()) as HotspotApiResponse & {
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "热点生成失败");
      data = payload;
      selected = null;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        errorMessage = error instanceof Error ? error.message : String(error);
      }
    } finally {
      loading = false;
      regenerating = false;
    }
  }

  function selectHotspot(hotspot: Hotspot): void {
    selected = hotspot;
  }

  function applyConfiguration(): void {
    if (scopeMode === "rolling") {
      rollingCount = Math.min(100, Math.max(8, Math.round(rollingCount || 20)));
      appliedScope = { mode: "rolling", rollingCount };
    } else {
      if (!startDate || !endDate || startDate > endDate) {
        errorMessage = "开始日期不能晚于结束日期";
        return;
      }
      appliedScope = { mode: "range", startDate, endDate };
    }
    configurationOpen = false;
    data = null;
    selected = null;
    void loadHotspots(false);
  }

  function closeConfiguration(): void {
    configurationOpen = false;
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    if (configurationOpen) closeConfiguration();
    if (selected) closeDetails();
  }

  function closeDetails(): void {
    selected = null;
  }

  function formatGeneratedAt(value: string): string {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(value));
  }

  function shanghaiDate(value: Date): string {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(value);
  }

  function offsetShanghaiDate(days: number): string {
    const value = new Date();
    value.setUTCDate(value.getUTCDate() + days);
    return shanghaiDate(value);
  }

  function confidenceLabel(confidence: Hotspot["confidence"]): string {
    return { high: "高置信", medium: "中置信", low: "低置信" }[confidence];
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<svelte:head>
  <title>市场热点图谱 · 资金管理部</title>
  <meta
    name="description"
    content="基于可配置研报证据范围生成的市场热点交互词云"
  />
  <meta name="theme-color" content="#071426" />
</svelte:head>

<div class="hotspot-page">
  <header class="hotspot-header">
    <div class="brand-block">
      <a class="back-link" href="/dashboard" aria-label="返回市场点评">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m15 18-6-6 6-6" />
        </svg>
      </a>
      <div>
        <div class="eyebrow">
          <span class="live-dot" aria-hidden="true"></span>
          AI RESEARCH SIGNALS
        </div>
        <h1>市场热点图谱</h1>
      </div>
    </div>

    <div class="header-controls" aria-label="热点控制">
      <div class="scope-control">
        <button
          class="scope-button"
          type="button"
          aria-expanded={configurationOpen}
          aria-controls="hotspot-scope-panel"
          onclick={() => (configurationOpen = !configurationOpen)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M7 14v6" />
          </svg>
          <span><small>证据范围</small>{scopeLabel}</span>
        </button>
        {#if configurationOpen}
          <button
            class="configuration-scrim"
            type="button"
            aria-label="关闭证据范围配置"
            onclick={closeConfiguration}
          ></button>
          <div
            id="hotspot-scope-panel"
            class="scope-panel"
            role="dialog"
            aria-label="配置热点证据范围"
          >
            <div class="scope-panel__header">
              <div>
                <span>EVIDENCE WINDOW</span>
                <h2>配置证据范围</h2>
              </div>
              <button type="button" aria-label="关闭配置" onclick={closeConfiguration}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <div class="scope-tabs" role="tablist" aria-label="范围模式">
              <button
                class:active={scopeMode === "rolling"}
                type="button"
                role="tab"
                aria-selected={scopeMode === "rolling"}
                onclick={() => (scopeMode = "rolling")}
              >滚动篇数</button>
              <button
                class:active={scopeMode === "range"}
                type="button"
                role="tab"
                aria-selected={scopeMode === "range"}
                onclick={() => (scopeMode = "range")}
              >日期范围</button>
            </div>
            {#if scopeMode === "rolling"}
              <label class="scope-field">
                <span>最近文章数</span>
                <div class="number-field">
                  <input
                    type="number"
                    min="8"
                    max="100"
                    step="1"
                    bind:value={rollingCount}
                  />
                  <span>篇</span>
                </div>
                <small>按发布时间倒序，默认取最近 20 篇已完成特征抽取的文章。</small>
              </label>
            {:else}
              <div class="range-fields">
                <label class="scope-field">
                  <span>开始日期</span>
                  <input type="date" bind:value={startDate} />
                </label>
                <label class="scope-field">
                  <span>结束日期</span>
                  <input type="date" bind:value={endDate} />
                </label>
                <small>日期范围最多读取最近 100 篇文章。</small>
              </div>
            {/if}
            <button class="apply-scope-button" type="button" onclick={applyConfiguration}>
              应用并生成热点
            </button>
          </div>
        {/if}
      </div>
      <button
        class="regenerate-button"
        type="button"
        disabled={loading || regenerating}
        onclick={() => loadHotspots(true)}
      >
        <svg class:spinning={regenerating} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 11a8 8 0 1 0-2.3 5.7" />
          <path d="M20 4v7h-7" />
        </svg>
        <span>{regenerating ? "AI 聚合中" : "重新生成"}</span>
      </button>
    </div>
  </header>

  <main class="hotspot-stage">
    {#if loading}
      <section class="state-card loading-card" aria-live="polite">
        <span class="loading-ring" aria-hidden="true"></span>
        <div>
          <strong>正在读取所选范围的研报证据</strong>
          <p>汇总摘要、关键词与跨资产传导关系。</p>
        </div>
      </section>
    {:else if errorMessage}
      <section class="state-card error-card" role="alert">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 9v4m0 4h.01" />
          <path d="M10.3 3.7 2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z" />
        </svg>
        <div>
          <strong>热点暂时无法生成</strong>
          <p>{errorMessage}</p>
        </div>
        <button type="button" onclick={() => loadHotspots(false)}>重新读取</button>
      </section>
    {:else if data}
      <section class="cloud-panel" aria-labelledby="cloud-heading">
        <div class="market-summary">
          <div class="summary-heading">
            <span>MARKET PULSE</span>
            <h2 id="cloud-heading">{data.marketSummary}</h2>
          </div>
          <div class="summary-meta">
            <span>{data.coverage.articleCount} 篇证据</span>
            <span>{data.hotspots.length} 个热点</span>
            <span>{formatGeneratedAt(data.generatedAt)} 生成</span>
            {#if data.cached}<span class="cache-tag">已缓存</span>{/if}
          </div>
        </div>

        <div class="cloud-canvas">
          <WordCloud
            items={data.hotspots}
            selectedKeyword={selected?.keyword ?? ""}
            onSelect={selectHotspot}
          />
        </div>
      </section>

      {#if selected}
        <button
          class="detail-scrim"
          type="button"
          aria-label="关闭热点详情"
          onclick={closeDetails}
        ></button>
        <div
          class="detail-panel"
          role="dialog"
          aria-modal="true"
          aria-label={`${selected.keyword}热点详情`}
        >
          <div class="detail-header">
            <div>
              <span class={`confidence confidence--${selected.confidence}`}>
                {confidenceLabel(selected.confidence)}
              </span>
              <span class="source-label">{selected.sourceLabel}</span>
              <p>热点强度 <strong>{selected.heat}</strong></p>
            </div>
            <button type="button" aria-label="关闭热点详情" onclick={closeDetails}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          </div>

          <div class="detail-scroll">
            <h2>{selected.keyword}</h2>
            {#if selected.aliases.length > 0}
              <div class="aliases" aria-label="同义表达">
                {#each selected.aliases as alias}<span>{alias}</span>{/each}
              </div>
            {/if}
            <p class="explanation">{selected.explanation}</p>

            <section class="detail-section">
              <h3>资产传导</h3>
              <dl class="impact-grid">
                <div><dt>固收</dt><dd>{selected.assetImpacts.fixedIncome}</dd></div>
                <div><dt>权益</dt><dd>{selected.assetImpacts.equities}</dd></div>
              </dl>
            </section>

            {#if selected.conflicts.length > 0}
              <section class="detail-section conflict-section">
                <h3>证据冲突</h3>
                <ul class="conflict-list">
                  {#each selected.conflicts as conflict}<li>{conflict}</li>{/each}
                </ul>
              </section>
            {/if}

            <section class="detail-section">
              <h3>核心驱动</h3>
              <ul class="driver-list">
                {#each selected.drivers as driver}<li>{driver}</li>{/each}
              </ul>
            </section>

            <section class="detail-section">
              <h3>证据索引 <span>{selected.evidence.length}</span></h3>
              <ol class="evidence-list">
                {#each selected.evidence as evidence}
                  <li>
                    <span>{evidence.articleId}</span>
                    <p>{evidence.evidence}</p>
                  </li>
                {/each}
              </ol>
            </section>
          </div>
        </div>
      {/if}
    {/if}
  </main>
</div>

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(html) {
    min-width: 0;
    min-height: 100%;
    background: #071426;
    color-scheme: dark;
  }

  :global(body) {
    min-width: 0;
    min-height: 100%;
    margin: 0;
    overflow: hidden;
    background: #071426;
    font-family:
      "PingFang SC", "Microsoft YaHei", ui-sans-serif, system-ui, sans-serif;
  }

  :global(button),
  :global(input) {
    font: inherit;
  }

  .hotspot-page {
    --ink: #f5f8fc;
    --muted: #91a6c5;
    --line: rgba(151, 177, 214, 0.2);
    --surface: rgba(11, 31, 56, 0.82);
    position: relative;
    width: 100vw;
    height: 100dvh;
    min-height: 600px;
    overflow: hidden;
    color: var(--ink);
    background:
      radial-gradient(circle at 26% 18%, rgba(30, 104, 176, 0.21), transparent 31%),
      radial-gradient(circle at 76% 64%, rgba(17, 121, 111, 0.15), transparent 34%),
      linear-gradient(135deg, #061222 0%, #091a2f 52%, #071426 100%);
  }

  .hotspot-page::before {
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(rgba(126, 157, 198, 0.055) 1px, transparent 1px),
      linear-gradient(90deg, rgba(126, 157, 198, 0.055) 1px, transparent 1px);
    background-size: 48px 48px;
    mask-image: linear-gradient(to bottom, black, transparent 88%);
    content: "";
    pointer-events: none;
  }

  .hotspot-header {
    position: relative;
    z-index: 20;
    display: flex;
    height: 82px;
    align-items: center;
    justify-content: space-between;
    padding: 0 30px;
    border-bottom: 1px solid var(--line);
    background: rgba(5, 17, 32, 0.72);
    backdrop-filter: blur(18px);
  }

  .brand-block,
  .header-controls,
  .eyebrow,
  .scope-button,
  .regenerate-button,
  .summary-meta,
  .detail-header,
  .aliases {
    display: flex;
    align-items: center;
  }

  .brand-block {
    gap: 14px;
  }

  .back-link,
  .detail-header button {
    display: grid;
    width: 44px;
    height: 44px;
    padding: 0;
    place-items: center;
    border: 1px solid var(--line);
    border-radius: 10px;
    color: #bed2ee;
    background: rgba(255, 255, 255, 0.035);
    cursor: pointer;
    transition:
      border-color 180ms ease,
      background 180ms ease,
      color 180ms ease;
  }

  .back-link:hover,
  .back-link:focus-visible,
  .detail-header button:hover,
  .detail-header button:focus-visible {
    border-color: rgba(119, 189, 251, 0.7);
    color: #ffffff;
    background: rgba(119, 189, 251, 0.12);
    outline: none;
  }

  .back-link svg,
  .detail-header svg,
  .scope-button svg,
  .scope-panel__header svg,
  .regenerate-button svg,
  .error-card svg {
    width: 22px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.8;
  }

  .eyebrow {
    gap: 7px;
    margin-bottom: 3px;
    color: #83a2ca;
    font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
    font-size: 0.68rem;
    font-weight: 650;
    letter-spacing: 0.16em;
  }

  .live-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #6ed6bd;
    box-shadow: 0 0 0 5px rgba(110, 214, 189, 0.09);
  }

  h1,
  h2,
  h3,
  p {
    margin: 0;
  }

  h1 {
    font-size: 1.28rem;
    font-weight: 720;
    letter-spacing: 0.03em;
  }

  .header-controls {
    gap: 10px;
  }

  .scope-control {
    position: relative;
  }

  .scope-button {
    min-height: 44px;
    gap: 9px;
    padding: 0 13px;
    border: 1px solid var(--line);
    border-radius: 10px;
    color: #d9e7f7;
    background: rgba(255, 255, 255, 0.035);
    cursor: pointer;
    text-align: left;
    transition:
      border-color 180ms ease,
      background 180ms ease;
  }

  .scope-button:hover,
  .scope-button:focus-visible,
  .scope-button[aria-expanded="true"] {
    border-color: rgba(119, 189, 251, 0.72);
    background: rgba(119, 189, 251, 0.1);
    outline: none;
  }

  .scope-button > span {
    display: grid;
    gap: 1px;
    font-size: 0.78rem;
    font-weight: 680;
    white-space: nowrap;
  }

  .scope-button small {
    color: #7893b5;
    font-size: 0.6rem;
    font-weight: 650;
    letter-spacing: 0.08em;
  }

  .configuration-scrim {
    position: fixed;
    z-index: 28;
    inset: 0;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: default;
  }

  .scope-panel {
    position: absolute;
    z-index: 30;
    top: calc(100% + 12px);
    right: 0;
    width: 370px;
    padding: 18px;
    border: 1px solid rgba(139, 177, 222, 0.32);
    border-radius: 14px;
    background: rgba(8, 27, 50, 0.98);
    box-shadow: 0 24px 70px rgba(0, 0, 0, 0.42);
    backdrop-filter: blur(24px);
  }

  .scope-panel__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
  }

  .scope-panel__header span {
    color: #7898be;
    font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.14em;
  }

  .scope-panel__header h2 {
    margin-top: 3px;
    font-size: 1.05rem;
  }

  .scope-panel__header button {
    display: grid;
    width: 36px;
    height: 36px;
    padding: 0;
    place-items: center;
    border: 1px solid var(--line);
    border-radius: 8px;
    color: #9db2ce;
    background: transparent;
    cursor: pointer;
  }

  .scope-tabs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    margin-top: 18px;
    padding: 4px;
    border: 1px solid var(--line);
    border-radius: 9px;
    background: rgba(2, 13, 26, 0.55);
  }

  .scope-tabs button {
    min-height: 38px;
    border: 0;
    border-radius: 6px;
    color: #8198b7;
    background: transparent;
    cursor: pointer;
    font-size: 0.78rem;
    font-weight: 700;
  }

  .scope-tabs button.active {
    color: #eaf4ff;
    background: rgba(119, 189, 251, 0.14);
    box-shadow: inset 0 0 0 1px rgba(119, 189, 251, 0.18);
  }

  .scope-field,
  .range-fields {
    display: grid;
  }

  .scope-field {
    gap: 7px;
    margin-top: 16px;
    color: #a7bbd3;
    font-size: 0.76rem;
    font-weight: 680;
  }

  .scope-field input {
    width: 100%;
    min-height: 42px;
    padding: 0 11px;
    border: 1px solid var(--line);
    border-radius: 8px;
    color: #eef6ff;
    background: rgba(255, 255, 255, 0.035);
    font-variant-numeric: tabular-nums;
    outline: none;
  }

  .scope-field input:focus {
    border-color: rgba(119, 189, 251, 0.75);
    box-shadow: 0 0 0 3px rgba(119, 189, 251, 0.1);
  }

  .scope-field small,
  .range-fields > small {
    color: #7189a8;
    font-size: 0.68rem;
    font-weight: 450;
    line-height: 1.55;
  }

  .number-field {
    position: relative;
  }

  .number-field input {
    padding-right: 42px;
  }

  .number-field > span {
    position: absolute;
    top: 50%;
    right: 13px;
    color: #7189a8;
    transform: translateY(-50%);
  }

  .range-fields {
    grid-template-columns: 1fr 1fr;
    gap: 0 10px;
  }

  .range-fields > small {
    grid-column: 1 / -1;
    margin-top: 8px;
  }

  .apply-scope-button {
    width: 100%;
    min-height: 44px;
    margin-top: 18px;
    border: 1px solid rgba(246, 201, 107, 0.48);
    border-radius: 9px;
    color: #ffe4ab;
    background: rgba(246, 201, 107, 0.11);
    cursor: pointer;
    font-size: 0.82rem;
    font-weight: 720;
  }

  .apply-scope-button:hover,
  .apply-scope-button:focus-visible {
    border-color: #f6c96b;
    background: rgba(246, 201, 107, 0.18);
    outline: none;
  }

  .regenerate-button {
    min-height: 44px;
    gap: 8px;
    padding: 0 16px;
    border: 1px solid rgba(246, 201, 107, 0.42);
    border-radius: 10px;
    color: #ffe2a8;
    background: rgba(246, 201, 107, 0.09);
    cursor: pointer;
    font-size: 0.82rem;
    font-weight: 700;
    transition:
      border-color 180ms ease,
      background 180ms ease;
  }

  .regenerate-button:hover:not(:disabled),
  .regenerate-button:focus-visible {
    border-color: #f6c96b;
    background: rgba(246, 201, 107, 0.16);
    outline: none;
  }

  .regenerate-button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .regenerate-button .spinning {
    animation: spin 900ms linear infinite;
  }

  .hotspot-stage {
    position: relative;
    z-index: 2;
    height: calc(100dvh - 82px);
    min-height: 518px;
    overflow: hidden;
  }

  .cloud-panel,
  .cloud-canvas {
    width: 100%;
    height: 100%;
  }

  .market-summary {
    position: absolute;
    z-index: 4;
    top: 20px;
    right: 24px;
    left: 24px;
    display: flex;
    min-height: 78px;
    align-items: flex-start;
    justify-content: space-between;
    gap: 28px;
    padding: 14px 18px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: rgba(6, 21, 40, 0.7);
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.16);
    backdrop-filter: blur(14px);
  }

  .summary-heading {
    display: grid;
    min-width: 0;
    flex: 1 1 auto;
    grid-template-columns: 92px minmax(0, 1fr);
    align-items: center;
    gap: 14px;
    margin-right: 18px;
  }

  .summary-heading > span {
    color: #f6c96b;
    font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
    font-size: 0.66rem;
    font-weight: 750;
    letter-spacing: 0.12em;
  }

  .summary-heading h2 {
    color: #dce8f7;
    font-size: 0.88rem;
    font-weight: 480;
    line-height: 1.65;
  }

  .summary-meta {
    flex: 0 0 auto;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 5px 12px;
    color: #8da5c5;
    font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
    font-size: 0.68rem;
    line-height: 1.5;
  }

  .cache-tag {
    padding: 1px 6px;
    border: 1px solid rgba(110, 214, 189, 0.27);
    border-radius: 4px;
    color: #8ad9ca;
  }

  .cloud-canvas {
    padding: 102px 22px 22px;
  }

  .detail-scrim {
    position: absolute;
    z-index: 10;
    inset: 0;
    display: block;
    padding: 0;
    border: 0;
    background: rgba(0, 8, 18, 0.3);
    cursor: pointer;
  }

  .detail-panel {
    position: absolute;
    z-index: 12;
    top: 16px;
    right: 16px;
    bottom: 16px;
    width: min(410px, calc(100vw - 32px));
    overflow: hidden;
    border: 1px solid rgba(141, 177, 222, 0.3);
    border-radius: 14px;
    background: rgba(8, 27, 50, 0.96);
    box-shadow: -18px 0 60px rgba(0, 0, 0, 0.34);
    backdrop-filter: blur(24px);
    animation: detail-in 220ms ease-out;
  }

  .detail-header {
    min-height: 72px;
    justify-content: space-between;
    padding: 13px 16px;
    border-bottom: 1px solid var(--line);
  }

  .detail-header > div {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .detail-header p {
    color: var(--muted);
    font-size: 0.78rem;
  }

  .detail-header p strong {
    margin-left: 4px;
    color: #f6c96b;
    font-size: 1rem;
  }

  .confidence {
    padding: 4px 8px;
    border-radius: 5px;
    font-size: 0.7rem;
    font-weight: 720;
  }

  .source-label {
    padding: 4px 8px;
    border: 1px solid rgba(151, 177, 214, 0.2);
    border-radius: 5px;
    color: #9fb2ca;
    font-size: 0.7rem;
    font-weight: 680;
  }

  .confidence--high {
    color: #9de3d3;
    background: rgba(78, 188, 163, 0.13);
  }

  .confidence--medium {
    color: #b7d9fb;
    background: rgba(74, 146, 215, 0.14);
  }

  .confidence--low {
    color: #d2bddf;
    background: rgba(153, 103, 181, 0.14);
  }

  .detail-scroll {
    height: calc(100% - 72px);
    padding: 22px 20px 32px;
    overflow-y: auto;
    scrollbar-color: #365271 transparent;
    scrollbar-width: thin;
  }

  .detail-scroll > h2 {
    color: #ffffff;
    font-size: clamp(1.7rem, 2.6vw, 2.35rem);
    font-weight: 760;
    line-height: 1.2;
    letter-spacing: -0.02em;
  }

  .aliases {
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
  }

  .aliases span {
    padding: 3px 7px;
    border: 1px solid rgba(119, 189, 251, 0.2);
    border-radius: 5px;
    color: #9ebfe3;
    font-size: 0.7rem;
  }

  .explanation {
    margin-top: 20px;
    color: #d1deed;
    font-size: 0.92rem;
    line-height: 1.82;
  }

  .detail-section {
    margin-top: 26px;
    padding-top: 18px;
    border-top: 1px solid var(--line);
  }

  .detail-section h3 {
    margin-bottom: 12px;
    color: #88a5c8;
    font-size: 0.72rem;
    font-weight: 740;
    letter-spacing: 0.13em;
  }

  .detail-section h3 span {
    margin-left: 4px;
    color: #f6c96b;
  }

  .impact-grid {
    display: grid;
    gap: 9px;
    margin: 0;
  }

  .impact-grid div {
    display: grid;
    grid-template-columns: 66px 1fr;
    gap: 10px;
    padding: 10px 11px;
    border: 1px solid rgba(139, 169, 207, 0.13);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.025);
  }

  .impact-grid dt {
    color: #7fb9ed;
    font-size: 0.74rem;
    font-weight: 700;
  }

  .impact-grid dd {
    margin: 0;
    color: #bfcfe2;
    font-size: 0.78rem;
    line-height: 1.65;
  }

  .driver-list,
  .conflict-list,
  .evidence-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .driver-list {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
  }

  .driver-list li {
    padding: 6px 9px;
    border-radius: 6px;
    color: #f1d597;
    background: rgba(246, 201, 107, 0.08);
    font-size: 0.74rem;
  }

  .conflict-list {
    display: grid;
    gap: 8px;
  }

  .conflict-list li {
    padding: 9px 11px;
    border-left: 2px solid rgba(242, 164, 157, 0.7);
    color: #d9c6c6;
    background: rgba(242, 164, 157, 0.055);
    font-size: 0.77rem;
    line-height: 1.65;
  }

  .evidence-list {
    display: grid;
    gap: 10px;
  }

  .evidence-list li {
    display: grid;
    grid-template-columns: max-content 1fr;
    align-items: start;
    gap: 10px;
    padding: 11px 12px;
    border-left: 1px solid rgba(119, 189, 251, 0.3);
    background: rgba(255, 255, 255, 0.02);
  }

  .evidence-list span {
    padding-top: 1px;
    color: #6fa5d8;
    font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
    font-size: 0.66rem;
    line-height: 1.6;
    white-space: nowrap;
  }

  .evidence-list p {
    min-width: 0;
    color: #b7c7da;
    font-size: 0.77rem;
    line-height: 1.65;
  }

  .state-card {
    position: absolute;
    top: 50%;
    left: 50%;
    display: flex;
    width: min(480px, calc(100vw - 32px));
    min-height: 130px;
    align-items: center;
    gap: 18px;
    padding: 24px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--surface);
    box-shadow: 0 28px 80px rgba(0, 0, 0, 0.27);
    transform: translate(-50%, -50%);
  }

  .state-card strong {
    font-size: 1rem;
  }

  .state-card p {
    margin-top: 7px;
    color: var(--muted);
    font-size: 0.82rem;
    line-height: 1.5;
  }

  .loading-ring {
    width: 38px;
    height: 38px;
    flex: 0 0 auto;
    border: 2px solid rgba(119, 189, 251, 0.2);
    border-top-color: #77bdfb;
    border-radius: 50%;
    animation: spin 900ms linear infinite;
  }

  .error-card {
    flex-wrap: wrap;
  }

  .error-card > svg {
    width: 32px;
    color: #f2a49d;
  }

  .error-card > div {
    flex: 1;
  }

  .error-card button {
    min-height: 40px;
    padding: 0 13px;
    border: 1px solid rgba(119, 189, 251, 0.35);
    border-radius: 8px;
    color: #cfe5fa;
    background: rgba(119, 189, 251, 0.08);
    cursor: pointer;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes detail-in {
    from {
      opacity: 0;
      transform: translateX(18px);
    }
  }

  @media (max-width: 860px) {
    .hotspot-page {
      min-height: 520px;
    }

    .hotspot-header {
      height: auto;
      min-height: 76px;
      padding: 10px 14px;
    }

    .eyebrow,
    .scope-button small {
      display: none;
    }

    h1 {
      font-size: 1.05rem;
    }

    .brand-block {
      gap: 9px;
    }

    .scope-button {
      padding: 0 9px;
    }

    .scope-button > span {
      font-size: 0.7rem;
    }

    .scope-panel {
      position: fixed;
      top: 70px;
      right: 8px;
      width: min(370px, calc(100vw - 16px));
    }

    .regenerate-button {
      width: 44px;
      padding: 0;
      justify-content: center;
    }

    .regenerate-button span {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
    }

    .hotspot-stage {
      height: calc(100dvh - 76px);
      min-height: 444px;
    }

    .market-summary {
      top: 10px;
      right: 10px;
      left: 10px;
      display: block;
      max-height: 116px;
      padding: 11px 12px;
      overflow: hidden;
    }

    .summary-heading {
      display: block;
    }

    .summary-heading > span {
      display: none;
    }

    .summary-heading h2 {
      display: -webkit-box;
      overflow: hidden;
      font-size: 0.76rem;
      line-height: 1.55;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 3;
      line-clamp: 3;
    }

    .summary-meta {
      justify-content: flex-start;
      margin-top: 7px;
      font-size: 0.62rem;
    }

    .summary-meta span:nth-child(3) {
      display: none;
    }

    .cloud-canvas {
      padding: 122px 7px 12px;
    }

    .detail-scrim {
      background: rgba(0, 8, 18, 0.58);
    }

    .detail-panel {
      top: auto;
      right: 8px;
      bottom: 8px;
      left: 8px;
      width: auto;
      max-height: min(74dvh, 660px);
      animation: detail-up 220ms ease-out;
    }

    .detail-scroll {
      max-height: calc(min(74dvh, 660px) - 72px);
    }
  }

  @media (max-width: 520px) {
    .hotspot-header {
      gap: 8px;
    }

    .back-link {
      width: 40px;
      height: 40px;
    }

    .header-controls {
      gap: 6px;
    }

    .impact-grid div {
      grid-template-columns: 58px 1fr;
    }
  }

  @keyframes detail-up {
    from {
      opacity: 0;
      transform: translateY(18px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .regenerate-button .spinning,
    .loading-ring {
      animation-duration: 1.8s;
    }

    .detail-panel,
    .back-link,
    .scope-button,
    .scope-panel,
    .regenerate-button {
      transition: none;
      animation: none;
    }
  }
</style>
