<script lang="ts">
	import '../../management.css';
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import { tick, untrack } from 'svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import {
		ArrowLeft,
		GitBranch,
		GripVertical,
		Plus,
		Trash2,
		X
	} from '@lucide/svelte';
	import { autoSave, completeAutoSave, getAutoSaveRevision } from '$lib/financing/auto-save';
	import { globalMessages } from '$lib/global-messages';
	import { withBase } from '$lib/financing/app-paths';
	import { hasSameOrder, reorderByOffset, reorderRelative } from '$lib/financing/reorder-items.js';
	import { hasPermission } from '$lib/permissions';

	type SopNode = {
		id: string;
		name: string;
		description: string;
		sortOrder: number;
		offsetDays: number;
		ownerRole: string;
	};

	let { data, form } = $props();
	const initialData = untrack(() => data);
	let template = $state({
		...initialData.template,
		description: initialData.template.description ?? ''
	});
	let nodes = $state<SopNode[]>(initialData.nodes.map(normaliseNode));
	let loadedTemplateId = $state(String(initialData.template.id));
	let pendingActions = $state<string[]>([]);
	const pendingAction = $derived(pendingActions.at(-1) ?? '');
	let handledForm = $state<unknown>(null);
	let suppressFormFeedback = $state(false);
	let addNodeDialog = $state<HTMLDialogElement>();
	let addNodeNameInput = $state<HTMLInputElement>();
	let reorderForm: HTMLFormElement;
	let draggedNodeId = $state<string | null>(null);
	let pointerId = $state<number | null>(null);
	let pointerStartY = $state(0);
	let dragSnapshotIds = $state<string[]>([]);
	let dragChanged = $state(false);
	let keyboardGrabbedId = $state<string | null>(null);
	let reorderAnnouncement = $state('');
	const canManage = $derived(hasPermission(data?.permissions, 'financing.sop:update'));
	const canDelete = $derived(hasPermission(data?.permissions, 'financing.sop:delete'));
	$effect(() => {
		if (!form?.message || suppressFormFeedback || handledForm === form) return;
		handledForm = form;
		const message = String(form.message);
		if (form.success) globalMessages.success(message, { key: 'sop-detail-action' });
		else globalMessages.error(message, { key: 'sop-detail-action' });
	});

	$effect(() => {
		if (String(data.template.id) === loadedTemplateId) return;
		loadedTemplateId = String(data.template.id);
		template = { ...data.template, description: data.template.description ?? '' };
		nodes = data.nodes.map(normaliseNode);
	});

	function normaliseNode(node: any): SopNode {
		return {
			...node,
			description: node.description ?? '',
			ownerRole: node.ownerRole ?? '',
			offsetDays: Number(node.offsetDays ?? 0),
			sortOrder: Number(node.sortOrder ?? 0)
		};
	}

	function currentOrder() {
		return nodes.map((node) => node.id);
	}

	function applyOrder(orderedNodeIds: string[]) {
		const byId = new Map(nodes.map((node) => [node.id, node]));
		const ordered = orderedNodeIds.map((id) => byId.get(id)).filter(Boolean) as SopNode[];
		if (ordered.length !== nodes.length) return;
		nodes = ordered.map((node, index) => ({ ...node, sortOrder: index + 1 }));
	}

	function applyActionData(resultData: any) {
		if (typeof resultData?.isActive === 'boolean') {
			template.isActive = resultData.isActive;
		}
		if (resultData?.template) {
			template = {
				...resultData.template,
				description: resultData.template.description ?? ''
			};
		}
		if (resultData?.node) {
			const returnedNode = normaliseNode(resultData.node);
			const index = nodes.findIndex((node) => node.id === returnedNode.id);
			if (index >= 0) {
				nodes = nodes.map((node) => node.id === returnedNode.id ? returnedNode : node);
			} else {
				nodes = [...nodes, returnedNode];
			}
		}
		if (resultData?.deletedNodeId) {
			nodes = nodes.filter((node) => node.id !== String(resultData.deletedNodeId));
		}
		if (Array.isArray(resultData?.orderedNodeIds)) {
			applyOrder(resultData.orderedNodeIds.map(String));
		} else {
			nodes = nodes.map((node, index) => ({ ...node, sortOrder: index + 1 }));
		}
	}

	const enhanceForm = (
		label: string,
		options: { resetOnSuccess?: boolean; closeOnSuccess?: boolean; rollbackOrderOnFailure?: boolean; autoSave?: boolean } = {}
	): SubmitFunction => ({ formElement }) => {
		pendingActions = [...pendingActions.filter((item) => item !== label), label];
		const submittedRevision = getAutoSaveRevision(formElement);
		suppressFormFeedback = true;
		return async ({ result, update }) => {
			try {
				if (result.type === 'success') {
					const responseIsCurrent = !options.autoSave || submittedRevision === getAutoSaveRevision(formElement);
					if (responseIsCurrent) applyActionData(result.data);
					await update({ reset: false, invalidateAll: false });
					if (responseIsCurrent && result.data?.refreshReminders) {
						await invalidate('financing:reminders');
					}
					if (options.autoSave) {
						if (responseIsCurrent) {
							globalMessages.success('已保存', {
								key: 'sop-detail-auto-save',
								duration: 3000,
								title: 'SOP 已同步'
							});
						}
						completeAutoSave(formElement, true);
					} else {
						globalMessages.success(String(result.data?.message ?? '保存成功'), {
							key: 'sop-detail-action'
						});
					}
					if (options.resetOnSuccess) formElement.reset();
					if (options.closeOnSuccess) addNodeDialog?.close();
					return;
				}
				if (options.rollbackOrderOnFailure) applyOrder(dragSnapshotIds);
				await update({ reset: false, invalidateAll: false });
				const message = result.type === 'failure'
					? String(result.data?.message ?? '保存失败，请检查填写内容后重试')
					: result.type === 'error' && result.error?.message
						? result.error.message
						: '保存失败，请稍后重试';
				globalMessages.error(message, {
					key: options.autoSave ? 'sop-detail-auto-save' : 'sop-detail-action'
				});
				if (options.autoSave) completeAutoSave(formElement, false);
			} finally {
				pendingActions = pendingActions.filter((item) => item !== label);
			}
		};
	};

	function openAddNode() {
		if (!canManage) return;
		addNodeDialog?.showModal();
		queueMicrotask(() => addNodeNameInput?.focus());
	}

	function announcePosition(nodeId: string) {
		const index = nodes.findIndex((node) => node.id === nodeId);
		const node = nodes[index];
		if (node) reorderAnnouncement = `${node.name}，当前位置第 ${index + 1} 项，共 ${nodes.length} 项`;
	}

	function beginPointerDrag(event: PointerEvent, nodeId: string) {
		if (!canManage || event.button !== 0 || pendingAction) return;
		const handle = event.currentTarget as HTMLButtonElement;
		handle.setPointerCapture(event.pointerId);
		pointerId = event.pointerId;
		pointerStartY = event.clientY;
		draggedNodeId = nodeId;
		dragSnapshotIds = currentOrder();
		dragChanged = false;
	}

	function continuePointerDrag(event: PointerEvent) {
		if (pointerId !== event.pointerId || !draggedNodeId) return;
		if (!dragChanged && Math.abs(event.clientY - pointerStartY) < 6) return;
		event.preventDefault();
		const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-node-id]');
		const targetId = target?.dataset.nodeId;
		if (!target || !targetId || targetId === draggedNodeId) return;
		const rect = target.getBoundingClientRect();
		const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
		const reordered = reorderRelative(nodes, (node) => node.id, draggedNodeId, targetId, position);
		const nextOrder = reordered.map((node) => node.id);
		if (hasSameOrder(nextOrder, currentOrder())) return;
		nodes = reordered.map((node, index) => ({ ...node, sortOrder: index + 1 }));
		dragChanged = true;
		announcePosition(draggedNodeId);
	}

	async function finishPointerDrag(event: PointerEvent) {
		if (pointerId !== event.pointerId) return;
		const shouldSave = dragChanged;
		pointerId = null;
		dragChanged = false;
		const movedNodeId = draggedNodeId;
		draggedNodeId = null;
		if (!shouldSave || !movedNodeId) return;
		await tick();
		reorderForm.requestSubmit();
	}

	function cancelPointerDrag(event: PointerEvent) {
		if (pointerId !== event.pointerId) return;
		applyOrder(dragSnapshotIds);
		pointerId = null;
		dragChanged = false;
		draggedNodeId = null;
		reorderAnnouncement = '已取消节点排序';
	}

	async function handleReorderKey(event: KeyboardEvent, nodeId: string) {
		if (!canManage || pendingAction) return;
		if (!keyboardGrabbedId) {
			if (event.key !== ' ' && event.key !== 'Enter') return;
			event.preventDefault();
			keyboardGrabbedId = nodeId;
			dragSnapshotIds = currentOrder();
			announcePosition(nodeId);
			return;
		}
		if (keyboardGrabbedId !== nodeId) return;
		if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
			event.preventDefault();
			nodes = reorderByOffset(nodes, (node) => node.id, nodeId, event.key === 'ArrowUp' ? -1 : 1)
				.map((node, index) => ({ ...node, sortOrder: index + 1 }));
			announcePosition(nodeId);
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			applyOrder(dragSnapshotIds);
			keyboardGrabbedId = null;
			reorderAnnouncement = '已取消节点排序';
			return;
		}
		if (event.key === ' ' || event.key === 'Enter') {
			event.preventDefault();
			keyboardGrabbedId = null;
			if (hasSameOrder(dragSnapshotIds, currentOrder())) {
				reorderAnnouncement = '节点顺序没有变化';
				return;
			}
			await tick();
			reorderForm.requestSubmit();
		}
	}
</script>

<svelte:head>
	<title>{template.name} · SOP 配置</title>
</svelte:head>

<div class="management-page sop-detail-page">
	<div class="back-nav detail-toolbar">
		<a href={withBase('/sop')}><ArrowLeft size={18} /> 返回 SOP 管理</a>
		{#if canManage}
			<form method="post" action="?/toggleTemplate" use:enhance={enhanceForm('toggle')}>
				<button class:active={template.isActive} class="toggle-button" type="submit" disabled={pendingAction !== ''}>
					{pendingAction === 'toggle' ? '更新中…' : template.isActive ? '已启用 · 点击停用' : '已停用 · 点击启用'}
				</button>
			</form>
		{:else}
			<span class:active={template.isActive} class="toggle-button read-only-status">{template.isActive ? '已启用' : '已停用'}</span>
		{/if}
	</div>

	<p class="sr-only" aria-live="assertive">{reorderAnnouncement}</p>
	<form method="post" action="?/reorderNodes" use:enhance={enhanceForm('reorder', { rollbackOrderOnFailure: true })} bind:this={reorderForm} class="reorder-form">
		<input type="hidden" name="orderedNodeIds" value={currentOrder().join(',')} />
	</form>

	<div class="editor-grid">
		<main>
			<section class="panel">
				<header>
					<div>
						<h2>流程节点</h2>
						<p>{canManage ? '修改自动保存；拖拽节点左侧手柄调整顺序' : '当前为只读视图，节点配置由管理员维护'}</p>
					</div>
					<GitBranch size={20} />
				</header>
				<div class="node-list">
					{#each nodes as node, index (node.id)}
						<article class:dragging={draggedNodeId === node.id} class:read-only={!canManage} class="node-card" data-node-id={node.id}>
							<div class="node-order">
								<strong>{index + 1}</strong>
								<button
									class:grabbed={keyboardGrabbedId === node.id}
									class="drag-handle"
									type="button"
									aria-label={`拖拽排序 ${node.name}，当前第 ${index + 1} 项`}
									aria-pressed={keyboardGrabbedId === node.id}
									title="拖拽排序；键盘按空格抓取后使用上下方向键"
									disabled={!canManage || pendingAction !== ''}
									onpointerdown={(event) => beginPointerDrag(event, node.id)}
									onpointermove={continuePointerDrag}
									onpointerup={finishPointerDrag}
									onpointercancel={cancelPointerDrag}
									onkeydown={(event) => handleReorderKey(event, node.id)}
								>
									<GripVertical size={18} />
								</button>
							</div>
							<form
								method="post"
								action="?/updateNode"
								use:autoSave
								use:enhance={enhanceForm(`node-${node.id}`, { autoSave: true })}
								class="node-form"
							>
								<input type="hidden" name="nodeId" value={node.id} />
								<label class="node-name">
									<span>节点名称</span>
									<input name="name" maxlength="120" required bind:value={node.name} disabled={!canManage} />
								</label>
								<label>
									<span>相对发行日</span>
									<div class="offset-input">
										<input name="offsetDays" type="number" min="-3650" max="3650" step="1" required bind:value={node.offsetDays} disabled={!canManage} />
										<small>天</small>
									</div>
								</label>
								<label>
									<span>默认角色</span>
									<select name="ownerRole" bind:value={node.ownerRole} disabled={!canManage}>
										<option value="">不指定</option>
										{#each data.roles as role}<option value={role.code}>{role.label}</option>{/each}
									</select>
								</label>
								<label class="node-description">
									<span>节点说明</span>
									<input name="description" bind:value={node.description} placeholder="可选：说明交付物或控制要求" disabled={!canManage} />
								</label>
							</form>
							{#if canDelete}
							<form
								method="post"
								action="?/deleteNode"
								use:enhance={enhanceForm(`delete-${node.id}`)}
								class="delete-form"
								onsubmit={(event) => {
									if (!confirm(`确定删除节点 ${node.name} 吗？`)) event.preventDefault();
								}}
							>
								<input type="hidden" name="nodeId" value={node.id} />
								<button type="submit" aria-label={`删除 ${node.name}`} title="删除节点" disabled={pendingAction !== ''}>
									<Trash2 size={16} />
								</button>
							</form>
							{/if}
						</article>
					{:else}
						<p class="empty-state">尚未配置流程节点，请使用右下角加号添加。</p>
					{/each}
				</div>
			</section>
		</main>

		<aside>
			<section class="panel">
				<header>
					<div>
						<h2>模板信息</h2>
						<p>{canManage ? '修改后自动保存' : '当前为只读视图'}</p>
					</div>
				</header>
				<form method="post" action="?/updateTemplate" use:autoSave use:enhance={enhanceForm('template', { autoSave: true })} class="template-form">
					<label>
						<span>SOP 名称</span>
						<input name="name" maxlength="120" required bind:value={template.name} disabled={!canManage} />
					</label>
					<label>
						<span>负债品种</span>
						<input name="debtType" maxlength="80" required bind:value={template.debtType} disabled={!canManage} />
					</label>
					<label>
						<span>模板说明</span>
						<textarea name="description" rows="6" placeholder="说明适用范围和关键控制要求" bind:value={template.description} disabled={!canManage}></textarea>
					</label>
				</form>
			</section>

			<section class="guidance panel">
				<h2>相对日期规则</h2>
				<ul>
					<li><strong>负数</strong>：计划发行日前，例如 -30 表示提前 30 天。</li>
					<li><strong>0</strong>：计划发行当日。</li>
					<li><strong>正数</strong>：计划发行日后，例如 5 表示发行后 5 天。</li>
				</ul>
			</section>
		</aside>
	</div>

	{#if canManage}
		<button class="floating-create-button" type="button" onclick={openAddNode} aria-label="添加流程节点" title="添加流程节点">
			<Plus size={23} />
		</button>

		<dialog class="config-modal" bind:this={addNodeDialog}>
		<form method="post" action="?/addNode" use:enhance={enhanceForm('add-node', { resetOnSuccess: true, closeOnSuccess: true })}>
			<div class="modal-header">
				<div>
					<p class="eyebrow">SOP NODE</p>
					<h2>添加流程节点</h2>
					<p>新节点会添加到流程末尾，保存后可直接拖拽排序。</p>
				</div>
				<button type="button" aria-label="关闭" title="关闭" onclick={() => addNodeDialog?.close()}><X size={18} /></button>
			</div>
			<div class="form-grid">
				<label class="wide">
					<span>节点名称</span>
					<input bind:this={addNodeNameInput} name="name" maxlength="120" required placeholder="例如：发行结果确认" />
				</label>
				<label>
					<span>相对发行日</span>
					<input name="offsetDays" type="number" min="-3650" max="3650" step="1" required value="0" />
				</label>
				<label>
					<span>默认角色</span>
					<select name="ownerRole">
						<option value="">不指定</option>
						{#each data.roles as role}<option value={role.code}>{role.label}</option>{/each}
					</select>
				</label>
				<label class="wide">
					<span>节点说明</span>
					<input name="description" placeholder="可选：说明交付物或控制要求" />
				</label>
			</div>
			<div class="modal-actions">
				<button type="button" onclick={() => addNodeDialog?.close()}>取消</button>
				<button class="primary-action" type="submit" disabled={pendingAction !== ''}>
					{pendingAction === 'add-node' ? '添加中…' : '添加节点'}
				</button>
			</div>
		</form>
		</dialog>
	{/if}
</div>

<style>
	.sop-detail-page { padding-bottom: 4.5rem; }
	.back-nav { margin-bottom: 1rem; }
	.detail-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
	.back-nav a { display: inline-flex; min-height: 2.75rem; align-items: center; gap: 0.5rem; font-size: 1rem; font-weight: bold; color: var(--blue); }
	.toggle-button { min-height: 2.75rem; padding: 0 1rem; border: 1px solid #d0d5dd; border-radius: 0.5rem; font-size: 1rem; font-weight: bold; color: #475467; background: #fff; }
	.toggle-button.active { border-color: #a6f4c5; color: #067647; background: #ecfdf3; }
	.read-only-status { display: inline-flex; align-items: center; }
	.editor-grid { display: grid; grid-template-columns: minmax(0, 1.75fr) minmax(18rem, 0.65fr); gap: 1rem; align-items: start; }
	main, aside { display: grid; min-width: 0; gap: 1rem; }
	.panel { overflow: hidden; border: 1px solid var(--line); border-radius: 0.75rem; background: var(--surface); box-shadow: var(--shadow); }
	.panel > header { display: flex; min-height: 4.5rem; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.875rem 1rem; border-bottom: 1px solid var(--line); }
	h2 { margin: 0; font-size: 1.125rem; color: #1d2939; }
	.panel header p { margin: 0.2rem 0 0; font-size: 0.75rem; color: var(--subtle); }
	.reorder-form { display: none; }
	.node-card { display: grid; grid-template-columns: 3.25rem minmax(0, 1fr) 2.75rem; gap: 0.75rem; padding: 1rem; border-bottom: 1px solid var(--line); background: #fff; transition: border-color 180ms ease, background 180ms ease, opacity 180ms ease; }
	.node-card.read-only { grid-template-columns: 3.25rem minmax(0, 1fr); }
	.node-card.dragging { border-color: #84adff; background: #eff4ff; opacity: 0.75; }
	.node-order { display: grid; align-content: start; justify-items: center; gap: 0.5rem; }
	.node-order > strong { display: grid; width: 2.25rem; height: 2.25rem; place-items: center; border-radius: 999rem; font-size: 1rem; color: var(--color-primary); background: #edf4ff; }
	.drag-handle { display: grid; width: 2.75rem; height: 2.75rem; place-items: center; border: 1px solid #d0d5dd; border-radius: 0.5rem; color: #667085; background: #fff; cursor: grab; touch-action: none; }
	.drag-handle:active, .drag-handle.grabbed { color: var(--color-primary); background: #eff4ff; cursor: grabbing; }
	.drag-handle:focus-visible { outline: 0.1875rem solid rgb(59 130 246 / 35%); outline-offset: 0.125rem; }
	.node-form { display: grid; grid-template-columns: minmax(12rem, 1.3fr) minmax(8rem, 0.55fr) minmax(10rem, 0.75fr); gap: 0.75rem; align-items: end; }
	.node-description { grid-column: 1 / -1; }
	label { display: grid; gap: 0.3rem; }
	label span { font-size: 0.75rem; font-weight: bold; color: var(--muted); }
	input, select, textarea { width: 100%; min-height: 2.75rem; padding: 0.55rem 0.7rem; border: 1px solid #d0d5dd; border-radius: 0.5rem; font-size: 1rem; color: #344054; background: #fff; }
	textarea { resize: vertical; }
	.offset-input { position: relative; }
	.offset-input input { padding-right: 2.5rem; }
	.offset-input small { position: absolute; top: 50%; right: 0.75rem; font-size: 0.75rem; color: var(--subtle); transform: translateY(-50%); }
	button:disabled { cursor: wait; opacity: 0.6; }
	.delete-form { align-self: end; margin-bottom: 0.1rem; }
	.delete-form button { display: grid; width: 2.75rem; height: 2.75rem; place-items: center; border: 1px solid #d0d5dd; border-radius: 0.5rem; color: #b42318; background: #fff; }
	.template-form { display: grid; gap: 0.875rem; padding: 1rem; }
	.guidance { padding: 1rem; }
	.guidance ul { display: grid; gap: 0.65rem; margin: 0.75rem 0 0; padding-left: 1.25rem; }
	.guidance li { font-size: 1rem; line-height: 1.55; color: var(--muted); }
	.empty-state { margin: 0; padding: 1.25rem; font-size: 1rem; color: var(--muted); text-align: center; }
	.sop-detail-page .config-modal { max-height: min(90dvh, 42rem); overflow: auto; }
	.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
	@media (max-width: 75rem) { .editor-grid { grid-template-columns: 1fr; } }
	@media (max-width: 64rem) { .node-form { grid-template-columns: repeat(2, minmax(0, 1fr)); } .node-description { grid-column: 1 / -1; } }
	@media (max-width: 51.25rem) { .detail-toolbar { align-items: flex-start; flex-direction: column; } .node-card { grid-template-columns: 2.75rem minmax(0, 1fr); } .node-form { grid-template-columns: 1fr; } .node-description { grid-column: auto; } .delete-form { grid-column: 2; justify-self: end; } }
	@media (prefers-reduced-motion: reduce) { .node-card { transition: none; } }
</style>
