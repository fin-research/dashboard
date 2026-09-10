<script lang="ts">
  import { onMount } from "svelte";
  import { creditActivityLabel } from "./progress";
  import type { CreditSession } from "./types";

  let { session, sending = false, notice = "" }: { session: CreditSession; sending?: boolean; notice?: string } = $props();
  let now = $state(Date.now());
  const activities = $derived(session.activities ?? []);
  const current = $derived(activities.at(-1));
  const label = $derived(sending ? "正在发送" : current ? creditActivityLabel(current, activities) : session.progress || "正在处理");
  const elapsed = $derived(session.startedAt ? Math.max(0, Math.floor((now - session.startedAt) / 1000)) : 0);
  const duration = $derived(elapsed < 60 ? `${elapsed} 秒` : `${Math.floor(elapsed / 60)} 分 ${elapsed % 60} 秒`);
  onMount(() => {
    const timer = setInterval(() => { now = Date.now(); }, 1000);
    return () => clearInterval(timer);
  });
</script>

<div class="credit-activity">
  <details class="activity-details">
    <summary>
      <span class="activity-summary" role="status" aria-atomic="true">
        <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
        <span>{notice || label}</span>
      </span>
      {#if !sending && elapsed > 0}<span class="activity-duration" aria-label={`已用时 ${duration}`}>{duration}</span>{/if}
      <span class="activity-toggle">处理记录</span>
    </summary>
    {#if activities.length}
      <ol aria-label="处理记录">
        {#each activities as activity (activity.id)}
          <li class:current={activity.id === current?.id} aria-current={activity.id === current?.id ? "true" : undefined}>
            <span class="activity-marker" aria-hidden="true"></span>
            <div><span class="activity-label">{creditActivityLabel(activity, activities)}</span><p>{activity.message}</p></div>
          </li>
        {/each}
      </ol>
    {:else}<p class="activity-wait">{sending ? "问题正在提交" : session.progress || "正在等待处理记录"}</p>{/if}
  </details>
</div>

<style>
  .credit-activity { min-width: 0; color: var(--text-2); font-size: .875rem; }
  summary { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; min-height: 44px; cursor: pointer; list-style: none; }
  summary::-webkit-details-marker { display: none; }
  summary:focus-visible { outline: 2px solid var(--brand); outline-offset: 3px; border-radius: var(--radius-control); }
  .activity-summary { display: inline-flex; align-items: center; gap: 10px; color: var(--text-1); }
  .loading { color: var(--brand); flex-shrink: 0; }
  .activity-duration { color: var(--text-3); font-variant-numeric: tabular-nums; }
  .activity-toggle { display: inline-flex; align-items: center; gap: 8px; color: var(--text-3); margin-left: auto; }
  .activity-toggle::after { content: ""; width: 6px; height: 6px; border-right: 1px solid currentColor; border-bottom: 1px solid currentColor; transform: rotate(45deg); }
  details[open] .activity-toggle::after { transform: rotate(225deg); }
  ol { list-style: none; padding: 8px 0 4px; margin: 0; max-height: 280px; overflow-y: auto; }
  li { display: flex; position: relative; gap: 14px; padding: 0 0 18px 4px; }
  li:not(:last-child)::before { content: ""; position: absolute; top: 14px; bottom: 0; left: 7px; border-left: 1px solid var(--border-color); }
  li:last-child { padding-bottom: 4px; }
  .activity-marker { flex-shrink: 0; width: 7px; height: 7px; margin-top: 9px; border-radius: 50%; background: var(--border-strong); }
  .current .activity-marker { background: var(--brand); }
  li > div { min-width: 0; }
  .activity-label { color: var(--text-2); }
  .current .activity-label { color: var(--brand); font-weight: bold; }
  p { margin: 2px 0 0; color: var(--text-3); overflow-wrap: anywhere; }
  .activity-wait { padding: 4px 0 12px; }
  @media (prefers-reduced-motion: reduce) { .loading { animation: none; } }
</style>
