<script lang="ts">
  import { Bot, Clock, Square, X } from "@lucide/svelte";
  import { tick } from "svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import type { AiClient, AiTaskRecord } from "$lib/ai-client.svelte";

  let { client }: { client: AiClient } = $props();
  let trigger = $state<HTMLButtonElement | null>(null);
  let panel = $state<HTMLElement | null>(null);

  const running = $derived(client.activeTasks);
  const history = $derived(client.tasks.filter((task) => task.status !== "running"));

  async function openPanel() {
    client.setOpen(true);
    await tick();
    panel?.focus({ preventScroll: true });
  }

  async function closePanel() {
    client.setOpen(false);
    await tick();
    trigger?.focus({ preventScroll: true });
  }

  function keydown(event: KeyboardEvent) {
    if (event.key === "Escape" && client.open) void closePanel();
  }

  function status(task: AiTaskRecord): string {
    if (task.status === "running") return "进行中";
    if (task.status === "completed") return "已完成";
    if (task.status === "cancelled") return "已取消";
    if (task.status === "disconnected") return "已断开";
    return "失败";
  }

  function time(timestamp: number): string {
    return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(timestamp);
  }
</script>

<svelte:window onkeydown={keydown} />

{#if !client.open}
  <Button
    bind:ref={trigger}
    class="ai-trigger"
    variant="default"
    aria-label="打开 AI 面板"
    aria-controls="global-ai-panel"
    aria-expanded="false"
    onclick={openPanel}
  >
    <Bot aria-hidden="true" />
    <span>AI</span>
    {#if running.length}<span class="ai-trigger-dot" aria-label="AI 任务进行中"></span>{/if}
  </Button>
{:else}
  <aside
    bind:this={panel}
    id="global-ai-panel"
    class="ai-panel"
    aria-label="AI 任务面板"
    tabindex="-1"
  >
    <header class="ai-panel-header">
      <div class="ai-panel-title"><Bot aria-hidden="true" /><h2>AI</h2></div>
      <Button variant="ghost" class="ai-panel-close" aria-label="关闭 AI 面板" onclick={closePanel}><X aria-hidden="true" /></Button>
    </header>

    <div class="ai-panel-body">
      {#each running as task (task.id)}
        <section class="ai-current" aria-labelledby={`ai-current-title-${task.id}`}>
          <div class="ai-section-heading">
            <div><span>当前任务</span><h3 id={`ai-current-title-${task.id}`}>{task.title}</h3></div>
            {#if task.cancellable}<Button variant="ghost" class="ai-stop" aria-label={`停止${task.title}`} onclick={() => client.cancel(task.id)}><Square aria-hidden="true" /></Button>{/if}
          </div>
          <div class="ai-progress" role="status" aria-live="polite" aria-atomic="true">
            <span class="ai-pulse" aria-hidden="true"></span>
            <p>{task.progress.at(-1) ?? "正在处理"}</p>
          </div>
          {#if task.progress.length > 1}
            <ol class="ai-progress-history">
              {#each task.progress.slice(0, -1) as item}<li>{item}</li>{/each}
            </ol>
          {/if}
        </section>
      {/each}

      <section class="ai-history" aria-labelledby="ai-history-title">
        <div class="ai-section-heading ai-history-heading">
          <div class="ai-history-title"><Clock aria-hidden="true" /><h3 id="ai-history-title">调用记录</h3></div>
          {#if history.length}<Button variant="ghost" class="ai-clear" onclick={() => client.clearHistory()}>清除</Button>{/if}
        </div>
        {#if !history.length}
          <p class="ai-empty">暂无调用记录</p>
        {:else}
          <ol class="ai-task-list">
            {#each history as task (task.id)}
              <li class:failed={task.status === "failed"}>
                <div><strong>{task.title}</strong><span>{time(task.startedAt)}</span></div>
                <span class="ai-status">{status(task)}</span>
                {#if task.error}<p role="alert">{task.error}</p>{:else if task.progress.at(-1)}<p>{task.progress.at(-1)}</p>{/if}
              </li>
            {/each}
          </ol>
        {/if}
      </section>
    </div>
  </aside>
{/if}

<style>
  :global(.ai-trigger) {
    position: fixed;
    z-index: 45;
    right: max(20px, env(safe-area-inset-right));
    bottom: max(20px, env(safe-area-inset-bottom));
    min-width: 76px;
    height: 48px;
    gap: 8px;
    border-radius: 999px;
    box-shadow: 0 16px 36px rgb(23 32 51 / 22%);
  }
  :global(.ai-trigger) :global(svg), .ai-panel-title :global(svg), .ai-history-title :global(svg) { width: 20px; height: 20px; }
  .ai-trigger-dot { width: 8px; height: 8px; border-radius: 50%; background: #fff; box-shadow: 0 0 0 3px rgb(255 255 255 / 28%); }
  .ai-panel {
    position: fixed;
    z-index: 45;
    inset: 16px max(16px, env(safe-area-inset-right)) 16px auto;
    display: flex;
    width: min(420px, calc(100vw - 32px));
    max-height: calc(100dvh - 32px);
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-card);
    background: var(--surface);
    color: var(--text-1);
    box-shadow: 0 24px 64px rgb(23 32 51 / 24%);
    animation: ai-panel-enter 180ms ease-out;
  }
  .ai-panel:focus { outline: none; }
  .ai-panel-header { display: flex; min-height: 64px; align-items: center; justify-content: space-between; padding: 10px 12px 10px 20px; border-bottom: 1px solid var(--border-color); }
  .ai-panel-title, .ai-history-title { display: flex; align-items: center; gap: 10px; }
  .ai-panel-title { color: var(--brand); }
  .ai-panel-title h2, .ai-section-heading h3 { margin: 0; color: var(--text-1); font-weight: bold; }
  .ai-panel-title h2 { font-size: 1.25rem; }
  :global(.ai-panel-close), :global(.ai-stop) { width: 44px; height: 44px; padding: 0; }
  :global(.ai-panel-close) :global(svg), :global(.ai-stop) :global(svg) { width: 20px; height: 20px; }
  .ai-panel-body { min-height: 0; flex: 1; overflow-y: auto; overscroll-behavior: contain; }
  .ai-current, .ai-history { padding: 20px; }
  .ai-current { border-bottom: 1px solid var(--border-color); background: color-mix(in srgb, var(--brand-soft) 55%, var(--surface)); }
  .ai-current + .ai-current { border-top: 0; }
  .ai-section-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .ai-section-heading > div:first-child { min-width: 0; }
  .ai-section-heading > div:first-child > span { display: block; margin-bottom: 4px; color: var(--text-muted); font-size: .875rem; }
  .ai-section-heading h3 { font-size: 1rem; overflow-wrap: anywhere; }
  .ai-progress { display: flex; align-items: flex-start; gap: 12px; margin-top: 20px; line-height: 1.65; }
  .ai-progress p { min-width: 0; margin: 0; overflow-wrap: anywhere; }
  .ai-pulse { flex: 0 0 auto; width: 10px; height: 10px; margin-top: 7px; border-radius: 50%; background: var(--brand); animation: ai-pulse 1.4s ease-in-out infinite; }
  .ai-progress-history { display: grid; gap: 10px; margin: 18px 0 0; padding-left: 22px; color: var(--text-muted); font-size: .875rem; line-height: 1.6; }
  .ai-history-heading { margin-bottom: 14px; }
  :global(.ai-clear) { min-height: 44px; }
  .ai-empty { margin: 28px 0; color: var(--text-muted); text-align: center; }
  .ai-task-list { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
  .ai-task-list li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 7px 12px; padding: 14px; border: 1px solid var(--border-color); border-radius: var(--radius-control); background: var(--surface); }
  .ai-task-list li > div { display: flex; min-width: 0; align-items: baseline; justify-content: space-between; gap: 10px; }
  .ai-task-list strong { overflow-wrap: anywhere; font-size: .875rem; }
  .ai-task-list span, .ai-task-list p { color: var(--text-muted); font-size: .8125rem; }
  .ai-task-list p { grid-column: 1 / -1; margin: 0; overflow-wrap: anywhere; line-height: 1.55; }
  .ai-task-list li.failed .ai-status, .ai-task-list li.failed p { color: var(--destructive); }
  .ai-status { white-space: nowrap; }
  @keyframes ai-panel-enter { from { opacity: 0; transform: translateX(18px); } to { opacity: 1; transform: translateX(0); } }
  @keyframes ai-pulse { 0%, 100% { opacity: .35; transform: scale(.85); } 50% { opacity: 1; transform: scale(1); } }
  @media (max-width: 600px) {
    :global(.ai-trigger) { right: max(12px, env(safe-area-inset-right)); bottom: max(12px, env(safe-area-inset-bottom)); }
    .ai-panel { inset: 0; width: 100vw; max-height: 100dvh; border: 0; border-radius: 0; padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom); }
  }
  @media (prefers-reduced-motion: reduce) {
    .ai-panel, .ai-pulse { animation: none; }
  }
</style>
