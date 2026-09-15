<script lang="ts">
  import Badge from '../trading-research/Badge.svelte';
  import { childrenOf, isActive, minutes, type WorkflowNode, type WorkflowDay, type Scope } from './model';
  let { nodes, day, scope, clockMinutes, onComplete, onBranch }: {
    nodes: WorkflowNode[]; day: WorkflowDay; scope: Scope; clockMinutes: number;
    onComplete: (id: string, value: boolean) => void; onBranch: (id: string, value: boolean) => void;
  } = $props();
</script>

{#snippet rows(parentId: string | null)}
  <ol class="flow-nodes" class:nested={parentId !== null}>
    {#each childrenOf(nodes, scope, parentId) as node (node.id)}
      {@const active = isActive(node, nodes, day)}
      <li class:done={node.kind === 'task' && day.completed[node.id]} class:inactive={!active} data-workflow-node={node.id}>
        {#if node.kind === 'branch'}
          <div class="flow-branch">
            <button class="btn btn-ghost branch-toggle" type="button" disabled={!active}
              aria-expanded={active && !!day.branches[node.id]} aria-controls={`branch-${node.id}`}
              onclick={() => onBranch(node.id, !day.branches[node.id])}>
              <span class="branch-diamond" aria-hidden="true">◇</span>
              <span>{node.title}</span><span class="branch-state">{day.branches[node.id] ? '已激活 −' : '未激活 +'}</span>
            </button>
            {#if node.detail}<p class="flow-detail">{node.detail}</p>{/if}
            <div id={`branch-${node.id}`} hidden={!active || !day.branches[node.id]}>
              {#if active && day.branches[node.id]}{@render rows(node.id)}{/if}
            </div>
          </div>
        {:else}
          <div class="flow-task">
            <label class="flow-check">
              <input type="checkbox" class="checkbox checkbox-primary" checked={!!day.completed[node.id]} disabled={!active}
                onchange={(event) => onComplete(node.id, event.currentTarget.checked)} />
              <span class="flow-title">{node.title}</span>
            </label>
            {#if node.startTime}
              <div class="flow-time">
                <time data-clock-anchor={minutes(node.startTime)}>{node.startTime}</time>{#if node.endTime}<span>—</span><time data-clock-anchor={minutes(node.endTime)}>{node.endTime}</time>{/if}
                {#if active && !day.completed[node.id] && clockMinutes >= minutes(node.endTime ?? node.startTime)}
                  <Badge tone="warning">待办</Badge>
                {:else if active && !day.completed[node.id] && clockMinutes >= minutes(node.startTime)}
                  <Badge tone="info">进行时段</Badge>
                {/if}
              </div>
            {/if}
            {#if node.detail}<p class="flow-detail">{node.detail}</p>{/if}
            {#if day.completed[node.id]}<span class="flow-status">已完成</span>{/if}
          </div>
        {/if}
      </li>
    {/each}
  </ol>
{/snippet}
{@render rows(null)}

<style>
  .flow-nodes { list-style: none; padding: 0 0 0 16px; margin: 0; border-left: 2px solid var(--tr-border); }
  .flow-nodes > li { position: relative; padding: 0 0 24px; min-width: 0; }
  .flow-nodes > li::before { content: ''; position: absolute; width: 9px; height: 9px; left: -22px; top: 18px; border-radius: 50%; background: var(--tr-primary); border: 2px solid var(--tr-surface); }
  .flow-nodes > li::after { content: '↓'; position: absolute; left: -23px; bottom: 2px; color: var(--tr-muted); font-size: .875rem; }
  .flow-nodes > li:last-child::after { content: none; }
  .flow-nodes > li.done::before { background: var(--color-success); }
  .flow-nodes > li.inactive::before { background: var(--tr-muted); }
  .nested { margin: 12px 0 0 12px; }
  .flow-check { display: flex; align-items: flex-start; gap: 10px; cursor: pointer; min-height: 44px; padding: 10px 0; }
  .flow-check input { flex-shrink: 0; margin-top: 1px; }
  .flow-title { font-size: 1rem; line-height: 1.5; overflow-wrap: anywhere; }
  .done > .flow-task .flow-title { color: var(--tr-muted); text-decoration: line-through; }
  .flow-detail { white-space: pre-line; overflow-wrap: anywhere; margin: 4px 0 8px; line-height: 1.65; color: var(--tr-muted); font-size: .875rem; }
  .flow-time { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; font-size: .875rem; font-variant-numeric: tabular-nums; color: var(--tr-primary); }
  .flow-status { color: var(--color-success); font-size: .875rem; }
  .branch-toggle { width: 100%; height: auto; min-height: 44px; justify-content: flex-start; padding: 8px 0; white-space: normal; text-align: left; flex-wrap: wrap; font-weight: bold; }
  .branch-state { font-size: .875rem; color: var(--tr-muted); font-weight: normal; }
  .branch-diamond { color: var(--tr-primary); font-size: 1.25rem; }
</style>
