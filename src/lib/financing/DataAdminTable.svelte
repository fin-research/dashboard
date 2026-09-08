<script lang="ts">
	import { tick } from 'svelte';
	import { createTable, FlexRender, tableFeatures, type ColumnDef } from '@tanstack/svelte-table';
	import {
		Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
		LoaderCircle, Pencil, Plus, RefreshCw, Search, Trash2, X
	} from '@lucide/svelte';
	import { globalMessages } from '$lib/global-messages';
	import {
		DATA_ENTITIES, formatDataValue, valueForDatabase, valueForEditor,
		type DataRow, type EntityConfig, type FieldConfig
	} from './data-admin';
	import { NeonDataApi } from './neon-data-api';

	const features = tableFeatures({});
	const firstEntity = DATA_ENTITIES[0];
	if (!firstEntity) throw new Error('数据后台实体配置为空');
	let activeKey = $state(firstEntity.key);
	let rows = $state<DataRow[]>([]);
	let total = $state(0);
	let page = $state(0);
	let pageSize = $state(50);
	let search = $state('');
	let appliedSearch = $state('');
	let sortKey = $state(firstEntity.defaultSort.key);
	let sortDirection = $state<'asc' | 'desc'>(firstEntity.defaultSort.direction);
	let loading = $state(true);
	let savingKey = $state<string | null>(null);
	let editorMode = $state<'create' | 'edit' | null>(null);
	let editingKey = $state<string | null>(null);
	let originalRow = $state<DataRow | null>(null);
	let formValues = $state<Record<string, unknown>>({});
	const api = new NeonDataApi();

	const activeConfig = $derived(DATA_ENTITIES.find((item) => item.key === activeKey) ?? firstEntity);
	const visibleFields = $derived(activeConfig.fields.filter((field) => field.table !== false));
	const totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));
	const columns = $derived(visibleFields.map((field) => ({
		accessorKey: field.key,
		header: field.label
	})) as ColumnDef<typeof features, DataRow>[]);
	const table = createTable({
		features,
		get columns() { return columns; },
		get data() { return rows; }
	});

	$effect(() => {
		void loadRows();
	});

	async function loadRows() {
		loading = true;
		cancelEdit();
		try {
			const result = await api.list(activeConfig, {
				page, pageSize, sortKey, sortDirection, search: appliedSearch
			});
			rows = result.rows;
			total = result.total;
			if (page > 0 && !rows.length && total > 0) {
				page = Math.max(0, Math.ceil(total / pageSize) - 1);
				await loadRows();
			}
		} catch (error) {
			globalMessages.error(error instanceof Error ? error.message : String(error), {
				key: 'data-admin-load',
				title: '数据读取失败'
			});
			rows = [];
			total = 0;
		} finally {
			loading = false;
		}
	}

	function rowKey(config: EntityConfig, row: DataRow) {
		return config.primaryKeys.map((key) => String(row[key] ?? '')).join(':');
	}

	function switchEntity(config: EntityConfig) {
		activeKey = config.key;
		page = 0;
		search = '';
		appliedSearch = '';
		sortKey = config.defaultSort.key;
		sortDirection = config.defaultSort.direction;
		cancelEdit();
	}

	function applySearch() {
		page = 0;
		appliedSearch = search.trim();
	}

	function toggleSort(key: string) {
		if (sortKey === key) sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
		else {
			sortKey = key;
			sortDirection = 'asc';
		}
		page = 0;
	}

	function canEditField(field: FieldConfig, mode: 'create' | 'edit') {
		return !field.readOnly && field.form !== false && !(mode === 'edit' && activeConfig.primaryKeys.includes(field.key));
	}

	function editorValues(row: DataRow | null, mode: 'create' | 'edit') {
		return Object.fromEntries(activeConfig.fields
			.filter((field) => canEditField(field, mode))
			.map((field) => [field.key, row ? valueForEditor(field, row[field.key]) : field.type === 'boolean' ? false : '']));
	}

	async function focusEditor(cell?: HTMLTableCellElement, fieldKey?: string) {
		await tick();
		const target = fieldKey
			? cell?.querySelector<HTMLElement>(`[data-field="${fieldKey}"]`)
			: document.querySelector<HTMLElement>('[data-new-row] input:not([type="checkbox"]), [data-new-row] select');
		target?.focus();
	}

	async function beginEdit(row: DataRow, fieldKey?: string, cell?: HTMLTableCellElement) {
		if (activeConfig.readOnly) return;
		editorMode = 'edit';
		editingKey = rowKey(activeConfig, row);
		originalRow = row;
		formValues = editorValues(row, 'edit');
		await focusEditor(cell, fieldKey);
	}

	async function beginCreate() {
		if (!activeConfig.canCreate || activeConfig.readOnly) return;
		editorMode = 'create';
		editingKey = '__new__';
		originalRow = null;
		formValues = editorValues(null, 'create');
		await focusEditor();
	}

	function cancelEdit() {
		editorMode = null;
		editingKey = null;
		originalRow = null;
		formValues = {};
	}

	function setField(key: string, value: unknown) {
		formValues = { ...formValues, [key]: value };
	}

	function payload(mode: 'create' | 'edit') {
		const result: DataRow = {};
		for (const field of activeConfig.fields) {
			if (!canEditField(field, mode)) continue;
			const raw = formValues[field.key];
			if (mode === 'create' && field.omitWhenEmptyOnCreate && (raw === '' || raw == null)) continue;
			const value = valueForDatabase(field, raw);
			if (field.required && (value === null || value === '')) throw new Error(`请填写${field.label}`);
			result[field.key] = value;
		}
		return result;
	}

	function compareValues(left: unknown, right: unknown) {
		if (left == null || left === '') return right == null || right === '' ? 0 : 1;
		if (right == null || right === '') return -1;
		const leftNumber = Number(left);
		const rightNumber = Number(right);
		const comparison = Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
			? leftNumber - rightNumber
			: String(left).localeCompare(String(right), 'zh-CN', { numeric: true });
		return sortDirection === 'asc' ? comparison : -comparison;
	}

	function sortCurrentRows(nextRows: DataRow[]) {
		return [...nextRows].sort((left, right) => compareValues(left[sortKey], right[sortKey]));
	}

	async function saveRow() {
		if (!editorMode) return;
		const currentKey = editingKey ?? '__new__';
		savingKey = currentKey;
		try {
			const values = payload(editorMode);
			if (editorMode === 'create') {
				const savedRows = await api.insert(activeConfig, values);
				if (!savedRows[0]) throw new Error('新增失败');
				rows = sortCurrentRows([savedRows[0], ...rows]).slice(0, pageSize);
				total += 1;
			} else if (originalRow) {
				const savedRows = await api.update(activeConfig, originalRow, values);
				const saved = savedRows[0];
				if (!saved) throw new Error('保存未返回更新记录，请重试');
				const originalKey = rowKey(activeConfig, originalRow);
				rows = sortCurrentRows(rows.map((row) => rowKey(activeConfig, row) === originalKey ? saved : row));
			}
			cancelEdit();
			globalMessages.success('已保存', { key: 'data-admin-mutation', title: '数据已更新' });
		} catch (error) {
			globalMessages.error(error instanceof Error ? error.message : String(error), {
				key: 'data-admin-mutation'
			});
		} finally {
			savingKey = null;
		}
	}

	async function deleteRow(row: DataRow) {
		if (!activeConfig.canDelete || activeConfig.readOnly) return;
		const identity = activeConfig.primaryKeys.map((key) => `${key}=${String(row[key])}`).join('，');
		if (!confirm(`确定删除？\n${identity}`)) return;
		const identityKey = rowKey(activeConfig, row);
		savingKey = identityKey;
		try {
			await api.delete(activeConfig, row);
			rows = rows.filter((item) => rowKey(activeConfig, item) !== identityKey);
			total = Math.max(0, total - 1);
			if (editingKey === identityKey) cancelEdit();
			globalMessages.success('已删除', { key: 'data-admin-mutation', title: '数据已更新' });
		} catch (error) {
			globalMessages.error(error instanceof Error ? error.message : String(error), {
				key: 'data-admin-mutation'
			});
		} finally {
			savingKey = null;
		}
	}

	function goTo(nextPage: number) {
		page = Math.min(Math.max(nextPage, 0), totalPages - 1);
	}
</script>

{#snippet fieldEditor(field: FieldConfig)}
	{#if field.type === 'select'}
		<select class="select" aria-label={field.label} data-field={field.key} value={String(formValues[field.key] ?? '')} onchange={(event) => setField(field.key, event.currentTarget.value)}>
			{#if !field.required && !(field.options ?? []).some((choice) => choice.value === '')}<option value="">未设置</option>{/if}
			{#each field.options ?? [] as choice}<option value={choice.value}>{choice.label}</option>{/each}
		</select>
	{:else if field.type === 'boolean'}
		<input class="checkbox checkbox-primary cell-checkbox" aria-label={field.label} data-field={field.key} type="checkbox" checked={Boolean(formValues[field.key])} onchange={(event) => setField(field.key, event.currentTarget.checked)} />
	{:else}
		<input class="input" aria-label={field.label} data-field={field.key} type={field.type === 'textarea' ? 'text' : field.type ?? 'text'} value={String(formValues[field.key] ?? '')} min={field.min} max={field.max} step={field.step} oninput={(event) => setField(field.key, event.currentTarget.value)} />
	{/if}
{/snippet}

<section class="data-editor" aria-label="融资数据表">
	<div class="entity-tabs" role="tablist" aria-label="数据表">
		{#each DATA_ENTITIES as config}
			<button class="btn" type="button" role="tab" aria-selected={activeKey === config.key} class:btn-active={activeKey === config.key} onclick={() => switchEntity(config)}>{config.label}</button>
		{/each}
	</div>

	<div class="table-toolbar">
		<form class="search-form" onsubmit={(event) => { event.preventDefault(); applySearch(); }}>
			<label><span class="sr-only">搜索{activeConfig.label}</span><Search size={18} /><input class="input" bind:value={search} type="search" placeholder={`搜索${activeConfig.label}`} /></label>
			<button class="btn" type="submit">查询</button>
		</form>
		<div class="table-meta">
			<strong>{total.toLocaleString('zh-CN')} 条</strong>
			<button type="button" class="btn btn-ghost icon-action" aria-label="刷新数据" title="刷新数据" onclick={() => void loadRows()} disabled={loading}><RefreshCw size={18} class={loading ? 'spin' : ''} /></button>
		</div>
	</div>

	<div class="table-shell" aria-busy={loading}>
		<table class="table">
			<thead>
				{#each table.getHeaderGroups() as headerGroup (headerGroup.id)}
					<tr>
						{#each headerGroup.headers as header (header.id)}
							<th scope="col"><button type="button" class="btn sort-button" onclick={() => toggleSort(header.column.id)}><FlexRender {header} />{#if sortKey === header.column.id}{#if sortDirection === 'asc'}<ChevronUp size={15} />{:else}<ChevronDown size={15} />{/if}{/if}</button></th>
						{/each}
						<th scope="col" class="action-column">操作</th>
					</tr>
				{/each}
			</thead>
			<tbody>
				{#if editorMode === 'create'}
					<tr class="editing-row" data-new-row>
						{#each visibleFields as field (field.key)}
							<td>{#if canEditField(field, 'create')}{@render fieldEditor(field)}{:else}—{/if}</td>
						{/each}
						<td class="row-actions"><div>
							<button class="btn" type="button" aria-label="保存新增行" title="保存" onclick={() => void saveRow()} disabled={savingKey === '__new__'}>{#if savingKey === '__new__'}<LoaderCircle size={17} class="spin" />{:else}<Check size={17} />{/if}</button>
							<button class="btn" type="button" aria-label="取消新增" title="取消" onclick={cancelEdit} disabled={savingKey === '__new__'}><X size={17} /></button>
						</div></td>
					</tr>
				{/if}
				{#if loading}
					<tr><td colspan={visibleFields.length + 1} class="empty-row"><LoaderCircle size={20} class="spin" /> 正在读取…</td></tr>
				{:else if table.getRowModel().rows.length === 0 && editorMode !== 'create'}
					<tr><td colspan={visibleFields.length + 1} class="empty-row">暂无记录</td></tr>
				{:else}
					{#each table.getRowModel().rows as row (rowKey(activeConfig, row.original))}
						{@const identityKey = rowKey(activeConfig, row.original)}
						{@const editing = editorMode === 'edit' && editingKey === identityKey}
						<tr class:editing-row={editing}>
							{#each visibleFields as field (field.key)}
								<td
									class:editable-cell={!editing && canEditField(field, 'edit')}
									onclick={(event) => { if (!editing && canEditField(field, 'edit')) void beginEdit(row.original, field.key, event.currentTarget); }}
								>
									{#if editing && canEditField(field, 'edit')}{@render fieldEditor(field)}{:else}{formatDataValue(field, row.original[field.key])}{/if}
								</td>
							{/each}
							<td class="row-actions"><div>
								{#if editing}
									<button class="btn" type="button" aria-label="保存本行" title="保存" onclick={() => void saveRow()} disabled={savingKey === identityKey}>{#if savingKey === identityKey}<LoaderCircle size={17} class="spin" />{:else}<Check size={17} />{/if}</button>
									<button class="btn" type="button" aria-label="取消编辑" title="取消" onclick={cancelEdit} disabled={savingKey === identityKey}><X size={17} /></button>
								{:else}
									<button class="btn" type="button" aria-label="编辑本行" title="编辑" onclick={() => void beginEdit(row.original)}><Pencil size={17} /></button>
									{#if activeConfig.canDelete}<button type="button" class="btn btn-error danger" aria-label="删除本行" title="删除" onclick={() => void deleteRow(row.original)} disabled={savingKey === identityKey}><Trash2 size={17} /></button>{/if}
								{/if}
							</div></td>
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>

	<div class="pagination-bar">
		<label>每页 <select class="select" value={pageSize} onchange={(event) => { pageSize = Number(event.currentTarget.value); page = 0; }}><option value="25">25</option><option value="50">50</option><option value="100">100</option></select></label>
		<span>第 {page + 1} / {totalPages} 页</span>
		<div><button class="btn" type="button" aria-label="上一页" onclick={() => goTo(page - 1)} disabled={page === 0 || loading}><ChevronLeft size={18} /></button><button class="btn" type="button" aria-label="下一页" onclick={() => goTo(page + 1)} disabled={page + 1 >= totalPages || loading}><ChevronRight size={18} /></button></div>
	</div>
</section>

{#if activeConfig.canCreate && !activeConfig.readOnly}
	<button class="btn btn-primary floating-create-button data-create" type="button" aria-label="新增一行" title="新增一行" onclick={() => void beginCreate()} disabled={loading || editorMode !== null}><Plus size={24} /></button>
{/if}

<style>
	.data-editor { min-width: 0; overflow: hidden; border: 1px solid var(--line); border-radius: .625rem; background: var(--surface); box-shadow: var(--shadow); }
	.entity-tabs { display: flex; gap: .25rem; overflow-x: auto; padding: .75rem 1rem 0; border-bottom: 1px solid var(--line); }
	.entity-tabs button { padding: .625rem .875rem; white-space: nowrap; }
	.table-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .75rem 1rem; }
	.search-form { display: flex; align-items: center; gap: .5rem; min-width: min(100%, 26rem); }
	.search-form label { display: flex; flex: 1; align-items: center; gap: .5rem; min-height: 2.75rem; padding: 0 .75rem; border: 1px solid var(--line); border-radius: .5rem; background: #fff; }
	.search-form label :global(svg) { display: block; flex: 0 0 auto; }
	.search-form input { width: 100%; min-width: 0; }
	.search-form button, .pagination-bar button, .icon-action, .row-actions button { min-width: 2.75rem; }
	.search-form button { padding-inline: .875rem; }
	.icon-action, .pagination-bar button, .row-actions button, .data-create { display: inline-grid; place-items: center; padding: 0; }
	.icon-action :global(svg), .pagination-bar button :global(svg), .row-actions button :global(svg), .data-create :global(svg) { display: block; }
	.table-meta { display: flex; align-items: center; gap: .75rem; white-space: nowrap; }
	.table-shell { min-width: 0; max-width: 100%; overflow: auto; border-block: 1px solid var(--line); }
	table { width: max(100%, 70rem); border-collapse: collapse; font-size: 1rem; }
	th, td { padding: .75rem; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); text-align: left; vertical-align: middle; white-space: nowrap; font-variant-numeric: tabular-nums; }
	th { position: sticky; top: 0; z-index: 2; background: #f8fafc; color: var(--ink); }
	tbody tr:hover { background: #f8fbff; }
	.editing-row { background: var(--blue-soft); }
	.editable-cell { cursor: text; }
	.editable-cell:hover { box-shadow: inset 0 0 0 1px #b2ccff; }
	.sort-button { display: inline-flex; align-items: center; gap: .25rem; width: 100%; padding: 0; }
	.action-column { position: sticky; right: 0; z-index: 3; min-width: 7rem; }
	.row-actions { position: sticky; right: 0; z-index: 1; background: inherit; }
	.row-actions > div { display: flex; align-items: center; justify-content: center; gap: .375rem; }
	.row-actions button { min-width: 2.75rem; }
	td input:not([type='checkbox']), td select { width: max(100%, 8rem); padding: .375rem .5rem; }
	td .cell-checkbox { display: block; width: 1.25rem; margin: auto; }
	.empty-row { height: 8rem; text-align: center; color: var(--muted); }
	.empty-row :global(svg) { display: inline-block; vertical-align: middle; margin-right: .375rem; }
	.pagination-bar { display: flex; align-items: center; justify-content: flex-end; gap: 1rem; padding: .75rem 1rem; }
	.pagination-bar label, .pagination-bar > div { display: flex; align-items: center; gap: .5rem; }
	.pagination-bar select { padding-inline: .5rem; }
	.data-create { z-index: 15; }
	:global(.spin) { animation: spin .8s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
	@media (max-width: 64rem) { .table-toolbar { align-items: stretch; flex-direction: column; } .table-meta { justify-content: flex-end; } }
	@media (max-width: 35rem) {
		.entity-tabs, .table-toolbar, .pagination-bar { padding-inline: .75rem; }
		.search-form { min-width: 0; }
		.pagination-bar { justify-content: space-between; flex-wrap: wrap; }
	}
	@media (prefers-reduced-motion: reduce) { :global(.spin) { animation: none; } }
</style>
