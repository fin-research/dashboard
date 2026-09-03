<script lang="ts">
  import { onMount } from "svelte";

  import ModuleCard from "../../components/ModuleCard.svelte";
  import { globalMessages } from "$lib/global-messages";
  import {
    policyCategoryLabels,
    policyImportanceLabels,
    type ArticleSearchResult,
    type CommentaryContent,
    type PolicyCategory,
    type PolicyEvent,
    type PolicyTimelineResponse,
    type ResearchCommentary,
  } from "$lib/policies";

  let policies: PolicyEvent[] = [];
  let loading = true;
  let errorMessage = "";
  let startDate = offsetDate(-30);
  let endDate = offsetDate(0);
  let category: PolicyCategory | "" = "";
  let articlePolicy: PolicyEvent | null = null;
  let articleQuery = "";
  let articleResults: ArticleSearchResult[] = [];
  let selectedArticleIds = new Set<string>();
  let searchingArticles = false;
  let savingArticles = false;
  let commentaryPolicy: PolicyEvent | null = null;
  let commentaryDraft: CommentaryContent | null = null;
  let generatingPolicyId = "";
  let savingCommentary = false;

  onMount(loadPolicies);

  async function loadPolicies(): Promise<void> {
    loading = true;
    errorMessage = "";
    try {
      const query = new URLSearchParams({ startDate, endDate });
      if (category) query.set("category", category);
      const response = await fetch(`/api/policies?${query}`, {
        headers: { Accept: "application/json" },
      });
      const payload = (await response.json()) as PolicyTimelineResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "政策时间轴读取失败");
      policies = payload.policies;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      loading = false;
    }
  }

  function openArticleEditor(policy: PolicyEvent): void {
    articlePolicy = policy;
    articleQuery = "";
    articleResults = policy.articles.map((article) => ({
      id: article.id,
      title: article.title,
      author: article.author,
      summary: article.summary,
      publishedAt: article.publishedAt,
      link: article.link,
    }));
    selectedArticleIds = new Set(policy.articles.map((article) => article.id));
    void searchArticles();
  }

  async function searchArticles(): Promise<void> {
    searchingArticles = true;
    try {
      const response = await fetch(`/api/policies/articles?q=${encodeURIComponent(articleQuery)}`);
      const payload = (await response.json()) as { articles?: ArticleSearchResult[]; error?: string };
      if (!response.ok || !payload.articles) throw new Error(payload.error || "研报检索失败");
      const merged = new Map(articleResults.map((article) => [article.id, article]));
      for (const article of payload.articles) merged.set(article.id, article);
      articleResults = [...merged.values()];
    } catch (error) {
      globalMessages.error(error instanceof Error ? error.message : String(error));
    } finally {
      searchingArticles = false;
    }
  }

  function toggleArticle(articleId: string): void {
    const next = new Set(selectedArticleIds);
    if (next.has(articleId)) next.delete(articleId);
    else next.add(articleId);
    selectedArticleIds = next;
  }

  async function saveArticles(): Promise<void> {
    if (!articlePolicy) return;
    savingArticles = true;
    try {
      const response = await fetch(`/api/policies/${articlePolicy.id}/articles`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ articleIds: [...selectedArticleIds] }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "研报关联保存失败");
      articlePolicy = null;
      globalMessages.success("政策研报关联已保存");
      await loadPolicies();
    } catch (error) {
      globalMessages.error(error instanceof Error ? error.message : String(error));
    } finally {
      savingArticles = false;
    }
  }

  async function generateCommentary(policy: PolicyEvent): Promise<void> {
    if (policy.commentary && !window.confirm("重新生成将覆盖当前点评初版，是否继续？")) return;
    generatingPolicyId = policy.id;
    globalMessages.info("正在根据政策资讯和联网资料生成点评初版，关联研报（如有）也会一并参考，可能需要数分钟", {
      key: `policy-commentary-${policy.id}`,
      duration: 300_000,
    });
    try {
      const response = await fetch(`/api/policies/${policy.id}/commentary`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: "{}",
      });
      const payload = (await response.json()) as ResearchCommentary & { error?: string };
      if (!response.ok) throw new Error(payload.error || "政策点评生成失败");
      replaceCommentary(policy.id, payload);
      openCommentaryEditor({ ...policy, commentary: payload });
      globalMessages.success("政策点评初版已生成并保存", {
        key: `policy-commentary-${policy.id}`,
      });
    } catch (error) {
      globalMessages.error(error instanceof Error ? error.message : String(error), {
        key: `policy-commentary-${policy.id}`,
      });
    } finally {
      generatingPolicyId = "";
    }
  }

  function openCommentaryEditor(policy: PolicyEvent): void {
    if (!policy.commentary) return;
    commentaryPolicy = policy;
    commentaryDraft = {
      eventName: policy.commentary.eventName,
      sources: policy.commentary.sources,
      eventPublishedAt: policy.commentary.eventPublishedAt,
      commentaryDate: policy.commentary.commentaryDate,
      eventSummary: policy.commentary.eventSummary,
      commentary: policy.commentary.commentary,
      recommendation: policy.commentary.recommendation,
    };
  }

  async function saveCommentary(): Promise<void> {
    if (!commentaryPolicy || !commentaryDraft) return;
    savingCommentary = true;
    try {
      const response = await fetch(`/api/policies/${commentaryPolicy.id}/commentary`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(commentaryDraft),
      });
      const payload = (await response.json()) as ResearchCommentary & { error?: string };
      if (!response.ok) throw new Error(payload.error || "政策点评保存失败");
      replaceCommentary(commentaryPolicy.id, payload);
      commentaryPolicy = null;
      commentaryDraft = null;
      globalMessages.success("政策点评修改已保存");
    } catch (error) {
      globalMessages.error(error instanceof Error ? error.message : String(error));
    } finally {
      savingCommentary = false;
    }
  }

  function replaceCommentary(policyId: string, commentary: ResearchCommentary): void {
    policies = policies.map((policy) =>
      policy.id === policyId ? { ...policy, commentary } : policy,
    );
  }

  function formatDate(value: string): string {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(`${value}T00:00:00+08:00`));
  }

  function formatTime(value: string): string {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  }

  function offsetDate(days: number): string {
    const value = new Date();
    value.setUTCDate(value.getUTCDate() + days);
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(value);
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    if (commentaryPolicy) {
      commentaryPolicy = null;
      commentaryDraft = null;
      return;
    }
    if (articlePolicy) articlePolicy = null;
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<svelte:head>
  <title>政策跟踪 · 资金管理部</title>
  <meta name="description" content="中央政策时间轴、关联研报与标准化政策点评" />
</svelte:head>

<div class="policy-page">
  <header class="policy-header">
    <div class="header-title">
      <a href="/" aria-label="返回市场研究门户">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
      </a>
      <div><span>POLICY TRACKER</span><h1>政策跟踪</h1></div>
    </div>
    <form class="filters" onsubmit={(event) => { event.preventDefault(); void loadPolicies(); }}>
      <label><span>开始日期</span><input type="date" bind:value={startDate} /></label>
      <label><span>结束日期</span><input type="date" bind:value={endDate} /></label>
      <label><span>政策类型</span><select bind:value={category}>
        <option value="">全部</option>
        {#each Object.entries(policyCategoryLabels) as [value, label]}
          <option value={value}>{label}</option>
        {/each}
      </select></label>
      <button type="submit" disabled={loading}>{loading ? "读取中" : "查询"}</button>
    </form>
  </header>

  <main class="policy-main">
    {#if loading}
      <section class="page-state" aria-live="polite"><span class="spinner"></span><strong>正在读取政策时间轴</strong></section>
    {:else if errorMessage}
      <section class="page-state page-state--error" role="alert"><strong>{errorMessage}</strong><button type="button" onclick={loadPolicies}>重新读取</button></section>
    {:else if policies.length === 0}
      <section class="page-state"><strong>所选范围内暂无已聚合政策</strong></section>
    {:else}
      <ol class="policy-timeline" aria-label="政策时间轴">
        {#each policies as policy (policy.id)}
          <li class="policy-timeline-item">
            <div class="timeline-date"><time datetime={policy.policyDate}>{formatDate(policy.policyDate)}</time><span></span></div>
            <ModuleCard class="policy-card" labelledBy={`policy-${policy.id}`}>
              <div class="policy-card-topline">
                <div class="policy-meta">
                  <span class={`category category--${policy.category}`}>{policyCategoryLabels[policy.category]}</span>
                  {#each policy.departments as department}<span class="department">{department}</span>{/each}
                </div>
                <span
                  class={`importance-chip importance-chip--${policy.importance}`}
                  aria-label={`政策重要性：${policyImportanceLabels[policy.importance]}`}
                >{policyImportanceLabels[policy.importance]}</span>
              </div>
              <h2 class="policy-card-title" id={`policy-${policy.id}`}>{policy.title}</h2>
              <p class="policy-summary">{policy.summary}</p>

              <div class="policy-sections">
                <section>
                  <div class="section-heading"><h3>政策资讯 <span>{policy.news.length}</span></h3></div>
                  <ol class="news-list">
                    {#each policy.news as item}
                      <li><time datetime={item.publishedAt}>{formatTime(item.publishedAt)}</time>
                        <a href={`/news/${encodeURIComponent(item.id)}`}>{item.title}</a>
                      </li>
                    {/each}
                  </ol>
                </section>

                <section>
                  <div class="section-heading"><h3>关联研报 <span>{policy.articles.length}</span></h3><button type="button" onclick={() => openArticleEditor(policy)}>调整关联</button></div>
                  {#if policy.articles.length > 0}
                    <ul class="article-list">
                      {#each policy.articles as article}
                        <li>
                          <div><strong>{article.author || "未标注机构"}</strong><span>{formatDate(article.publishedAt.slice(0, 10))}</span>
                            {#if article.associationMethod === "manual"}<span class="manual-badge">人工确认</span>{/if}
                          </div>
                          <a href={`/articles/${encodeURIComponent(article.id)}`}>{article.title}</a>
                          <small>{article.summary}</small>
                        </li>
                      {/each}
                    </ul>
                  {:else}<p class="empty-text">暂无直接相关研报</p>{/if}
                </section>

                <section class="commentary-section">
                  <div class="section-heading"><div class="section-title"><h3>研究点评</h3>
                    <button
                      class="ai-generate-button"
                      class:is-loading={generatingPolicyId === policy.id}
                      type="button"
                      disabled={generatingPolicyId === policy.id}
                      aria-label={generatingPolicyId === policy.id ? "AI 生成中" : policy.commentary ? "重新生成政策点评初版" : "AI 生成点评初版"}
                      title={generatingPolicyId === policy.id ? "AI 生成中" : policy.commentary ? "重新生成政策点评初版" : "AI 生成点评初版"}
                      onclick={() => generateCommentary(policy)}
                    >
                      <svg viewBox="0 0 20 20" aria-hidden="true">
                        <path d="m10 2 1.1 4.2L15 8l-3.9 1.8L10 14l-1.1-4.2L5 8l3.9-1.8L10 2Z" />
                        <path d="m16 13 .6 2.1 1.9.9-1.9.9L16 19l-.6-2.1-1.9-.9 1.9-.9L16 13Z" />
                      </svg>
                    </button>
                  </div><div class="heading-actions">
                    {#if policy.commentary}<a class="detail-link" href={`/commentaries/${encodeURIComponent(policy.commentary.id)}`}>查看完整点评</a><button type="button" onclick={() => openCommentaryEditor(policy)}>编辑</button>{/if}
                  </div></div>
                  {#if policy.commentary}
                    <article class="commentary">
                      <div class="commentary-title"><strong>【东财证券】资金管理部 · 政策跟踪</strong><span>{policy.commentary.edited ? "人工修订" : "AI 初版"}</span></div>
                      <dl><div><dt>事件名称</dt><dd>{policy.commentary.eventName}</dd></div><div><dt>消息来源</dt><dd>{policy.commentary.sources}</dd></div><div><dt>发布时间</dt><dd>{formatDate(policy.commentary.eventPublishedAt)}</dd></div><div><dt>点评时间</dt><dd>{formatDate(policy.commentary.commentaryDate)}</dd></div></dl>
                      <h4>事件摘要</h4><p>{policy.commentary.eventSummary}</p>
                      <h4>政策点评</h4><p>{policy.commentary.commentary}</p>
                      <h4>应对建议</h4><p>{policy.commentary.recommendation}</p>
                    </article>
                  {:else}<p class="empty-text">尚未生成</p>{/if}
                </section>
              </div>
            </ModuleCard>
          </li>
        {/each}
      </ol>
    {/if}
  </main>
</div>

{#if articlePolicy}
  <div class="modal-layer" role="presentation">
    <button class="modal-scrim" type="button" aria-label="关闭研报关联" onclick={() => (articlePolicy = null)}></button>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="article-modal-title">
      <header><div><span>关联研报</span><h2 id="article-modal-title">{articlePolicy.title}</h2></div><button type="button" aria-label="关闭" onclick={() => (articlePolicy = null)}>×</button></header>
      <form class="article-search" onsubmit={(event) => { event.preventDefault(); void searchArticles(); }}><label><span>检索标题、机构或摘要</span><input bind:value={articleQuery} /></label><button type="submit" disabled={searchingArticles}>{searchingArticles ? "检索中" : "检索"}</button></form>
      <div class="modal-scroll article-options">
        {#each articleResults as article (article.id)}
          <label class:selected={selectedArticleIds.has(article.id)}><input type="checkbox" checked={selectedArticleIds.has(article.id)} onchange={() => toggleArticle(article.id)} /><span><strong>{article.title}</strong><small>{article.author || "未标注机构"} · {formatDate(article.publishedAt.slice(0, 10))}</small><p>{article.summary}</p></span></label>
        {/each}
      </div>
      <footer><span>已选择 {selectedArticleIds.size} 篇</span><button class="primary-action" type="button" disabled={savingArticles} onclick={saveArticles}>{savingArticles ? "保存中" : "保存关联"}</button></footer>
    </div>
  </div>
{/if}

{#if commentaryPolicy && commentaryDraft}
  <div class="modal-layer" role="presentation">
    <button class="modal-scrim" type="button" aria-label="关闭点评编辑" onclick={() => (commentaryPolicy = null)}></button>
    <div class="modal commentary-modal" role="dialog" aria-modal="true" aria-labelledby="commentary-modal-title">
      <header><div><span>政策跟踪</span><h2 id="commentary-modal-title">编辑研究点评</h2></div><button type="button" aria-label="关闭" onclick={() => (commentaryPolicy = null)}>×</button></header>
      <div class="modal-scroll commentary-form">
        <label><span>事件名称</span><input bind:value={commentaryDraft.eventName} /></label>
        <div class="form-grid"><label><span>消息来源</span><input bind:value={commentaryDraft.sources} /></label><label><span>发布时间</span><input type="date" bind:value={commentaryDraft.eventPublishedAt} /></label><label><span>点评时间</span><input type="date" bind:value={commentaryDraft.commentaryDate} /></label></div>
        <label><span>事件摘要</span><textarea rows="5" bind:value={commentaryDraft.eventSummary}></textarea></label>
        <label><span>政策点评</span><textarea rows="12" bind:value={commentaryDraft.commentary}></textarea></label>
        <label><span>应对建议</span><textarea rows="7" bind:value={commentaryDraft.recommendation}></textarea></label>
      </div>
      <footer><span>保存后标记为人工修订</span><button class="primary-action" type="button" disabled={savingCommentary} onclick={saveCommentary}>{savingCommentary ? "保存中" : "保存点评"}</button></footer>
    </div>
  </div>
{/if}

<style>
  :global(*) { box-sizing: border-box; }
  :global(button), :global(input), :global(select), :global(textarea) { font: inherit; }
  .policy-page { min-height: 100dvh; color: #172033; background: #f6f8fb; }
  .policy-header { position: sticky; z-index: 20; top: 0; display: flex; min-height: 82px; align-items: center; justify-content: space-between; gap: 24px; padding: 14px max(24px, calc((100vw - 1600px) / 2)); border-bottom: 1px solid #d8e2f0; background: rgba(246, 248, 251, .94); backdrop-filter: blur(14px); }
  .header-title, .filters, .filters label, .policy-meta, .section-heading, .heading-actions, .commentary-title, .modal header, .modal footer, .article-search { display: flex; align-items: center; }
  .header-title { gap: 14px; }
  .header-title > a { display: grid; width: 44px; height: 44px; place-items: center; border: 1px solid #cbd5e1; border-radius: 8px; color: #344054; background: #fff; }
  .header-title svg { width: 22px; fill: none; stroke: currentColor; stroke-width: 2; }
  .header-title span, .modal header span { color: #2f6fd6; font-size: .75rem; font-weight: bold; letter-spacing: .12em; }
  h1 { margin: 2px 0 0; font-size: 1.5rem; font-weight: bolder; }
  .filters { flex-wrap: wrap; justify-content: flex-end; gap: 10px; }
  .filters label { gap: 7px; color: #475467; font-size: .875rem; font-weight: bold; }
  input, select, textarea { border: 1px solid #cbd5e1; border-radius: 8px; color: #172033; background: #fff; }
  .filters input, .filters select { min-height: 44px; padding: 0 10px; }
  button { min-height: 44px; padding: 0 14px; border: 1px solid #cbd5e1; border-radius: 8px; color: #344054; background: #fff; cursor: pointer; font-weight: bold; transition: border-color 180ms ease, background 180ms ease, color 180ms ease; }
  button:hover:not(:disabled), button:focus-visible { border-color: #2f6fd6; color: #175cd3; background: #eef4ff; }
  button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, a:focus-visible { outline: 3px solid rgba(47, 111, 214, .25); outline-offset: 2px; }
  button:disabled { cursor: wait; opacity: .58; }
  .primary-action, .filters > button { border-color: #2f6fd6; color: #fff; background: #2f6fd6; }
  .primary-action:hover:not(:disabled), .primary-action:focus-visible, .filters > button:hover:not(:disabled) { color: #fff; background: #245cb5; }
  .policy-main { width: min(1600px, calc(100% - 48px)); margin: 0 auto; padding: 32px 0 64px; }
  .page-state { display: flex; min-height: 240px; align-items: center; justify-content: center; gap: 14px; border: 1px solid #d8e2f0; border-radius: 10px; background: #fff; }
  .page-state--error { color: #b42318; }
  .spinner { width: 24px; height: 24px; border: 3px solid #dbe8fb; border-top-color: #2f6fd6; border-radius: 50%; animation: spin 800ms linear infinite; }
  .policy-timeline { display: grid; gap: 2rem; margin: 0; padding: 0; list-style: none; }
  .policy-timeline-item { display: grid; grid-template-columns: 126px minmax(0, 1fr); gap: 2rem; }
  .timeline-date { position: relative; display: flex; align-items: center; justify-content: flex-end; text-align: right; }
  .timeline-date time { color: #344054; font-size: .875rem; font-weight: bold; font-variant-numeric: tabular-nums; }
  .timeline-date::before, .timeline-date::after { position: absolute; right: -1rem; width: 1px; background: #cbd5e1; content: ""; }
  .timeline-date::before { top: 0; bottom: 50%; }
  .timeline-date::after { top: 50%; bottom: -2rem; }
  .policy-timeline-item:first-child .timeline-date::before { display: none; }
  .policy-timeline-item:last-child .timeline-date::after { display: none; }
  .timeline-date span { position: absolute; z-index: 2; top: 50%; right: -1rem; width: 11px; height: 11px; border: 3px solid #f6f8fb; border-radius: 50%; background: #2f6fd6; box-shadow: 0 0 0 1px #2f6fd6; transform: translate(50%, -50%); }
  :global(.policy-card) { padding: 24px; }
  .policy-card-topline { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .policy-meta { flex-wrap: wrap; gap: 8px; }
  .policy-meta span, .manual-badge, .commentary-title span { padding: 4px 8px; border-radius: 6px; font-size: .75rem; font-weight: bold; }
  .category { color: #175cd3; background: #eff4ff; }
  .category--real_estate { color: #b54708; background: #fffaeb; }
  .category--fiscal { color: #027a48; background: #ecfdf3; }
  .category--capital_market { color: #6941c6; background: #f4f3ff; }
  .department { color: #475467; background: #f2f4f7; }
  .importance-chip { display: inline-flex; flex: 0 0 auto; align-items: center; padding: 5px 10px; border: 1px solid; border-radius: 6px; font-size: .875rem; font-weight: bold; line-height: 1.25; }
  .importance-chip--important { border-color: #fecdca; color: #b42318; background: #fef3f2; }
  .importance-chip--related { border-color: #b2ddff; color: #175cd3; background: #eff8ff; }
  .importance-chip--general { border-color: #d0d5dd; color: #475467; background: #f2f4f7; }
  .policy-card-title { margin: 14px 0 10px; scroll-margin-top: 100px; font-size: 1.25rem; line-height: 1.4; font-weight: bolder; }
  .policy-summary { margin: 0; color: #344054; font-size: 1rem; line-height: 1.75; }
  .policy-sections { display: grid; gap: 22px; margin-top: 24px; padding-top: 22px; border-top: 1px solid #eaecf0; }
  .section-heading { min-height: 44px; justify-content: space-between; gap: 12px; }
  .section-title { display: flex; align-items: center; gap: 8px; }
  .section-heading h3 { margin: 0; font-size: 1.125rem; font-weight: bold; }
  .section-heading h3 span { color: #667085; font-size: .875rem; }
  .section-heading button { min-height: 40px; }
  .heading-actions { flex-wrap: wrap; gap: 8px; }
  .ai-generate-button { display: inline-grid; width: 32px; min-width: 32px; min-height: 32px; place-items: center; padding: 3px; border: 1px solid #b8c6da; border-radius: 8px; color: #2f6fd6; background: #f5f9ff; cursor: pointer; }
  .section-title .ai-generate-button { min-height: 32px; }
  .ai-generate-button:hover:not(:disabled), .ai-generate-button:focus-visible { border-color: #2f6fd6; color: #175cd3; background: #eef4ff; }
  .ai-generate-button:disabled { cursor: wait; opacity: .58; }
  .ai-generate-button svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.5; }
  .ai-generate-button.is-loading svg { animation: spin 1.2s linear infinite; }
  .detail-link { display: inline-flex; min-height: 44px; align-items: center; padding: 0 12px; border: 1px solid #b8c6da; border-radius: 8px; color: #2f6fd6; font-size: .875rem; font-weight: bold; text-decoration: none; }
  .detail-link:hover { border-color: #2f6fd6; background: #f5f9ff; }
  .detail-link:focus-visible { outline: 3px solid rgba(47, 111, 214, .28); outline-offset: 2px; }
  .news-list, .article-list { display: grid; gap: 10px; margin: 10px 0 0; padding: 0; list-style: none; }
  .news-list li { display: grid; grid-template-columns: 98px minmax(0, 1fr); gap: 12px; align-items: start; padding: 10px 12px; border-radius: 8px; background: #f8fafc; }
  .news-list time, .article-list small { color: #667085; font-size: .8125rem; font-variant-numeric: tabular-nums; }
  a { color: #175cd3; text-underline-offset: 3px; }
  .article-list { grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); }
  .article-list li { min-width: 0; padding: 14px; border: 1px solid #e4e7ec; border-radius: 8px; background: #fff; }
  .article-list li > div { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin-bottom: 7px; }
  .article-list li > div > span { color: #667085; font-size: .8125rem; }
  .article-list li a { display: block; margin: 0 0 8px; font-weight: bold; line-height: 1.5; }
  .article-list li > small { display: block; line-height: 1.5; }
  .manual-badge { color: #027a48 !important; background: #ecfdf3; }
  .empty-text { margin: 10px 0 0; color: #667085; }
  .commentary { margin-top: 12px; padding: 20px; border: 1px solid #d8e2f0; border-radius: 8px; background: #fbfcfe; }
  .commentary-title { justify-content: space-between; gap: 12px; padding-bottom: 14px; border-bottom: 2px solid #344054; }
  .commentary-title span { color: #475467; background: #f2f4f7; }
  .commentary dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 18px; margin: 16px 0 20px; }
  .commentary dl div { display: grid; grid-template-columns: 80px 1fr; gap: 8px; }
  .commentary dt { color: #667085; font-weight: bold; }
  .commentary dd { margin: 0; }
  .commentary h4 { margin: 18px 0 7px; color: #175cd3; font-size: 1rem; }
  .commentary p { margin: 0; color: #344054; line-height: 1.85; white-space: pre-wrap; }
  .modal-layer { position: fixed; z-index: 100; inset: 0; display: grid; place-items: center; padding: 16px; }
  .modal-scrim { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; border-radius: 0; background: rgba(15, 23, 42, .42); backdrop-filter: blur(3px); }
  .modal { position: relative; display: grid; width: min(840px, 100%); max-height: calc(100dvh - 32px); grid-template-rows: auto auto minmax(0, 1fr) auto; overflow: hidden; border: 1px solid #cbd5e1; border-radius: 10px; background: #fff; box-shadow: 0 28px 72px rgba(15, 23, 42, .25); }
  .commentary-modal { width: min(980px, 100%); grid-template-rows: auto minmax(0, 1fr) auto; }
  .modal header, .modal footer { justify-content: space-between; gap: 14px; padding: 18px 20px; border-bottom: 1px solid #e4e7ec; }
  .modal footer { border-top: 1px solid #e4e7ec; border-bottom: 0; color: #667085; }
  .modal h2 { max-width: 720px; margin: 3px 0 0; font-size: 1.25rem; }
  .modal header > button { width: 44px; padding: 0; font-size: 1.5rem; }
  .article-search { gap: 10px; padding: 14px 20px; border-bottom: 1px solid #e4e7ec; }
  .article-search label { flex: 1; }
  .article-search label span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }
  .article-search input { width: 100%; min-height: 44px; padding: 0 12px; }
  .modal-scroll { min-height: 0; overflow-y: auto; }
  .article-options { display: grid; gap: 10px; padding: 18px 20px; }
  .article-options > label { display: grid; grid-template-columns: 24px 1fr; gap: 12px; padding: 14px; border: 1px solid #e4e7ec; border-radius: 8px; cursor: pointer; }
  .article-options > label.selected { border-color: #2f6fd6; background: #f5f9ff; }
  .article-options input { width: 20px; height: 20px; accent-color: #2f6fd6; }
  .article-options strong, .article-options small { display: block; }
  .article-options small { margin-top: 5px; color: #667085; }
  .article-options p { margin: 8px 0 0; color: #475467; font-size: .875rem; line-height: 1.5; }
  .commentary-form { display: grid; gap: 16px; padding: 20px; }
  .commentary-form label { display: grid; gap: 7px; font-weight: bold; }
  .commentary-form input, .commentary-form textarea { width: 100%; min-height: 44px; padding: 10px 12px; resize: vertical; line-height: 1.6; }
  .form-grid { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 12px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (max-width: 900px) {
    .policy-header { position: static; align-items: flex-start; flex-direction: column; }
    .filters { width: 100%; justify-content: flex-start; }
    .policy-timeline-item { grid-template-columns: 1fr; gap: 8px; }
    .timeline-date { justify-content: flex-start; text-align: left; }
    .timeline-date::before, .timeline-date::after, .timeline-date span { display: none; }
    .commentary dl, .form-grid { grid-template-columns: 1fr; }
  }
  @media (max-width: 620px) {
    .policy-main { width: min(100% - 28px, 1600px); padding-top: 20px; }
    .filters label { width: 100%; justify-content: space-between; }
    .filters input, .filters select { flex: 1; }
    .filters > button { width: 100%; }
    :global(.policy-card) { padding: 16px; }
    .section-heading { align-items: flex-start; flex-direction: column; }
    .news-list li { grid-template-columns: 1fr; gap: 4px; }
    .commentary { padding: 14px; }
    .commentary dl div { grid-template-columns: 1fr; gap: 2px; }
  }
  @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } button { transition: none; } }
</style>
