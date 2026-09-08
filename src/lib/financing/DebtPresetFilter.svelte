<script lang="ts">
	import MultiSelectFilter from './MultiSelectFilter.svelte';

	type Preset = { key: string; label: string; exclude: string[] };

	let {
		options,
		presets,
		preset = $bindable('all'),
		values = $bindable([]),
		ariaLabel = '筛选视图',
		note = '',
		compact = false
	}: {
		options: string[];
		presets: Preset[];
		preset: string;
		values: string[];
		ariaLabel?: string;
		note?: string;
		compact?: boolean;
	} = $props();

	const optionLabels = {
		'浮动收益凭证': '浮收',
		'固定收益凭证': '固收'
	};
	let expectedSignature = $state<string | null>(null);
	const signature = (items: string[]) => [...items].sort().join('|');

	function applyPreset(key: string) {
		preset = key;
		const selected = presets.find((item) => item.key === key);
		values = !selected || selected.exclude.length === 0
			? []
			: options.filter((option) => !selected.exclude.includes(option));
		expectedSignature = signature(values);
	}

	$effect(() => {
		const current = signature(values);
		if (expectedSignature === null) expectedSignature = current;
		if (preset !== 'custom' && current !== expectedSignature) preset = 'custom';
	});
</script>

<section class="debt-filter" class:compact={compact} aria-label={ariaLabel}>
	<label>
		{#if !compact}<span>预设</span>{/if}
		<select value={preset} onchange={(event) => applyPreset(event.currentTarget.value)}>
			{#each presets as item}
				<option value={item.key}>{item.label}</option>
			{/each}
			<option value="custom">自定义</option>
		</select>
	</label>
	<MultiSelectFilter
		label="负债品种"
		options={options}
		bind:values
		allLabel="全部品种"
		{optionLabels}
	/>
</section>

<style>
	.debt-filter {
		display: flex;
		min-height: 4rem;
		align-items: center;
		gap: 1rem;
		padding: 0.6875rem 1rem;
		border: 1px solid #dfe5ee;
		border-left: 0.25rem solid #2563eb;
		border-radius: 0.625rem;
		background: linear-gradient(90deg, #f8fbff, #fff 35%);
		box-shadow: 0 0.1875rem 0.75rem rgb(15 23 42 / 4%);
	}

	label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	label span {
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		color: #526071;
	}

	select {
		min-width: 13.5rem;
		min-height: 2.5rem;
		padding: 0 2rem 0 0.75rem;
		border: 1px solid #cbd5e1;
		border-radius: 0.5rem;
		color: #1e293b;
		background: #fff;
		transition: border-color 160ms ease, box-shadow 160ms ease;
	}

	select:hover {
		border-color: #94a3b8;
	}

	.debt-filter.compact {
		min-height: 0;
		padding: 0;
		border: 0;
		border-radius: 0;
		background: none;
		box-shadow: none;
	}

	.debt-filter.compact select {
		min-width: 12rem;
	}

	@media (max-width: 64rem) {
		.debt-filter {
			align-items: stretch;
			flex-wrap: wrap;
		}
	}

	@media (max-width: 35rem) {
		.debt-filter,
		label {
			align-items: stretch;
			flex-direction: column;
		}

		select {
			width: 100%;
		}
	}
</style>
