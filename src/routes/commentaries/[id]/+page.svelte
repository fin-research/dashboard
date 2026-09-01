<script lang="ts">
  import { onMount } from "svelte";

  import ModuleCard from "../../../components/ModuleCard.svelte";
  import DetailPageShell from "$lib/policy-tracking/DetailPageShell.svelte";
  import {
    policyCategoryLabels,
    type ResearchCommentaryDetail,
  } from "$lib/policies";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  let detail = $state<ResearchCommentaryDetail | null>(null);
  let loading = $state(true);
  let errorMessage = $state("");

  onMount(() => { void loadCommentary(); });

  async function loadCommentary(): Promise<void> {
    loading = true;
    errorMessage = "";
    try {
      const response = await fetch(`/api/commentaries/${encodeURIComponent(data.id)}`);
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(readError(payload, "研究点评读取失败"));
      detail = payload as ResearchCommentaryDetail;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "研究点评读取失败";
    } finally {
      loading = false;
    }
  }

  function readError(payload: unknown, fallback: string): string {
    if (payload && typeof payload === "object" && "error" in payload) {
      const value = (payload as { error?: unknown }).error;
      if (typeof value === "string" && value) return value;
    }
    return fallback;
  }

  function formatDate(value: string): string {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date(`${value}T00:00:00+08:00`));
  }
</script>

<svelte:head>
  <title>{detail ? `${detail.commentary.eventName} · 研究点评` : "研究点评 · 资金管理部"}</title>
  <meta name="description" content="政策跟踪标准化研究点评" />
</svelte:head>

<DetailPageShell eyebrow="RESEARCH COMMENTARY" title="研究点评" backHref="/policy-tracking" backLabel="返回政策跟踪">
  {#if loading}
    <section class="page-state" aria-live="polite"><span class="spinner"></span><strong>正在读取研究点评</strong></section>
  {:else if errorMessage}
    <section class="page-state page-state--error" role="alert"><strong>{errorMessage}</strong><button type="button" onclick={loadCommentary}>重新读取</button></section>
  {:else if detail}
    <div class="commentary-layout">
      <ModuleCard class="commentary-card" labelledBy="commentary-title">
        <header class="commentary-brand"><strong>【东财证券】资金管理部 · 政策跟踪</strong><span>{detail.commentary.edited ? "人工修订" : "AI 初版"}</span></header>
        <h2 class="commentary-event-title" id="commentary-title">{detail.commentary.eventName}</h2>
        <dl>
          <div><dt>消息来源</dt><dd>{detail.commentary.sources}</dd></div>
          <div><dt>发布时间</dt><dd>{formatDate(detail.commentary.eventPublishedAt)}</dd></div>
          <div><dt>点评时间</dt><dd>{formatDate(detail.commentary.commentaryDate)}</dd></div>
        </dl>
        <div class="divider"></div>
        <section class="commentary-section" aria-labelledby="summary-title"><h3 id="summary-title">事件摘要</h3><p>{detail.commentary.eventSummary}</p></section>
        <section class="commentary-section" aria-labelledby="commentary-body-title"><h3 id="commentary-body-title">政策点评</h3><p>{detail.commentary.commentary}</p></section>
        <section class="commentary-section" aria-labelledby="recommendation-title"><h3 id="recommendation-title">应对建议</h3><p>{detail.commentary.recommendation}</p></section>
      </ModuleCard>

      <aside aria-labelledby="source-policy-title">
        <ModuleCard>
          <div class="policy-meta"><span>{policyCategoryLabels[detail.policy.category]}</span><time datetime={detail.policy.policyDate}>{detail.policy.policyDate}</time></div>
          <h2 id="source-policy-title">{detail.policy.title}</h2>
          <p>{detail.policy.summary}</p>
          <a href={`/policy-tracking#policy-${encodeURIComponent(detail.policy.id)}`}>查看对应政策</a>
        </ModuleCard>
      </aside>
    </div>
  {/if}
</DetailPageShell>

<style>
  .page-state { display: flex; min-height: 260px; align-items: center; justify-content: center; gap: 14px; border: 1px solid #d8e2f0; border-radius: 10px; background: #fff; }
  .page-state--error { flex-wrap: wrap; color: #b42318; }
  .page-state button, aside a { display: inline-flex; min-height: 44px; align-items: center; justify-content: center; padding: 0 16px; border: 1px solid #b8c6da; border-radius: 8px; color: #2f6fd6; font: inherit; font-weight: bold; background: #fff; cursor: pointer; text-decoration: none; transition: border-color 180ms ease, background 180ms ease; }
  .page-state button:hover, aside a:hover { border-color: #2f6fd6; background: #f5f9ff; }
  .page-state button:focus-visible, aside a:focus-visible { outline: 3px solid rgba(47, 111, 214, .28); outline-offset: 2px; }
  .spinner { width: 22px; height: 22px; border: 3px solid #d8e2f0; border-top-color: #2f6fd6; border-radius: 50%; animation: spin .8s linear infinite; }
  .commentary-layout { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 20px; align-items: start; }
  :global(.commentary-card) { padding: 28px 32px; }
  .commentary-brand { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; color: #2f6fd6; }
  .commentary-brand span { padding: 4px 9px; border-radius: 6px; color: #475467; font-size: .75rem; font-weight: bold; background: #eef2f7; }
  .commentary-event-title { margin: 20px 0; font-size: 1.5rem; line-height: 1.45; }
  dl { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 12px; margin: 0; }
  dl div { padding: 12px; border-radius: 8px; background: #f6f8fb; }
  dt { margin-bottom: 5px; color: #667085; font-size: .75rem; font-weight: bold; }
  dd { margin: 0; color: #344054; line-height: 1.5; }
  .divider { height: 1px; margin: 26px 0; background: #e4e7ec; }
  .commentary-section + .commentary-section { margin-top: 28px; }
  .commentary-section h3 { margin: 0 0 10px; font-size: 1.125rem; }
  .commentary-section p { max-width: 800px; margin: 0; color: #344054; line-height: 1.9; white-space: pre-wrap; }
  .policy-meta { display: flex; justify-content: space-between; gap: 10px; color: #667085; font-size: .75rem; }
  .policy-meta span { color: #2f6fd6; font-weight: bold; }
  aside h2 { margin: 14px 0 10px; font-size: 1.125rem; line-height: 1.5; }
  aside p { margin: 0; color: #667085; font-size: .875rem; line-height: 1.65; }
  aside a { width: 100%; margin-top: 18px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (max-width: 900px) { .commentary-layout { grid-template-columns: 1fr; } aside { order: -1; } }
  @media (max-width: 620px) { :global(.commentary-card) { padding: 18px 16px; } .commentary-event-title { font-size: 1.25rem; } dl { grid-template-columns: 1fr; } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } .page-state button, aside a { transition: none; } }
</style>
