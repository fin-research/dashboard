<script lang="ts">
import { formatFinancingTimestamp } from '$lib/financing/time.js';
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { untrack } from 'svelte';
	import {
		ArrowLeft,
		CalendarDays,
		ClipboardList,
		Clock3,
		Plus,
		UserRound,
		UsersRound
	} from '@lucide/svelte';
	import { autoSave, completeAutoSave, getAutoSaveRevision } from '$lib/financing/auto-save';
	import { globalMessages } from '$lib/global-messages';
		import { hasPermission } from '$lib/permissions';
	import ScheduleFields from '$lib/financing/components/ScheduleFields.svelte';
	import { withBase } from '$lib/financing/app-paths';

	let { data: routeData, form } = $props();
	const initialRouteData = untrack(() => routeData);
	let data = $state(initialRouteData);
	let loadedProjectId = $state(String(initialRouteData.project.id));
	$effect(() => {
		if (String(routeData.project.id) === loadedProjectId) return;
		loadedProjectId = String(routeData.project.id);
		data = routeData;
	});
	let pendingActions = $state<string[]>([]);
	let pageEditRevision = $state(0);
	let suppressFormFeedback = $state(false);
	let handledForm = $state<unknown>(null);
	const pendingAction = $derived(pendingActions.at(-1) ?? '');
	const canManage = $derived(hasPermission(data?.permissions, 'financing.task:update'));
	const canManageProject = $derived(hasPermission(data?.permissions, 'financing.project:update'));
	const canCreateTask = $derived(hasPermission(data?.permissions, 'financing.task:create'));
	const canUpdateTaskStatus = (task: any) => canManage || (
		hasPermission(data?.permissions, 'financing.task:update_own') && task.assigneeId === data?.user?.personId
	);
	$effect(() => {
		if (!form?.message || suppressFormFeedback || handledForm === form) return;
		handledForm = form;
		const message = String(form.message);
		if (form.success) globalMessages.success(message, { key: 'project-detail-action' });
		else globalMessages.error(message, { key: 'project-detail-action' });
	});

	const statusLabels: Record<string, string> = {
		planning: '规划中',
		in_progress: '执行中',
		at_risk: '存在风险',
		completed: '已完成',
		cancelled: '已取消'
	};
	const taskStatusLabels: Record<string, string> = {
		not_started: '待开始',
		in_progress: '进行中',
		blocked: '受阻',
		completed: '已完成'
	};
	const progress = $derived(
		data.tasks.length
			? Math.round((data.tasks.filter((task: any) => task.status === 'completed').length / data.tasks.length) * 100)
			: 0
	);

	function membersFor(project: any, tasks: any[], people: any[]) {
		const members = new Map<string, any>();
		if (project.ownerId) {
			const owner = people.find((person: any) => person.id === project.ownerId);
			if (owner) members.set(owner.id, { ...owner, responsibility: '项目负责人' });
		}
		for (const task of tasks) {
			if (!task.assigneeId || members.has(task.assigneeId)) continue;
			const person = people.find((candidate: any) => candidate.id === task.assigneeId);
			if (person) members.set(person.id, { ...person, responsibility: '任务执行人' });
		}
		return [...members.values()];
	}

	function applyActionDelta(resultData: any) {
		let project = data.project;
		let tasks = data.tasks;
		if (resultData?.project) {
			project = { ...project, ...resultData.project };
			project.ownerName = data.people.find((person: any) => person.id === project.ownerId)?.name ?? null;
		}
		if (resultData?.task) {
			const task = {
				...resultData.task,
				assigneeName: data.people.find((person: any) => person.id === resultData.task.assigneeId)?.name ?? null
			};
			const exists = tasks.some((item: any) => item.id === task.id);
			tasks = (exists
				? tasks.map((item: any) => item.id === task.id ? { ...item, ...task } : item)
				: [...tasks, task]
			).sort((left: any, right: any) => Number(left.sortOrder) - Number(right.sortOrder));
		}
		data = {
			...data,
			project,
			tasks,
			members: membersFor(project, tasks, data.people)
		};
	}

	function markPageDirty() {
		pageEditRevision += 1;
	}

	function enhanceForm(
		label: string,
		options: { resetOnSuccess?: boolean; autoSave?: boolean } = {}
	): SubmitFunction {
		return ({ formElement }) => {
			pendingActions = [...pendingActions.filter((item) => item !== label), label];
			const submittedRevision = getAutoSaveRevision(formElement);
			const submittedPageRevision = pageEditRevision;
			suppressFormFeedback = true;
			return async ({ result, update }) => {
				try {
					if (result.type === 'success') {
						const responseIsCurrent = !options.autoSave || (
							submittedRevision === getAutoSaveRevision(formElement) &&
							submittedPageRevision === pageEditRevision
						);
						if (responseIsCurrent) applyActionDelta(result.data);
						await update({ reset: false, invalidateAll: false });
						if (responseIsCurrent && result.data?.refreshReminders) {
							await invalidate('financing:reminders');
						}
						if (options.resetOnSuccess) formElement.reset();
						if (options.autoSave) {
							if (responseIsCurrent) {
								globalMessages.success('已保存', {
									key: 'project-detail-auto-save',
									duration: 3000,
									title: '项目已同步'
								});
							}
							completeAutoSave(formElement, true);
						} else {
							globalMessages.success(String(result.data?.message ?? '保存成功'), {
								key: 'project-detail-action'
							});
						}
						return;
					}
					await update({ reset: false, invalidateAll: false });
					const message = String(
						result.type === 'failure'
							? result.data?.message ?? '保存失败，请修改后重试'
							: result.type === 'error' && result.error?.message
								? result.error.message
								: '保存失败，请稍后重试'
					);
					globalMessages.error(message, {
						key: options.autoSave ? 'project-detail-auto-save' : 'project-detail-action'
					});
					if (options.autoSave) {
						completeAutoSave(formElement, false);
					}
				} finally {
					pendingActions = pendingActions.filter((item) => item !== label);
				}
			};
		};
	}

	function formatDateTime(value: string | null) {
		if (!value) return '时间未记录';
		return formatFinancingTimestamp(value);
	}
</script>

<svelte:head>
	<title>{data.project.name} · 项目详情</title>
</svelte:head>

<div class="back-nav detail-toolbar">
	<a href={withBase('/projects')}><ArrowLeft size={18} /> 返回项目进度</a>
	<span class={`project-state ${data.project.status}`}>{statusLabels[data.project.status] ?? data.project.status}</span>
</div>

<div class="financing-detail-heading"><h2>{data.project.name}</h2></div>

<section class="summary-grid" aria-label="项目概览">
	<article>
		<span><ClipboardList size={18} /> 项目进度</span>
		<strong>{progress}%</strong>
		<div class="progress-track"><i style:width={`${progress}%`}></i></div>
	</article>
	<article>
		<span><CalendarDays size={18} /> 计划簿记</span>
		<strong>{data.project.plannedIssueDate ?? '待安排'}</strong>
		<small>与 SOP 的计划发行当日一致</small>
	</article>
	<article>
		<span><UserRound size={18} /> 项目负责人</span>
		<strong>{data.project.ownerName ?? '待分配'}</strong>
		<small>{data.members.length} 位项目成员</small>
	</article>
	<article>
		<span><Clock3 size={18} /> SOP 模板</span>
		<strong>{data.project.sopName ?? '未绑定模板'}</strong>
		<small>{data.tasks.length} 个任务节点</small>
	</article>
</section>

<div class="detail-grid">
	<main>
		<section class="panel">
			<header>
				<div>
					<h2>任务节点</h2>
					<p>{canManage ? '修改后自动保存' : '仅可修改分配给自己的节点状态'}</p>
				</div>
			</header>
			<div class="task-list">
				{#each data.tasks as task, index (task.id)}
					<form
						method="post"
						action={canManage ? '?/updateTask' : '?/updateOwnTaskStatus'}
						use:autoSave={{ onDirty: markPageDirty }}
						use:enhance={enhanceForm(`task-${task.id}`, { autoSave: true })}
						class="task-item"
					>
						<input type="hidden" name="taskId" value={task.id} />
						<span class={`task-index ${task.status}`}>{index + 1}</span>
						<div class="task-copy">
							<strong>{task.name}</strong>
							<small>{task.completedAt ? `完成于 ${formatDateTime(task.completedAt)}` : `第 ${task.sortOrder} 个节点`}</small>
							{#if task.notes}<small class="task-note">{task.notes}</small>{/if}
						</div>
						<label>
							<span>状态</span>
							<select class="select" name="status" value={task.status} aria-label={`${task.name}状态`} disabled={!canUpdateTaskStatus(task)}>
								{#each Object.entries(taskStatusLabels) as [value, label]}
									<option {value}>{label}</option>
								{/each}
							</select>
						</label>
						<label>
							<span>负责人</span>
							<select class="select" name="assigneeId" value={task.assigneeId ?? ''} aria-label={`${task.name}负责人`} disabled={!canManage}>
								<option value="">待分配</option>
								{#each data.people as person}
									<option value={person.id}>{person.name}</option>
								{/each}
							</select>
						</label>
						<div class="task-schedule">
							<ScheduleFields scheduleType={task.scheduleType ?? 'point'} startValue={task.plannedStartDate} endValue={task.dueDate} label={task.name} disabled={!canManage} />
						</div>
					</form>
				{:else}
					<p class="empty-state">{canManage ? '尚无任务节点，可在下方添加第一个任务。' : '尚无任务节点。'}</p>
				{/each}
			</div>
			{#if canCreateTask}
			<form method="post" action="?/addTask" use:enhance={enhanceForm('add-task', { resetOnSuccess: true })} class="add-task">
				<label>
					<span>任务名称</span>
					<input class="input" name="name" maxlength="120" required placeholder="例如：发行方案内部确认" />
				</label>
				<label>
					<span>负责人</span>
					<select class="select" name="assigneeId">
						<option value="">待分配</option>
						{#each data.people as person}
							<option value={person.id}>{person.name}</option>
						{/each}
					</select>
				</label>
				<div class="task-schedule"><ScheduleFields /></div>
				<button class="btn" type="submit" disabled={pendingAction !== ''}>
					<Plus size={16} />
					{pendingAction === 'add-task' ? '添加中…' : '添加节点'}
				</button>
			</form>
			{/if}
		</section>

	</main>

	<aside>
		<section class="panel">
			<header>
				<div>
					<h2>基本信息</h2>
					<p>{canManageProject ? '修改后自动保存' : '当前为只读视图'}</p>
				</div>
			</header>
			<form
				method="post"
				action="?/updateProject"
				use:autoSave={{ onDirty: markPageDirty }}
				use:enhance={enhanceForm('project', { autoSave: true })}
				class="project-form"
			>
				<label>
					<span>项目状态</span>
					<select class="select" name="status" value={data.project.status} disabled={!canManageProject}>
						{#each Object.entries(statusLabels) as [value, label]}
							<option {value}>{label}</option>
						{/each}
					</select>
				</label>
				<label>
					<span>负责人</span>
					<select class="select" name="ownerId" value={data.project.ownerId ?? ''} disabled={!canManageProject}>
						<option value="">待分配</option>
						{#each data.people as person}
							<option value={person.id}>{person.name} · {person.roles?.map((role: { name: string }) => role.name).join('、') || '未分配角色'}</option>
						{/each}
					</select>
				</label>
				<label>
					<span>项目说明</span>
					<textarea class="textarea" name="notes" rows="5" placeholder="补充项目背景、风险或执行说明" disabled={!canManageProject}>{data.project.notes ?? ''}</textarea>
				</label>
			</form>
			<dl class="metadata">
				<div><dt>融资规模</dt><dd>{data.project.amount ? `${(data.project.amount / 100000000).toFixed(2)} 亿元` : '暂未登记'}</dd></div>
				<div><dt>规模说明</dt><dd>{data.project.amountDescription ?? '数据缺失'}</dd></div>
				<div><dt>预计利率</dt><dd>{data.project.expectedRateMin == null || data.project.expectedRateMax == null ? '数据缺失' : `${(data.project.expectedRateMin * 100).toFixed(2)}%–${(data.project.expectedRateMax * 100).toFixed(2)}%`}</dd></div>
				<div><dt>资金成本</dt><dd>{data.project.fundingCostRate == null ? '数据缺失' : `${(data.project.fundingCostRate * 100).toFixed(2)}%`}</dd></div>
				<div><dt>期限说明</dt><dd>{data.project.tenorDescription ?? '数据缺失'}</dd></div>
				<div><dt>计划到期日</dt><dd>{data.project.plannedMaturityDate ?? '暂未登记'}</dd></div>
				<div><dt>币种</dt><dd>{data.project.currency}</dd></div>
			</dl>
		</section>

		<section class="panel">
			<header>
				<div>
					<h2>项目成员</h2>
					<p>由项目负责人和任务执行人实时汇总</p>
				</div>
				<UsersRound size={20} />
			</header>
			<ul class="member-list">
				{#each data.members as member}
					<li>
						<span>{member.name.slice(0, 1)}</span>
						<div>
							<strong>{member.name}</strong>
							<p>{member.responsibility} · {member.roles?.map((role: { name: string }) => role.name).join('、') || '未分配角色'}</p>
							<small>{member.email ?? '未填写邮箱'}</small>
						</div>
					</li>
				{:else}
					<li class="empty-state">尚未分配项目成员</li>
				{/each}
			</ul>
		</section>
	</aside>
</div>

<style>
	.back-nav {
		margin-bottom: 1rem;
	}
	.detail-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	.back-nav a {
		display: inline-flex;
		min-height: 2.75rem;
		align-items: center;
		gap: 0.5rem;
		font-size: 1rem;
		font-weight: bold;
		color: var(--blue);
	}
	.project-state {
		padding: 0.5rem 0.75rem;
		border-radius: 999rem;
		font-size: 1rem;
		font-weight: bold;
		color: var(--color-primary);
		background: #edf4ff;
	}
	.project-state.at_risk {
		color: #b54708;
		background: #fffaeb;
	}
	.project-state.completed {
		color: #067647;
		background: #ecfdf3;
	}
	.project-state.cancelled {
		color: #475467;
		background: #f2f4f7;
	}
	.summary-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.75rem;
		margin-bottom: 1rem;
	}
	.summary-grid article,
	.panel {
		border: 1px solid var(--line);
		border-radius: 0.75rem;
		background: var(--surface);
		box-shadow: var(--shadow);
	}
	.summary-grid article {
		display: grid;
		gap: 0.5rem;
		padding: 1rem;
	}
	.summary-grid span {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.75rem;
		color: var(--muted);
	}
	.summary-grid strong {
		font-size: 1.125rem;
		color: #1d2939;
	}
	.summary-grid small {
		font-size: 0.75rem;
		color: var(--subtle);
	}
	.progress-track {
		height: 0.4rem;
		overflow: hidden;
		border-radius: 999rem;
		background: #eaecf0;
	}
	.progress-track i {
		display: block;
		height: 100%;
		background: var(--blue);
	}
	.detail-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.65fr) minmax(20rem, 0.75fr);
		gap: 1rem;
		align-items: start;
	}
	main,
	aside {
		display: grid;
		min-width: 0;
		gap: 1rem;
	}
	.panel {
		overflow: hidden;
	}
	.panel > header {
		display: flex;
		min-height: 4.5rem;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.875rem 1rem;
		border-bottom: 1px solid var(--line);
	}
	.panel h2 {
		margin: 0;
		font-size: 1.125rem;
		color: #1d2939;
	}
	.panel header p {
		margin: 0.2rem 0 0;
		font-size: 0.75rem;
		color: var(--subtle);
	}
	.task-list {
		display: grid;
	}
	.task-item {
		display: grid;
		grid-template-columns: auto minmax(12rem, 1.4fr) repeat(2, minmax(8.5rem, 0.7fr));
		align-items: end;
		gap: 0.75rem;
		padding: 0.875rem 1rem;
		border-bottom: 1px solid var(--line);
	}
	.task-schedule { grid-column: 2 / -1; }
	.add-task .task-schedule { grid-column: 1 / -1; }
	.task-index {
		display: grid;
		width: 2rem;
		height: 2rem;
		align-self: center;
		place-items: center;
		border-radius: 999rem;
		font-size: 0.75rem;
		font-weight: bolder;
		color: #475467;
		background: #f2f4f7;
	}
	.task-index.in_progress {
		color: var(--color-primary);
		background: #edf4ff;
	}
	.task-index.blocked {
		color: #b42318;
		background: #fef3f2;
	}
	.task-index.completed {
		color: #067647;
		background: #ecfdf3;
	}
	.task-copy {
		align-self: center;
	}
	.task-copy strong {
		display: block;
		font-size: 1rem;
		color: #344054;
	}
	.task-copy small {
		display: block;
		margin-top: 0.25rem;
		font-size: 0.75rem;
		color: var(--subtle);
	}
	.task-copy .task-note {
		color: var(--muted);
		line-height: 1.5;
	}
	label {
		display: grid;
		gap: 0.3rem;
	}
	label span {
		font-size: 0.75rem;
		font-weight: bold;
		color: var(--muted);
	}
	select,
	input,
	textarea {
		width: 100%;
		padding: 0.55rem 0.7rem;
	}
	textarea {
		resize: vertical;
	}
	button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 0 0.75rem;
	}
	.add-task {
		display: grid;
		grid-template-columns: minmax(12rem, 1fr) minmax(9rem, 0.6fr);
		align-items: end;
		gap: 0.75rem;
		padding: 1rem;
		background: #f8fafc;
	}
	.empty-state {
		margin: 0;
		padding: 1.25rem;
		font-size: 1rem;
		color: var(--muted);
		text-align: center;
	}
	.project-form {
		display: grid;
		gap: 0.875rem;
		padding: 1rem;
	}
	.metadata {
		margin: 0;
		padding: 0 1rem 1rem;
	}
	.metadata div {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.65rem 0;
		border-top: 1px solid var(--line);
	}
	.metadata dt,
	.metadata dd {
		margin: 0;
		font-size: 0.75rem;
	}
	.metadata dt {
		color: var(--muted);
	}
	.metadata dd {
		font-weight: bold;
		color: #344054;
	}
	.member-list,
	.member-list li {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.875rem 1rem;
		border-bottom: 1px solid var(--line);
	}
	.member-list li:last-child {
		border-bottom: 0;
	}
	.member-list li > span {
		display: grid;
		width: 2.5rem;
		height: 2.5rem;
		flex: 0 0 auto;
		place-items: center;
		border-radius: 999rem;
		font-size: 1rem;
		font-weight: bold;
		color: var(--color-primary);
		background: #edf4ff;
	}
	.member-list strong {
		font-size: 1rem;
		color: #344054;
	}
	.member-list p,
	.member-list small {
		display: block;
		margin: 0.15rem 0 0;
		font-size: 0.75rem;
		color: var(--muted);
		overflow-wrap: anywhere;
	}
	@media (max-width: 75rem) {
		.summary-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.detail-grid {
			grid-template-columns: 1fr;
		}
		.task-item {
			grid-template-columns: auto minmax(11rem, 1fr) repeat(2, minmax(8rem, 0.7fr));
			overflow-x: auto;
		}
	}
	@media (max-width: 51.25rem) {
		.summary-grid {
			grid-template-columns: 1fr;
		}
		.task-item,
		.add-task {
			grid-template-columns: 1fr;
		}
		.task-schedule { grid-column: 1 / -1; }
		.task-index {
			display: none;
		}
	}
</style>
