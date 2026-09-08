<script lang="ts">
	import { untrack } from 'svelte';

	let {
		relative = false,
		scheduleType = 'point',
		startValue = null,
		endValue = null,
		disabled = false,
		label = '节点'
	}: {
		relative?: boolean;
		scheduleType?: string;
		startValue?: string | number | null;
		endValue?: string | number | null;
		disabled?: boolean;
		label?: string;
	} = $props();

	let type = $state('point');
	let startOffset = $state<number | undefined>();
	let endOffset = $state<number | undefined>();
	let startDate = $state('');
	let endDate = $state('');

	function resetValues() {
		type = scheduleType;
		startOffset = startValue == null ? undefined : Number(startValue);
		endOffset = endValue == null ? undefined : Number(endValue);
		startDate = String(startValue ?? '');
		endDate = String(endValue ?? '');
	}
	untrack(resetValues);
	$effect(resetValues);

	function resetWithForm(element: HTMLElement) {
		const form = element.closest('form');
		const reset = () => queueMicrotask(resetValues);
		form?.addEventListener('reset', reset);
		return { destroy: () => form?.removeEventListener('reset', reset) };
	}

	function offsetLabel(value: number | undefined) {
		if (value === undefined) return '待填写';
		return value === 0 ? 'T' : value > 0 ? `T+${value}` : `T${value}`;
	}
</script>

<div class="schedule-fields" use:resetWithForm>
	<label>
		<span>时间配置</span>
		<select name="scheduleType" bind:value={type} {disabled} aria-label={`${label}时间配置`}>
			<option value="point">时点</option>
			<option value="period">时段</option>
		</select>
	</label>
	{#if type === 'period'}
		<label>
			<span>启动时点{relative ? '（天）' : ''}</span>
			{#if relative}
				<input name="startOffsetDays" type="number" min="-3650" max={endOffset ?? 3650} step="1" required bind:value={startOffset} {disabled} aria-label={`${label}启动偏移天数`} />
			{:else}
				<input name="plannedStartDate" type="date" max={endDate || undefined} required bind:value={startDate} {disabled} aria-label={`${label}启动时点`} />
			{/if}
		</label>
	{/if}
	<label>
		<span>{type === 'period' ? '完成时点' : '计划时点'}{relative ? '（天）' : ''}</span>
		{#if relative}
			<input name="offsetDays" type="number" min={type === 'period' ? startOffset ?? -3650 : -3650} max="3650" step="1" required bind:value={endOffset} {disabled} aria-label={`${label}${type === 'period' ? '完成' : '计划'}偏移天数`} />
		{:else}
			<input name="dueDate" type="date" min={type === 'period' ? startDate || undefined : undefined} required={type === 'period'} bind:value={endDate} {disabled} aria-label={`${label}${type === 'period' ? '完成' : '计划'}时点`} />
		{/if}
	</label>
	{#if relative}
		<output class="schedule-preview" aria-live="polite">{type === 'period' ? `${offsetLabel(startOffset)} 至 ${offsetLabel(endOffset)}` : offsetLabel(endOffset)}</output>
	{/if}
</div>

<style>
	.schedule-fields { display: flex; flex-wrap: wrap; align-items: end; gap: 0.75rem; min-width: 0; }
	label { display: grid; flex: 1 1 8.5rem; min-width: 0; gap: 0.3rem; }
	label span { font-size: 0.875rem; font-weight: bold; color: var(--muted); }
	input, select { width: 100%; min-width: 0; min-height: 2.75rem; padding: 0.55rem 0.7rem; border: 1px solid var(--line); border-radius: var(--radius-md, 8px); font-size: 1rem; color: var(--text); background: var(--surface); }
	input:focus-visible, select:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
	.schedule-preview { flex: 1 0 100%; font-size: 0.875rem; color: var(--muted); font-variant-numeric: tabular-nums; }
</style>
