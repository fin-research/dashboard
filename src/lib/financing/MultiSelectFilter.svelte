<script lang="ts">
	let {
		label,
		options,
		values = $bindable([]),
		allLabel = '全部',
		optionLabels = {}
	}: {
		label: string;
		options: string[];
		values: string[];
		allLabel?: string;
		optionLabels?: Record<string, string>;
	} = $props();

	const summary = $derived(
		values.length === 0
			? allLabel
			: values.length === 1
				? values[0]
				: `已选 ${values.length} 项`
	);

	function toggle(option: string) {
		values = values.includes(option)
			? values.filter((value) => value !== option)
			: [...values, option];
	}
</script>

<div class="multi-filter">
	<span class="filter-label">{label}</span>
	<details>
		<summary aria-label={`${label}：${summary}`}>
			<span>{summary}</span>
			<span class="chevron" aria-hidden="true"></span>
		</summary>
		<div class="filter-popover">
			<button
				type="button"
				class:active={values.length === 0}
				aria-pressed={values.length === 0}
				onclick={() => (values = [])}
			>
				<span class="checkbox-mark" aria-hidden="true">{values.length === 0 ? '✓' : ''}</span>
				{allLabel}
			</button>
			{#each options as option}
				<button
					type="button"
					class:active={values.includes(option)}
					aria-pressed={values.includes(option)}
					onclick={() => toggle(option)}
				>
					<span class="checkbox-mark" aria-hidden="true">{values.includes(option) ? '✓' : ''}</span>
					{optionLabels[option] ?? option}
				</button>
			{/each}
		</div>
	</details>
</div>

<style>
	.multi-filter {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.filter-label {
		font-size: 0.75rem;
		font-weight: 650;
		color: #667085;
		white-space: nowrap;
	}

	details {
		position: relative;
	}

	summary {
		display: flex;
		min-width: 8.5rem;
		min-height: 2.5rem;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0 0.75rem;
		border: 1px solid #d0d5dd;
		border-radius: 0.5rem;
		color: #344054;
		background: #fff;
		cursor: pointer;
		list-style: none;
	}

	summary::-webkit-details-marker {
		display: none;
	}

	summary:hover,
	details[open] summary {
		border-color: #84adf8;
		background: #f8faff;
	}

	.chevron {
		width: 0.5rem;
		height: 0.5rem;
		border-right: 2px solid #667085;
		border-bottom: 2px solid #667085;
		transform: rotate(45deg) translateY(-0.125rem);
		transition: transform 180ms ease;
	}

	details[open] .chevron {
		transform: rotate(225deg) translate(-0.125rem, -0.125rem);
	}

	.filter-popover {
		position: absolute;
		z-index: 40;
		top: calc(100% + 0.375rem);
		left: 0;
		display: grid;
		width: max(100%, 12rem);
		max-height: min(20rem, 60vh);
		overflow-y: auto;
		padding: 0.375rem;
		border: 1px solid var(--border);
		border-radius: 0.625rem;
		background: #fff;
		box-shadow: 0 0.75rem 2rem rgb(16 24 40 / 16%);
	}

	.filter-popover button {
		display: grid;
		grid-template-columns: 1.25rem minmax(0, 1fr);
		min-height: 2.5rem;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.5rem;
		border: 0;
		border-radius: 0.375rem;
		text-align: left;
		color: #344054;
		background: transparent;
	}

	.filter-popover button:hover {
		background: #f2f4f7;
	}

	.filter-popover button.active {
		font-weight: 650;
		color: var(--color-primary);
		background: #eff4ff;
	}

	.checkbox-mark {
		display: grid;
		width: 1.125rem;
		height: 1.125rem;
		place-items: center;
		border: 1px solid #98a2b3;
		border-radius: 0.25rem;
		font-size: 0.75rem;
		line-height: 1;
	}

	button.active .checkbox-mark {
		border-color: var(--color-primary);
		color: #fff;
		background: var(--color-primary);
	}

	@media (max-width: 51.25rem) {
		.multi-filter {
			align-items: stretch;
			flex-direction: column;
			gap: 0.25rem;
		}

		summary {
			width: 100%;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.chevron {
			transition: none;
		}
	}
</style>
