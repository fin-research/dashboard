<script lang="ts">
  import { onMount, tick } from "svelte";
  import WorkbenchIcon from "../trading-research/WorkbenchIcon.svelte";
  import { portal } from "../portal";
  import { globalMessages } from "../global-messages";
  import { customerAnswerText, creditCustomerSchema, confidentialityLabel, type CreditAnswer, type CreditCustomer, type CreditSession } from "./types";
  import CreditActivityView from "./CreditActivityView.svelte";

  let { customerOptions = $bindable(null) }: { customerOptions?: CreditCustomer[] | null } = $props();

  let session = $state<CreditSession>({ turns: [], running: false, progress: "", error: null, startedAt: 0 });
  let question = $state("");
  let optimisticQuestion = $state("");
  let loading = $state(false);
  let loadError = $state("");
  let sending = $state(false);
  let creating = $state(false);
  let customerName = $state("");
  let activeInstitution = $state("");
  let draftText = $state("");
  let streamNotice = $state("");
  let chosenCustomer = $state<CreditCustomer | null>(null);
  const customers = $derived((customerOptions ?? []).filter(customer => customer.name.toLocaleLowerCase().includes(customerName.trim().toLocaleLowerCase())).slice(0, 20));
  let searching = $state(false);
  let searchError = $state("");
  let showCustomers = $state(false);
  let activeCustomer = $state(-1);
  let customerInput: HTMLInputElement;
  let restoreController: AbortController | undefined;
  let chat: HTMLDivElement;
  let textarea: HTMLTextAreaElement;
  let form: HTMLFormElement;
  let stream: EventSource | undefined;
  let streamFailures = 0;
  let mounted = false;
  let revision = 0;
  const pendingQuestion = $derived(session.pendingQuestion || optimisticQuestion);
  const busy = $derived(sending || session.running || creating);
  const selectedCustomer = $derived(chosenCustomer?.name === customerName.trim()
    ? customerOptions?.find(customer => customer.name === chosenCustomer?.name) ?? chosenCustomer : null);
  const authorityNames: Record<string, string> = { audited: "审计报告", disclosure: "正式披露", internal: "业务材料", historical_reply: "历史答复", draft: "待部门确认" };

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const query = activeInstitution ? `${path.includes("?") ? "&" : "?"}institutionName=${encodeURIComponent(activeInstitution)}` : "";
    const response = await fetch(`/api/credit-assistant/${path}${query}`, { ...init, signal: init?.signal ?? AbortSignal.timeout(30_000),
      headers: { "content-type": "application/json", ...init?.headers } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "请求未完成，请重试");
    return data as T;
  }
  function stopStream() {
    stream?.close(); stream = undefined; streamNotice = "";
  }
  function rememberInstitution(name: string) {
    activeInstitution = name;
    try { localStorage.setItem("credit-assistant:institution", name); } catch { /* Selection can still be used in this tab. */ }
  }
  function watchSession() {
    if (!mounted || !session.running || !activeInstitution) { stopStream(); return; }
    if (stream) return;
    const current = revision;
    const source = new EventSource(`/api/credit-assistant/session/events?institutionName=${encodeURIComponent(activeInstitution)}`);
    stream = source;
    source.addEventListener("session", event => {
      if (!mounted || current !== revision || stream !== source) return;
      try {
        const next = JSON.parse((event as MessageEvent).data) as CreditSession;
        const followLatest = nearLatest();
        session = next;
        draftText = next.draftText ?? "";
        streamNotice = ""; streamFailures = 0; loadError = "";
        if (!next.running) { if (!next.error) optimisticQuestion = ""; draftText = ""; stopStream(); }
        if (followLatest) void scrollLatest();
      } catch { loadError = "读取答复失败，请重新连接。"; stopStream(); }
    });
    source.addEventListener("draft", event => {
      if (!mounted || current !== revision || stream !== source) return;
      try {
        const data = JSON.parse((event as MessageEvent).data) as { text: string; questionId: string };
        if (data.questionId !== session.questionId || typeof data.text !== "string") return;
        const followLatest = nearLatest();
        draftText = data.text;
        if (followLatest) void scrollLatest();
      } catch { /* A subsequent session snapshot restores the current draft. */ }
    });
    source.onerror = () => {
      if (!mounted || current !== revision || stream !== source) return;
      streamNotice = "连接中断，正在重连…";
      if (++streamFailures >= 3 || source.readyState === 2) { loadError = "连接已断开，请重新连接以查看答复。"; stopStream(); }
    };
  }
  function nearLatest() {
    const workspace = chat?.closest<HTMLElement>(".tr-workspace");
    return !workspace || workspace.scrollHeight - workspace.scrollTop - workspace.clientHeight < 220;
  }
  async function scrollLatest() {
    await tick();
    if (!mounted) return;
    const workspace = chat?.closest<HTMLElement>(".tr-workspace");
    workspace?.scrollTo({ top: workspace.scrollHeight, behavior: "instant" });
  }
  async function refresh() {
    if (!activeInstitution) return;
    restoreController?.abort();
    const controller = new AbortController();
    restoreController = controller;
    const followLatest = !session.turns.length || nearLatest();
    loading = true;
    const current = revision;
    try {
      const next = await api<CreditSession>("session", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) });
      if (!mounted || current !== revision || controller.signal.aborted || restoreController !== controller) return;
      session = next;
      draftText = next.draftText ?? "";
      if (!chosenCustomer && next.customer) chosenCustomer = next.customer;
      loadError = "";
      if (!session.running && !session.error) optimisticQuestion = "";
      if (followLatest) void scrollLatest();
    } catch (error) {
      if (mounted && current === revision && !controller.signal.aborted) loadError = "历史对话未能加载，可重新连接或直接提问。";
    } finally {
      if (mounted && current === revision && restoreController === controller) { loading = false; watchSession(); }
    }
  }
  function searchCustomers(event: Event) {
    customerName = (event.currentTarget as HTMLInputElement).value;
    activeCustomer = -1;
    showCustomers = true;
  }
  async function loadCustomers() {
    if (customerOptions !== null || searching) return;
    searching = true; searchError = "";
    try {
      const result = await api<{ institutions: CreditCustomer[] }>("institutions");
      if (!mounted || customerOptions !== null) return;
      customerOptions = result.institutions.map(value => creditCustomerSchema.parse(value));
      if (!chosenCustomer) chosenCustomer = customerOptions.find(customer => customer.name === activeInstitution) ?? null;
    } catch (error) {
      if (mounted) searchError = error instanceof Error ? error.message : "机构列表加载失败";
    } finally { if (mounted) searching = false; }
  }
  function selectCustomer(customer: CreditCustomer) {
    if (busy) return;
    showCustomers = false;
    if (chosenCustomer?.name === customer.name && activeInstitution === customer.name) {
      customerName = customer.name; textarea?.focus({ preventScroll: true }); return;
    }
    revision++;
    restoreController?.abort();
    stopStream();
    chosenCustomer = customer;
    customerName = customer.name;
    rememberInstitution(customer.name);
    session = { turns: [], running: false, progress: "", error: null, startedAt: 0 };
    optimisticQuestion = ""; draftText = ""; streamFailures = 0; loadError = "";
    textarea?.focus({ preventScroll: true });
    void refresh();
  }
  function customerKeydown(event: KeyboardEvent) {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") { showCustomers = false; return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      showCustomers = true;
      activeCustomer = Math.max(0, Math.min(customers.length - 1, activeCustomer + (event.key === "ArrowDown" ? 1 : -1)));
      void tick().then(() => { if (mounted && showCustomers) document.getElementById(`credit-customer-${activeCustomer}`)?.scrollIntoView({ block: "nearest" }); });
    } else if (event.key === "Enter") {
      event.preventDefault();
      const customer = customers[activeCustomer];
      if (showCustomers && customer) void selectCustomer(customer);
    }
  }
  function resizeInput() {
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }
  async function sendQuestion(value: string) {
    const text = value.trim();
    if (!text || busy) return;
    if (!selectedCustomer) { globalMessages.error("请先输入客户名称并从列表中选择机构。"); customerInput?.focus(); return; }
    revision++;
    restoreController?.abort(); loading = false; loadError = "";
    stopStream();
    sending = true;
    optimisticQuestion = text;
    const draft = question;
    question = "";
    draftText = ""; streamFailures = 0;
    session = { ...session, error: null, pendingQuestion: "", activities: [], startedAt: 0 };
    void scrollLatest();
    try {
      const next = await api<CreditSession>("session", { method: "POST", body: JSON.stringify({ question: text, institutionName: selectedCustomer.name }) });
      if (!mounted) return;
      session = next;
      watchSession();
    } catch (error) {
      if (!mounted) return;
      question ||= draft || text;
      optimisticQuestion = "";
      globalMessages.error(error instanceof Error ? error.message : "发送失败");
      // Another tab may have started this customer's turn while history was
      // loading. Restore it after a conflict without re-submitting the question.
      void refresh();
    } finally {
      sending = false;
      await tick();
      if (mounted) { resizeInput(); textarea?.focus({ preventScroll: true }); }
    }
  }
  function send(event: SubmitEvent) {
    event.preventDefault();
    void sendQuestion(question);
  }
  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      form.requestSubmit();
    }
  }
  async function newSession() {
    if (busy) return;
    if (!selectedCustomer) { customerInput?.focus(); return; }
    revision++;
    restoreController?.abort(); loading = false;
    stopStream();
    creating = true;
    try {
      const next = await api<CreditSession>("session/new", { method: "POST", body: JSON.stringify({ institutionName: selectedCustomer.name }) });
      if (!mounted) return;
      session = next;
      optimisticQuestion = "";
      question = "";
      customerName = next.customer?.name ?? "";
      draftText = "";
      showCustomers = false;
      loadError = "";
      await tick();
      resizeInput();
      textarea?.focus({ preventScroll: true });
      void scrollLatest();
    } catch (error) { globalMessages.error(error instanceof Error ? error.message : "新建对话失败"); }
    finally { creating = false; }
  }
  async function copy(turnId: string) {
    const current = revision;
    try {
      const latest = await api<CreditSession>("session");
      if (!mounted || current !== revision) return;
      session = latest;
      const answer = latest.turns.find(t => t.id === turnId)?.answer;
      if (!answer) throw new Error("当前会话中没有该答复，请重新提问。");
      await navigator.clipboard.writeText(customerAnswerText(answer));
      globalMessages.success(answer.disclosure?.blocked ? "已复制保密协议签署提示" : "已复制答复和资料来源");
    } catch (error) { globalMessages.error(error instanceof Error ? error.message : "复制失败，请重试"); }
  }
  function citations(answer: CreditAnswer): string[] { return [...new Set(answer.paragraphs.flatMap(p => p.citations.map(c => c.sourceId)))]; }
  async function showCitation(event: MouseEvent, turnId: string, sourceId: string) {
    event.preventDefault();
    const details = document.getElementById(`references-${turnId}`);
    if (details instanceof HTMLDetailsElement) details.open = true;
    await tick();
    const target = document.getElementById(`source-${turnId}-${sourceId}`);
    target?.scrollIntoView({ block: "start", behavior: "instant" });
    target?.focus({ preventScroll: true });
  }
  function fileType(title: string) { return title.match(/\.([a-z0-9]+)$/i)?.[1]?.toUpperCase() || "文件"; }
  onMount(() => {
    mounted = true;
    try { activeInstitution = localStorage.getItem("credit-assistant:institution") ?? ""; } catch { /* No persisted selection. */ }
    customerName = activeInstitution;
    chosenCustomer = customerOptions?.find(customer => customer.name === activeInstitution) ?? null;
    void loadCustomers();
    void refresh();
    return () => { mounted = false; revision++; restoreController?.abort(); stopStream(); };
  });
</script>

<div class="credit-chat" bind:this={chat}>
  <!-- Keep the component's root in place; only move its nested toolbar. -->
  <div class="chat-toolbar" use:portal={"#tr-topbar-actions"}>
    <button class="btn chat-button chat-button--new" type="button" disabled={busy || !selectedCustomer} onclick={() => void newSession()}>
      <WorkbenchIcon name="plus" /><span>{creating ? "正在新建…" : "新对话"}</span>
    </button>
  </div>
  <p class="sr-only" role="status">{!session.running && !sending && !loading && !session.error && session.turns.length ? "授信答复已完成，可阅读正文与资料来源。" : ""}</p>
  <div class="chat-messages" role="log" aria-label="对话记录" aria-live="off">
    {#if loading && !session.turns.length}
      <div class="chat-empty" role="status"><span class="loading loading-spinner loading-sm" aria-hidden="true"></span><p>正在恢复历史对话，可继续输入…</p></div>
    {:else if !session.turns.length && !pendingQuestion && !session.running && !session.error && !loadError}
      <div class="chat-empty"><span class="chat-welcome-icon"><WorkbenchIcon name="chat" /></span><h2>有什么需要核实？</h2></div>
    {/if}
    {#if loadError}
      <div class="chat-load-error" role="alert"><p>{loadError}</p><button class="btn chat-button" type="button" onclick={() => void refresh()}>重新连接</button></div>
    {/if}
    {#each session.turns as turn (turn.id)}
      <article class="chat-turn" aria-label="一轮对话">
        <div class="message message--user"><span class="sr-only">你：</span><p>{turn.question}</p></div>
        <div class="message message--assistant">
          <div class="assistant-identity"><WorkbenchIcon name="chat" /><span>授信助手{turn.answer.disclosure?.institutionName ? ` · ${turn.answer.disclosure.institutionName}` : ""}</span></div>
          <div class="answer-content">
            {#if turn.answer.notice}<p class="answer-paragraph">{turn.answer.notice}</p>{/if}
            {#each turn.answer.paragraphs as paragraph}
              <p class="answer-paragraph">{paragraph.text}{#each paragraph.citations as cite}<a class="citation" href={`#source-${turn.id}-${cite.sourceId}`} aria-label={`查看资料来源${citations(turn.answer).indexOf(cite.sourceId) + 1}`} onclick={event => void showCitation(event, turn.id, cite.sourceId)}>[{citations(turn.answer).indexOf(cite.sourceId) + 1}]</a>{/each}</p>
            {/each}
            {#if turn.answer.files.length}
              {#if !turn.answer.paragraphs.length}<p class="answer-paragraph">所需材料已附上，可以直接下载。</p>{/if}
              <ul class="file-attachments" aria-label="答复附件">
                {#each turn.answer.files as file}
                  <li><a class="file-attachment" href={`${file.url}${file.url.includes("?") ? "&" : "?"}download=1`} download={file.title} aria-label={`下载 ${file.title}`}>
                    <span class="file-icon"><WorkbenchIcon name="file" /></span>
                    <span class="file-info"><strong>{file.title}</strong><span>{fileType(file.title)} · 下载文件</span></span>
                    <span class="file-download"><WorkbenchIcon name="download" /></span>
                  </a></li>
                {/each}
              </ul>
            {/if}
            {#if turn.answer.gaps.length}<div class="answer-gaps"><h3>尚需确认</h3><ul>{#each turn.answer.gaps as gap}<li>{gap}</li>{/each}</ul></div>{/if}
            {#if turn.answer.warnings.length}<div class="answer-warnings">{#each turn.answer.warnings as warning}<p>{warning}</p>{/each}</div>{/if}
            {#if turn.answer.sources.length || turn.answer.calculations.length}
              <details class="answer-sources" id={`references-${turn.id}`}>
                <summary>资料来源与计算过程</summary>
                {#each turn.answer.sources as source}
                  <div class="source" id={`source-${turn.id}-${source.id}`} tabindex="-1">
                    <a href={source.url} target="_blank" rel="noreferrer">{source.title} · {source.locator}</a>
                    <span class="source-kind">{authorityNames[source.authority]}{source.extraction === "ocr" ? " · 扫描识别" : source.extraction === "ai_search" ? " · 检索片段" : ""}</span>
                    {#each turn.answer.paragraphs.flatMap(p => p.citations).filter(c => c.sourceId === source.id) as cite}<blockquote>{cite.quote}</blockquote>{/each}
                  </div>
                {/each}
                {#each turn.answer.calculations as calc}
                  <div class="source" id={`source-${turn.id}-${calc.id}`} tabindex="-1">
                    <h3>{calc.label}</h3><p>{calc.expression} = {calc.result} {calc.resultUnit}</p>
                    <ul>{#each calc.inputs as input}<li>{input.name} = {input.value} {input.unit}<blockquote>{input.quote}</blockquote><a href={turn.answer.sources.find(s => s.id === input.sourceId)?.url} target="_blank" rel="noreferrer">{turn.answer.sources.find(s => s.id === input.sourceId)?.title} · {turn.answer.sources.find(s => s.id === input.sourceId)?.locator}</a></li>{/each}</ul>
                  </div>
                {/each}
              </details>
            {/if}
            <button class="btn chat-button chat-button--copy" type="button" onclick={() => void copy(turn.id)} aria-label="复制答复和资料来源"><WorkbenchIcon name="copy" /><span>复制答复</span></button>
          </div>
        </div>
      </article>
    {/each}
    {#if pendingQuestion || session.running || sending || session.error}
      <article class="chat-turn" aria-label="当前对话">
        {#if pendingQuestion}<div class="message message--user"><span class="sr-only">你：</span><p>{pendingQuestion}</p></div>{/if}
        <div class="message message--assistant">
          <div class="assistant-identity"><WorkbenchIcon name="chat" /><span>授信助手</span></div>
          {#if session.running || sending}
            <CreditActivityView {session} {sending} notice={streamNotice} />
            {#if draftText}<div class="streaming-answer" aria-label="正在生成的答复" aria-live="off"><span class="draft-label">答复草稿 · 正在核对</span><p class="answer-paragraph">{draftText}</p></div>{/if}
          {:else if session.error}
            <div class="answer-error" role="alert"><p>{session.error}</p>{#if pendingQuestion}<button class="btn chat-button" type="button" disabled={busy || !!loadError} onclick={() => void sendQuestion(pendingQuestion)}>重新发送</button>{/if}</div>
          {/if}
        </div>
      </article>
    {/if}
  </div>
  <div class="composer-dock">
    <div class="customer-picker">
      <label for="credit-customer">客户名称</label>
      <div class="customer-search">
        <input class="input" id="credit-customer" bind:this={customerInput} bind:value={customerName} oninput={searchCustomers} onkeydown={customerKeydown}
          onfocus={() => { showCustomers = true; }} onblur={() => { showCustomers = false; }}
          type="text" role="combobox" aria-autocomplete="list" aria-expanded={showCustomers} aria-controls="credit-customers"
          aria-activedescendant={showCustomers && activeCustomer >= 0 && customers[activeCustomer] ? `credit-customer-${activeCustomer}` : undefined}
          autocomplete="off" maxlength="200" placeholder="搜索并选择请求材料的机构" disabled={busy} />
        {#if showCustomers}
          <div class="customer-options">
            <ul id="credit-customers" role="listbox" aria-label="匹配机构">
              {#each customers as customer, index (customer.name)}
                <li role="option" aria-selected={index === activeCustomer} id={`credit-customer-${index}`}>
                  <button class="btn btn-ghost" type="button" tabindex="-1" onpointerdown={event => event.preventDefault()} onclick={() => selectCustomer(customer)}>
                    <span>{customer.name}</span><span>{confidentialityLabel(customer.confidentialityStatus)}</span>
                  </button>
                </li>
              {/each}
            </ul>
            {#if searching}<p role="status">正在加载机构列表…</p>
            {:else if searchError}<p role="alert">{searchError}<button class="btn btn-ghost" type="button" onpointerdown={event => event.preventDefault()} onclick={() => void loadCustomers()}>重新加载</button></p>
            {:else if !customers.length}<p role="status">未找到机构，请调整名称或先在授信一览表中维护机构。</p>{/if}
          </div>
        {/if}
      </div>
      <span class="customer-status" aria-live="polite" title={selectedCustomer ? `授信列表快照：${selectedCustomer.reportDate}` : undefined}>{selectedCustomer ? confidentialityLabel(selectedCustomer.confidentialityStatus) : "请选择机构"}</span>
    </div>
    <form class="chat-composer" onsubmit={send} bind:this={form}>
      <label class="sr-only" for="credit-question">输入消息</label>
      <textarea class="textarea textarea-ghost" id="credit-question" bind:this={textarea} bind:value={question} oninput={resizeInput} onkeydown={handleKeydown} rows="2" placeholder="输入问题，或告诉我需要哪份材料…" disabled={creating} aria-describedby="credit-composer-hint"></textarea>
      <div class="composer-actions">
        <span id="credit-composer-hint">Enter 发送<span class="keyboard-hint"> · Shift + Enter 换行</span></span>
        <button class="btn btn-primary chat-button chat-button--send" type="submit" disabled={!selectedCustomer || !question.trim() || busy} aria-label={busy ? "正在处理消息" : "发送消息"} title={busy ? "正在处理消息" : "发送消息"}><WorkbenchIcon name="arrow-up" /></button>
      </div>
    </form>
  </div>
</div>

<style>
  .credit-chat { display: flex; flex: 1; flex-direction: column; min-width: 0; width: 100%; }
  .chat-toolbar { display: flex; align-items: center; }
  .chat-messages { flex: 1; width: min(100%, 880px); margin-inline: auto; padding: 36px 24px 20px; }
  .chat-empty { display: flex; min-height: min(40dvh, 320px); flex-direction: column; align-items: center; justify-content: center; gap: 20px; color: var(--text-3); text-align: center; }
  .chat-empty h2 { margin: 0; color: var(--text-1); font-size: 1.5rem; font-weight: bold; }
  .chat-welcome-icon { display: grid; place-items: center; width: 52px; height: 52px; border-radius: var(--radius-card); background: var(--brand-soft); color: var(--brand); }
  .chat-welcome-icon :global(svg) { width: 28px; height: 28px; }
  .chat-turn { display: grid; gap: 28px; margin-bottom: 36px; }
  .message { min-width: 0; line-height: 1.85; overflow-wrap: anywhere; }
  .message--user { justify-self: end; max-width: min(85%, 680px); padding: 12px 18px; border-radius: var(--radius-card); background: var(--brand-soft); color: var(--text-1); }
  .message--user p { margin: 0; white-space: pre-wrap; }
  .message--assistant { display: grid; gap: 12px; }
  .assistant-identity { display: flex; align-items: center; gap: 10px; color: var(--text-1); font-size: .875rem; font-weight: bold; }
  .assistant-identity :global(svg) { color: var(--brand); width: 22px; height: 22px; }
  .answer-content { min-width: 0; }
  .answer-paragraph { margin: 0 0 16px; white-space: pre-wrap; }
  .answer-paragraph:last-child { margin-bottom: 0; }
  .answer-content a { color: var(--brand); overflow-wrap: anywhere; }
  .citation { margin-left: 4px; padding-block: 6px; font-size: .875rem; text-decoration: none; }
  .citation:hover { text-decoration: underline; }
  .file-attachments { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 12px; list-style: none; margin: 16px 0; padding: 0; }
  .file-attachment { display: flex; align-items: center; gap: 12px; min-height: 88px; padding: 16px; border: 1px solid var(--border-color); border-radius: var(--radius-card); background: var(--surface); text-decoration: none; transition: border-color 160ms ease, background 160ms ease; }
  .file-attachment:hover { border-color: var(--brand); background: var(--brand-soft); }
  .file-icon { flex-shrink: 0; display: grid; place-items: center; width: 44px; height: 44px; border-radius: var(--radius-control); background: var(--bg-page); }
  .file-icon :global(svg) { width: 24px; height: 24px; }
  .file-info { display: grid; gap: 4px; min-width: 0; flex: 1; }
  .file-info strong { color: var(--text-1); font-size: .875rem; font-weight: bold; line-height: 1.6; }
  .file-info > span { color: var(--text-3); font-size: .875rem; }
  .file-download { display: grid; place-items: center; flex-shrink: 0; }
  .file-download :global(svg) { width: 20px; height: 20px; }
  h3 { margin: 12px 0 8px; font-size: 1rem; font-weight: bold; }
  .answer-gaps ul, .source ul { margin: 0 0 12px; padding-left: 24px; }
  .answer-warnings { color: var(--text-3); font-size: .875rem; }
  .answer-warnings p { margin: 8px 0; }
  .answer-sources { margin: 12px 0 4px; color: var(--text-2); font-size: .875rem; }
  summary { width: fit-content; min-height: 44px; padding-block: 10px; cursor: pointer; color: var(--text-3); }
  summary:hover { color: var(--brand); }
  .source { padding: 16px 0; border-top: 1px solid var(--border-color); scroll-margin-top: 24px; }
  .source-kind { display: block; color: var(--text-3); margin-top: 4px; }
  blockquote { margin: 10px 0; padding: 4px 12px; border-left: 2px solid var(--border-strong); white-space: pre-wrap; }
  .streaming-answer { min-width: 0; padding-top: 8px; }
  .draft-label { display: block; color: var(--text-3); font-size: .875rem; margin-bottom: 8px; }
  .answer-error p, .chat-load-error p { margin: 0 0 12px; color: var(--text-2); }
  .chat-load-error { margin-bottom: 24px; }
  .composer-dock { position: sticky; z-index: 2; bottom: 0; width: 100%; padding: 16px 24px max(20px, env(safe-area-inset-bottom)); background: var(--bg-page); }
  .customer-picker { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; max-width: 832px; margin: 0 auto 12px; font-size: .875rem; }
  .customer-picker label { font-weight: bold; color: var(--text-1); }
  .customer-search { position: relative; flex: 1; min-width: min(100%, 220px); }
  .customer-search input { width: 100%; padding: 10px 12px; }
  .customer-options { position: absolute; bottom: calc(100% + 8px); width: 100%; max-height: min(320px, 40dvh); overflow-y: auto; border: 1px solid var(--border-strong); border-radius: var(--radius-control); background: var(--surface); box-shadow: var(--shadow-card); }
  .customer-options ul { margin: 0; padding: 4px; list-style: none; }
  .customer-options button { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; width: 100%; padding: 10px; text-align: left; }
  .customer-options button span:last-child, .customer-status { color: var(--text-3); }
  .customer-options li[aria-selected="true"] { background: var(--brand-soft); border-radius: var(--radius-control); }
  .customer-options p { margin: 0; padding: 12px; color: var(--text-2); }
  .chat-composer { max-width: 832px; margin-inline: auto; padding: 16px; border: 1px solid var(--border-strong); border-radius: var(--radius-card); background: var(--surface); box-shadow: var(--shadow-card); transition: border-color 160ms ease; }
  .chat-composer:focus-within { border-color: var(--brand); outline: 2px solid var(--brand); outline-offset: 2px; }
  textarea { display: block; width: 100%; max-height: 180px; padding: 0; border: 0; box-shadow: none; resize: none; min-height: 56px; }
  .chat-composer textarea:focus-visible { outline: none; }
  textarea::placeholder { color: var(--text-3); }
  .composer-actions { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 8px; }
  .composer-actions > span { color: var(--text-3); font-size: .875rem; }
  .chat-button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-width: 44px; padding: 8px 14px; }
  .chat-button :global(svg) { width: 18px; height: 18px; }
  .chat-button--copy { padding-inline: 10px; margin-left: -10px; }
  .chat-button--send { flex-shrink: 0; width: 44px; padding: 0; }
  .chat-button--send :global(svg) { width: 22px; height: 22px; }
  .chat-button:focus-visible, a:focus-visible, summary:focus-visible { outline: 2px solid var(--brand); outline-offset: 3px; }
  @media (max-width: 600px) {
    .chat-messages { padding: 24px 16px 12px; }
    .composer-dock { padding: 12px 16px max(16px, env(safe-area-inset-bottom)); }
    .chat-composer { padding: 12px; }
    .message--user { max-width: 92%; }
    .chat-turn { gap: 22px; }
    .keyboard-hint { display: none; }
  }
  @media (prefers-reduced-motion: reduce) { .chat-button, .file-attachment, .chat-composer { transition: none; } }
</style>
