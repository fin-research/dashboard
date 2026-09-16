<script lang="ts">
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import * as Table from "$lib/components/ui/table/index.js";
  import * as Tabs from "$lib/components/ui/tabs/index.js";
  import { NativeSelect } from "$lib/components/ui/native-select/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
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
		<NativeSelect data-ui-owner="lib-financing-DataAdminTable-svelte" class={"ui-select"} aria-label={field.label} data-field={field.key} value={String(formValues[field.key] ?? '')} onchange={(event) => setField(field.key, event.currentTarget.value)}>
			{#if !field.required && !(field.options ?? []).some((choice) => choice.value === '')}<option value="">未设置</option>{/if}
			{#each field.options ?? [] as choice}<option value={choice.value}>{choice.label}</option>{/each}
		</NativeSelect>
	{:else if field.type === 'boolean'}
		<Checkbox data-ui-owner="lib-financing-DataAdminTable-svelte" class="ui-checkbox  cell-checkbox" aria-label={field.label} data-field={field.key} checked={Boolean(formValues[field.key])} onCheckedChange={(checked) => setField(field.key, checked)} />
	{:else}
		<Input data-ui-owner="lib-financing-DataAdminTable-svelte" class={"ui-input"} aria-label={field.label} data-field={field.key} type={field.type === 'textarea' ? 'text' : field.type ?? 'text'} value={String(formValues[field.key] ?? '')} min={field.min} max={field.max} step={field.step} oninput={(event) => setField(field.key, event.currentTarget.value)} />
	{/if}
{/snippet}

<section class="data-editor" aria-label="融资数据表">
	<Tabs.Root value={activeKey} onValueChange={(key) => { const config = DATA_ENTITIES.find(item => item.key === key); if (config) switchEntity(config); }}>
  <Tabs.List class="entity-tabs h-auto w-full justify-start overflow-x-auto rounded-none" aria-label="数据表">
		{#each DATA_ENTITIES as config}
			<Tabs.Trigger value={config.key}>{config.label}</Tabs.Trigger>
		{/each}
	</Tabs.List></Tabs.Root>

	<div class="table-toolbar">
		<form class="search-form" onsubmit={(event) => { event.preventDefault(); applySearch(); }}>
			<label><span class="sr-only">搜索{activeConfig.label}</span><Search size={18} /><Input data-ui-owner="lib-financing-DataAdminTable-svelte" class={"ui-input"} bind:value={search} type="search" /></label>
			<Button data-ui-owner="lib-financing-DataAdminTable-svelte" variant="outline" class={"ui-button"} type="submit">查询</Button>
		</form>
		<div class="table-meta">
			<strong>{total.toLocaleString('zh-CN')} 条</strong>
			<Button data-ui-owner="lib-financing-DataAdminTable-svelte" variant="ghost" type="button" class={"ui-button  icon-action"} aria-label="刷新数据" onclick={() => void loadRows()} disabled={loading}><RefreshCw size={18} class={loading ? 'spin' : ''} /></Button>
		</div>
	</div>

	<div class="table-shell" aria-busy={loading}>
		<Table.Root scrollable={false} class="ui-table">
			<Table.Header>
				{#each table.getHeaderGroups() as headerGroup (headerGroup.id)}
					<Table.Row>
						{#each headerGroup.headers as header (header.id)}
							<Table.Head scope="col"><Button data-ui-owner="lib-financing-DataAdminTable-svelte" variant="outline" type="button" class={"ui-button sort-button"} onclick={() => toggleSort(header.column.id)}><FlexRender {header} />{#if sortKey === header.column.id}{#if sortDirection === 'asc'}<ChevronUp size={15} />{:else}<ChevronDown size={15} />{/if}{/if}</Button></Table.Head>
						{/each}
						<Table.Head scope="col" class="action-column">操作</Table.Head>
					</Table.Row>
				{/each}
			</Table.Header>
			<Table.Body>
				{#if editorMode === 'create'}
					<Table.Row class="editing-row" data-new-row>
						{#each visibleFields as field (field.key)}
							<Table.Cell>{#if canEditField(field, 'create')}{@render fieldEditor(field)}{:else}—{/if}</Table.Cell>
						{/each}
						<Table.Cell class="row-actions"><div>
							<Button data-ui-owner="lib-financing-DataAdminTable-svelte" variant="outline" class={"ui-button"} type="button" aria-label="保存新增行" onclick={() => void saveRow()} disabled={savingKey === '__new__'}>{#if savingKey === '__new__'}<LoaderCircle size={17} class="spin" />{:else}<Check size={17} />{/if}</Button>
							<Button data-ui-owner="lib-financing-DataAdminTable-svelte" variant="outline" class={"ui-button"} type="button" aria-label="取消新增" onclick={cancelEdit} disabled={savingKey === '__new__'}><X size={17} /></Button>
						</div></Table.Cell>
					</Table.Row>
				{/if}
				{#if loading}
					<Table.Row><Table.Cell colspan={visibleFields.length + 1} class="empty-row"><LoaderCircle size={20} class="spin" /> 正在读取…</Table.Cell></Table.Row>
				{:else if table.getRowModel().rows.length === 0 && editorMode !== 'create'}
					<Table.Row><Table.Cell colspan={visibleFields.length + 1} class="empty-row">暂无记录</Table.Cell></Table.Row>
				{:else}
					{#each table.getRowModel().rows as row (rowKey(activeConfig, row.original))}
						{@const identityKey = rowKey(activeConfig, row.original)}
						{@const editing = editorMode === 'edit' && editingKey === identityKey}
						<Table.Row class={editing ? "editing-row" : ""}>
							{#each visibleFields as field (field.key)}
								<Table.Cell
									class={!editing && canEditField(field, 'edit') ? "editable-cell" : ""}
									onclick={(event) => { if (!editing && canEditField(field, 'edit')) void beginEdit(row.original, field.key, event.currentTarget); }}
								>
									{#if editing && canEditField(field, 'edit')}{@render fieldEditor(field)}{:else}{formatDataValue(field, row.original[field.key])}{/if}
								</Table.Cell>
							{/each}
							<Table.Cell class="row-actions"><div>
								{#if editing}
									<Button data-ui-owner="lib-financing-DataAdminTable-svelte" variant="outline" class={"ui-button"} type="button" aria-label="保存本行" onclick={() => void saveRow()} disabled={savingKey === identityKey}>{#if savingKey === identityKey}<LoaderCircle size={17} class="spin" />{:else}<Check size={17} />{/if}</Button>
									<Button data-ui-owner="lib-financing-DataAdminTable-svelte" variant="outline" class={"ui-button"} type="button" aria-label="取消编辑" onclick={cancelEdit} disabled={savingKey === identityKey}><X size={17} /></Button>
								{:else}
									<Button data-ui-owner="lib-financing-DataAdminTable-svelte" variant="outline" class={"ui-button"} type="button" aria-label="编辑本行" onclick={() => void beginEdit(row.original)}><Pencil size={17} /></Button>
									{#if activeConfig.canDelete}<Button data-ui-owner="lib-financing-DataAdminTable-svelte" variant="destructive" type="button" class={"ui-button  danger"} aria-label="删除本行" onclick={() => void deleteRow(row.original)} disabled={savingKey === identityKey}><Trash2 size={17} /></Button>{/if}
								{/if}
							</div></Table.Cell>
						</Table.Row>
					{/each}
				{/if}
			</Table.Body>
		</Table.Root>
	</div>

	<div class="pagination-bar">
		<label>每页 <NativeSelect data-ui-owner="lib-financing-DataAdminTable-svelte" class={"ui-select"} value={pageSize} onchange={(event) => { pageSize = Number(event.currentTarget.value); page = 0; }}><option value="25">25</option><option value="50">50</option><option value="100">100</option></NativeSelect></label>
		<span>第 {page + 1} / {totalPages} 页</span>
		<div><Button data-ui-owner="lib-financing-DataAdminTable-svelte" variant="outline" class={"ui-button"} type="button" aria-label="上一页" onclick={() => goTo(page - 1)} disabled={page === 0 || loading}><ChevronLeft size={18} /></Button><Button data-ui-owner="lib-financing-DataAdminTable-svelte" variant="outline" class={"ui-button"} type="button" aria-label="下一页" onclick={() => goTo(page + 1)} disabled={page + 1 >= totalPages || loading}><ChevronRight size={18} /></Button></div>
	</div>
</section>

{#if activeConfig.canCreate && !activeConfig.readOnly}
	<Button data-ui-owner="lib-financing-DataAdminTable-svelte" variant="default" class={"ui-button  floating-create-button data-create"} type="button" aria-label="新增一行" onclick={() => void beginCreate()} disabled={loading || editorMode !== null}><Plus size={24} /></Button>
{/if}

<style>
  .data-editor { min-width: 0; overflow: hidden; border: 1px solid var(--line); border-radius: 1rem; background: var(--surface); }
  :global(.data-editor .entity-tabs) { padding: .75rem 1rem; border-bottom: 1px solid var(--line); }
  .table-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .75rem 1rem; }
  .search-form { display: flex; align-items: center; gap: .5rem; min-width: min(100%, 26rem); }
  .search-form label { display: flex; flex: 1; align-items: center; gap: .5rem; min-width: 0; }
  .table-meta { display: flex; align-items: center; gap: .75rem; white-space: nowrap; }
  .table-shell { min-width: 0; max-width: 100%; overflow: auto; border-block: 1px solid var(--line); }
  :global(.data-editor table) { width: max(100%, 70rem); border-collapse: collapse; font-size: 1rem; }
  :global(.data-editor th), :global(.data-editor td) { padding: .75rem; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); text-align: left; vertical-align: middle; white-space: nowrap; font-variant-numeric: tabular-nums; }
  :global(.data-editor th) { position: sticky; top: 0; z-index: 2; background: #f8fafc; color: var(--ink); font-weight: bold; }
  :global(.data-editor tbody tr:hover) { background: #f8fbff; }
  :global(.data-editor .editing-row) { background: var(--brand-soft); }
  :global(.data-editor .editable-cell) { cursor: text; }
  :global(.data-editor .editable-cell:hover) { box-shadow: inset 0 0 0 1px var(--border-strong); }
  :global(.data-editor .sort-button) { gap: .25rem; width: 100%; padding: 0; border: 0; background: transparent; justify-content: flex-start; }
  :global(.data-editor .action-column) { position: sticky; right: 0; z-index: 3; min-width: 7rem; }
  :global(.data-editor .row-actions) { position: sticky; right: 0; z-index: 1; background: inherit; }
  :global(.data-editor .row-actions > div) { display: flex; align-items: center; justify-content: center; gap: .375rem; }
  :global(.data-editor .row-actions button), :global(.data-editor .icon-action) { width: 44px; padding: 0; }
  :global(.data-editor td input:not([type='checkbox'])), :global(.data-editor td select) { width: max(100%, 8rem); padding: .375rem .5rem; }
  :global(.data-editor .cell-checkbox) { display: block; width: 1.25rem; margin: auto; }
  :global(.data-editor .empty-row) { height: 8rem; text-align: center; color: var(--text-muted); }
  :global(.data-editor .empty-row svg) { display: inline-block; vertical-align: middle; margin-right: .375rem; }
  .pagination-bar { display: flex; align-items: center; justify-content: flex-end; gap: 1rem; padding: .75rem 1rem; }
  .pagination-bar label, .pagination-bar > div { display: flex; align-items: center; gap: .5rem; }
  :global(.data-create) { z-index: 15; }
  :global(.spin) { animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (max-width: 64rem) { .table-toolbar { align-items: stretch; flex-direction: column; } .table-meta { justify-content: flex-end; } }
  @media (max-width: 35rem) { .table-toolbar, .pagination-bar { padding-inline: .75rem; } .search-form { min-width: 0; } .pagination-bar { justify-content: space-between; flex-wrap: wrap; } }
  @media (prefers-reduced-motion: reduce) { :global(.spin) { animation: none; } }
</style>
