<script lang="ts">
  import { onMount } from "svelte";
  import ModuleCard from "../../components/ModuleCard.svelte";
  import PanelHeading from "../trading-research/PanelHeading.svelte";
  import { globalMessages } from "../global-messages";
  import { customerAnswerText, type CreditAnswer, type CreditSession } from "./types";

  type Material = { id: string; title: string; authority: string; url: string; ocrCount: number };
  let session = $state<CreditSession>({ turns: [], running: false, progress: "", error: null, startedAt: 0 });
  let question = $state("");
  let pendingQuestion = $state("");
  let materials = $state<Material[]>([]);
  let materialFilter = $state("");
  let loading = $state(true);
  let loadError = $state("");
  let sending = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let mounted = false;
  const filteredMaterials = $derived(materials.filter(m => m.title.includes(materialFilter.trim())));
  const statusNames = { complete: "答复", partial: "答复与待确认事项", insufficient: "尚需补充材料" };
  const authorityNames: Record<string, string> = { audited: "审计报告", disclosure: "正式披露", internal: "业务材料", historical_reply: "历史答复", draft: "待部门确认" };
  const examples = ["请提供2025年度审计报告。", "2025年合并现金流量表中吸收投资收到的现金是多少？主要由谁出资？", "2025年取得借款收到的现金50亿元，主要用途和借款来源是什么？"];

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`/api/credit-assistant/${path}`, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "请求未完成，请重试");
    return data as T;
  }
  function schedulePoll() {
    clearTimeout(timer);
    if (mounted && session.running) timer = setTimeout(() => void refresh(), 2500);
  }
  async function refresh() {
    try {
      session = await api<CreditSession>("session");
      loadError = "";
      if (!session.running) pendingQuestion = "";
    } catch (error) {
      loadError = error instanceof Error ? error.message : "读取问答记录失败";
    } finally { loading = false; schedulePoll(); }
  }
  async function send(event: SubmitEvent) {
    event.preventDefault();
    if (!question.trim() || sending || session.running) return;
    sending = true;
    try {
      session = await api<CreditSession>("session", { method: "POST", body: JSON.stringify({ question: question.trim() }) });
      pendingQuestion = question.trim(); question = ""; schedulePoll();
    } catch (error) { globalMessages.error(error instanceof Error ? error.message : "发送失败"); }
    finally { sending = false; }
  }
  async function newSession() {
    try { session = await api<CreditSession>("session/new", { method: "POST" }); pendingQuestion = ""; question = ""; }
    catch (error) { globalMessages.error(error instanceof Error ? error.message : "新建会话失败"); }
  }
  async function copy(answer: CreditAnswer) {
    try { await navigator.clipboard.writeText(customerAnswerText(answer)); globalMessages.success("已复制答复和资料来源"); }
    catch { globalMessages.error("复制失败，请选择答复文字手动复制"); }
  }
  function citations(answer: CreditAnswer): string[] { return [...new Set(answer.paragraphs.flatMap(p => p.citations.map(c => c.sourceId)))]; }
  onMount(() => {
    mounted = true;
    void refresh();
    void api<{ documents: Material[] }>("materials").then(data => materials = data.documents).catch(() => {});
    return () => { mounted = false; clearTimeout(timer); };
  });
</script>

<div class="credit-assistant">
  <div class="conversation">
    <ModuleCard>
      <div class="conversation-header">
        <PanelHeading id="credit-qa-heading" title="授信问答" />
        <button class="btn btn-sm" type="button" disabled={session.running || sending} onclick={() => void newSession()}>新建会话</button>
      </div>
      {#if loading}
        <p role="status">正在读取问答记录…</p>
      {:else if loadError}
        <p role="alert">{loadError} <button type="button" class="btn btn-sm" onclick={() => void refresh()}>重试</button></p>
      {:else if !session.turns.length && !session.running}
        <div class="examples">
          {#each examples as example}<button type="button" onclick={() => question = example}>{example}</button>{/each}
        </div>
      {/if}
      <div class="turns">
        {#each session.turns as turn (turn.id)}
          <article class="turn">
            <p class="question">{turn.question}</p>
            <div class="answer-heading"><h3>{statusNames[turn.answer.status]}</h3><button class="btn btn-sm" type="button" onclick={() => void copy(turn.answer)}>复制答复及来源</button></div>
            {#each turn.answer.paragraphs as paragraph}
              <p class="answer-paragraph">{paragraph.text}{#each paragraph.citations as cite}<a class="citation" href={`#source-${turn.id}-${cite.sourceId}`} aria-label={`资料来源${citations(turn.answer).indexOf(cite.sourceId) + 1}`}>[{citations(turn.answer).indexOf(cite.sourceId) + 1}]</a>{/each}</p>
            {/each}
            {#if turn.answer.gaps.length}<div class="gaps"><h4>尚需补充确认</h4><ul>{#each turn.answer.gaps as gap}<li>{gap}</li>{/each}</ul></div>{/if}
            {#if turn.answer.warnings.length}<div class="warnings">{#each turn.answer.warnings as warning}<p>{warning}</p>{/each}</div>{/if}
            {#if turn.answer.files.length}<ul class="attachments">{#each turn.answer.files as file}<li><a href={file.url} target="_blank" rel="noreferrer">{file.title}</a></li>{/each}</ul>{/if}
            {#if turn.answer.sources.length || turn.answer.calculations.length}
              <details class="sources">
                <summary>资料来源与计算过程</summary>
                {#each turn.answer.sources as source}
                  <div class="source" id={`source-${turn.id}-${source.id}`}>
                    <a href={source.url} target="_blank" rel="noreferrer">{source.title} · {source.locator}</a>
                    <span class="source-kind">{authorityNames[source.authority]}{source.extraction === "ocr" ? " · 扫描识别" : ""}</span>
                    {#each turn.answer.paragraphs.flatMap(p => p.citations).filter(c => c.sourceId === source.id) as cite}<blockquote>{cite.quote}</blockquote>{/each}
                  </div>
                {/each}
                {#each turn.answer.calculations as calc}
                  <div class="source calculation" id={`source-${turn.id}-${calc.id}`}>
                    <h4>{calc.label}</h4><p>{calc.expression} = {calc.result} {calc.resultUnit}</p>
                    <ul>{#each calc.inputs as input}<li>{input.name} = {input.value} {input.unit}<blockquote>{input.quote}</blockquote><a href={turn.answer.sources.find(s => s.id === input.sourceId)?.url} target="_blank" rel="noreferrer">{turn.answer.sources.find(s => s.id === input.sourceId)?.title} · {turn.answer.sources.find(s => s.id === input.sourceId)?.locator}</a></li>{/each}</ul>
                  </div>
                {/each}
              </details>
            {/if}
          </article>
        {/each}
        {#if session.running}<div class="pending" role="status">{#if pendingQuestion}<p class="question">{pendingQuestion}</p>{/if}<p>{session.progress || "正在核对材料…"}</p></div>{/if}
        {#if session.error}<p role="alert">{session.error}</p>{/if}
      </div>
      <form class="composer" onsubmit={send}>
        <label for="credit-question">授信问题</label>
        <textarea id="credit-question" class="textarea textarea-bordered" bind:value={question} maxlength="3000" rows="4" placeholder="请说明主体、期间和需要核实的问题，例如：2025年合并口径吸收投资收到的现金来源。" disabled={sending || session.running}></textarea>
        <button class="btn btn-primary" type="submit" disabled={!question.trim() || sending || session.running}>{session.running ? "正在核对材料" : sending ? "正在发送" : "生成答复"}</button>
      </form>
    </ModuleCard>
  </div>
  <aside class="materials">
    <ModuleCard>
      <PanelHeading id="credit-materials-heading" title="授信材料" />
      <label for="credit-material-filter">查找材料</label>
      <input id="credit-material-filter" class="input input-bordered" bind:value={materialFilter} placeholder="文件名、年份或材料类型" />
      {#if !materials.length}<p>材料目录尚未载入。</p>{/if}
      <ul class="material-list">{#each filteredMaterials as material}<li><a href={material.url} target="_blank" rel="noreferrer">{material.title}</a><span class="source-kind">{authorityNames[material.authority]}</span></li>{/each}</ul>
    </ModuleCard>
  </aside>
</div>

<style>
  .credit-assistant { display: grid; grid-template-columns: minmax(0, 1fr) minmax(260px, 330px); gap: 20px; align-items: start; }
  .conversation, .materials { min-width: 0; }
  .conversation-header, .answer-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
  .examples { display: grid; gap: 12px; margin: 20px 0; }
  .examples button { min-height: 44px; text-align: left; padding: 12px; border: 1px solid var(--border, #d8e2f0); border-radius: var(--radius-control, 6px); background: var(--surface, white); cursor: pointer; }
  .turn { padding: 20px 0; border-bottom: 1px solid var(--border, #d8e2f0); }
  .question { padding: 14px; background: var(--page-bg, #f6f8fb); border-radius: var(--radius-control, 6px); white-space: pre-wrap; overflow-wrap: anywhere; }
  .answer-paragraph { line-height: 1.85; white-space: pre-wrap; overflow-wrap: anywhere; }
  h3 { font-size: 1.125rem; font-weight: bold; } h4 { font-size: 1rem; font-weight: bold; margin: 12px 0; }
  a { color: var(--brand, #2f6fd6); text-decoration: underline; overflow-wrap: anywhere; }
  .citation { margin-left: 4px; font-size: .875rem; }
  .composer { display: grid; gap: 12px; padding-top: 24px; }
  .composer textarea { width: 100%; min-height: 110px; resize: vertical; font-size: 1rem; }
  .composer button { justify-self: end; min-height: 44px; }
  label { display: block; font-size: .875rem; margin-bottom: 8px; }
  .materials input { width: 100%; min-height: 44px; }
  .material-list { list-style: none; padding: 0; margin-bottom: 0; max-height: 68vh; overflow-y: auto; }
  .material-list li { padding: 14px 0; border-bottom: 1px solid var(--border, #d8e2f0); font-size: .875rem; line-height: 1.65; }
  .source-kind { display: block; color: var(--text-2, #667085); font-size: .875rem; margin-top: 6px; }
  .sources { margin-top: 20px; } summary { cursor: pointer; min-height: 44px; padding: 10px 0; }
  .source { padding: 12px 0; border-top: 1px solid var(--border, #d8e2f0); scroll-margin-top: 20px; }
  blockquote { white-space: pre-wrap; overflow-wrap: anywhere; border-left: 3px solid var(--border, #d8e2f0); margin: 12px 0; padding: 4px 12px; font-size: .875rem; line-height: 1.7; }
  .warnings, .gaps { line-height: 1.75; } .warnings { color: var(--text-2, #667085); font-size: .875rem; }
  .attachments { padding-left: 20px; line-height: 1.8; } .pending { padding-top: 18px; }
  @media (max-width: 960px) { .credit-assistant { grid-template-columns: minmax(0, 1fr); } .material-list { max-height: none; } }
</style>
