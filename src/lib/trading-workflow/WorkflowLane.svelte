<script lang="ts">
  import { onMount, tick } from 'svelte';
  import ModuleCard from '../../components/ModuleCard.svelte';
  import PanelHeading from '../trading-research/PanelHeading.svelte';
  import Badge from '../trading-research/Badge.svelte';
  import WorkflowTree from './WorkflowTree.svelte';
  import { activeTasks, type Product, type WorkflowNode, type WorkflowDay } from './model';
  let { product, label, nodes, day, clockMinutes, clockTime, onComplete, onBranch, onEnable }: {
    product: Product; label: string; nodes: WorkflowNode[]; day: WorkflowDay; clockMinutes: number; clockTime: string;
    onComplete: (id: string, value: boolean) => void; onBranch: (id: string, value: boolean) => void;
    onEnable: (product: Product, value: boolean) => void;
  } = $props();
  const tasks = $derived(activeTasks(nodes, day, product));
  const completed = $derived(tasks.filter(node => day.completed[node.id]).length);
  let rail: HTMLDivElement;
  let cursor = $state(0);
  let mounted = false;
  function measure() {
    if (!rail) return;
    const rect = rail.getBoundingClientRect();
    const height = Math.max(1, rail.offsetHeight - 26);
    // Only explicit times anchor the clock. Untimed steps never gain invented deadlines.
    const anchors = [{ minute: 480, y: 0 }];
    for (const item of rail.querySelectorAll<HTMLElement>('[data-clock-anchor]')) {
      if (!item.getClientRects().length) continue;
      const minute = Number(item.dataset.clockAnchor);
      if (minute > anchors.at(-1)!.minute && minute < 1080) anchors.push({ minute, y: item.getBoundingClientRect().top - rect.top });
    }
    anchors.push({ minute: 1080, y: height });
    const next = anchors.findIndex(anchor => anchor.minute > clockMinutes);
    if (next === 0) cursor = 0;
    else if (next < 0) cursor = height;
    else {
      const a = anchors[next - 1]!, b = anchors[next]!;
      cursor = a.y + (b.y - a.y) * (clockMinutes - a.minute) / (b.minute - a.minute);
    }
  }
  $effect(() => { void clockMinutes; void day; void nodes; if (mounted) void tick().then(measure); });
  onMount(() => {
    mounted = true;
    const observer = new ResizeObserver(measure);
    if (rail) observer.observe(rail);
    measure();
    return () => { mounted = false; observer.disconnect(); };
  });
</script>

<ModuleCard labelledBy={`lane-${product}`}>
  <PanelHeading id={`lane-${product}`} title={label}>
    <label class="lane-enable"><input type="checkbox" class="checkbox checkbox-primary" checked={day.enabled[product]}
      onchange={(event) => onEnable(product, event.currentTarget.checked)} />今日启用</label>
    <Badge tone={day.enabled[product] ? 'info' : 'neutral'}>{day.enabled[product] ? `${completed} / ${tasks.length}` : '未启用'}</Badge>
  </PanelHeading>
  <div class="lane-body" bind:this={rail}>
    {#if day.enabled[product]}
      <div class="clock-rail" aria-hidden="true"><span class="clock-cursor" style:top={`${cursor}px`}>{clockTime.slice(0, 5)}<i></i></span></div>
      <div class="lane-nodes"><WorkflowTree {nodes} {day} scope={product} {clockMinutes} {onComplete} {onBranch} /></div>
    {/if}
  </div>
</ModuleCard>

<style>
  .lane-enable { display: flex; align-items: center; gap: 8px; min-height: 44px; font-size: .875rem; }
  .lane-body { position: relative; min-width: 0; }
  .clock-rail { position: absolute; top: 0; bottom: 0; left: 0; width: 48px; border-right: 1px dashed var(--tr-border); pointer-events: none; }
  .clock-cursor { position: absolute; right: -5px; display: flex; align-items: center; gap: 4px; color: var(--tr-primary); font-size: .75rem; font-variant-numeric: tabular-nums; background: var(--tr-surface); transition: top .2s linear; }
  .clock-cursor i { width: 8px; height: 8px; border-radius: 50%; background: var(--tr-primary); }
  .lane-nodes { margin-left: 72px; }
  @media (prefers-reduced-motion: reduce) { .clock-cursor { transition: none; } }
  @media (max-width: 1100px) { .lane-nodes { margin-left: 56px; } .clock-rail { width: 34px; } }
</style>
