<script lang="ts">
import ModuleCard from '../../../components/ModuleCard.svelte';
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { untrack } from 'svelte';
	import {
		ArrowRight,
		CalendarDays,
		CheckCircle2,
		ChevronDown,
		ChevronRight,
		CircleDashed,
		Clock3,
		Filter,
		Flag,
		LoaderCircle,
		Pencil,
		Plus,
		Search,
		Trash2,
		Users
	} from '@lucide/svelte';
	import MultiSelectFilter from '$lib/financing/MultiSelectFilter.svelte';
	import { autoSave, completeAutoSave, getAutoSaveRevision } from '$lib/financing/auto-save';
	import { withBase } from '$lib/financing/app-paths';
	import { globalMessages } from '$lib/global-messages';
	import { hasPermission } from '$lib/financing/permissions.js';
	import { buildProjectPageData } from '$lib/financing/project-page.js';

	let { data } = $props();
	let selectedTypes = $state<string[]>([]);
	const initialOwnerSelection = () =>
		data?.viewContext?.defaultOwnProjects && data?.viewContext?.personName
			? [data.viewContext.personName]
			: [];
	let selectedOwners = $state<string[]>(initialOwnerSelection());
	let selectedStatuses = $state<string[]>([]);
	let view = $state<'month' | 'quarter'>('month');
	let expandedProject = $state<string | number | null>(null);
	let newProjectDialog: HTMLDialogElement;
	let editProjectDialog: HTMLDialogElement;
	let editingProject = $state<any>(null);
	let newProjectBookbuildingDate = $state('');
	const initialProjectSources = untrack(() => data?.projectSources ?? []);
	let projectSources = $state<any[]>([...initialProjectSources]);
	let projectOptions = $state<{ people: any[]; projectSops: any[] }>({ people: [], projectSops: [] });
	let projectOptionsStatus = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
	let projectOptionsRequest: Promise<boolean> | null = null;
	let actionState = $state<{ key: string; status: 'idle' | 'pending' }>({
		key: '', status: 'idle'
	});
	const canManage = $derived(hasPermission(data?.permissions, 'project_manage'));
	const canCreate = $derived(canManage);

	function showAutoSaved(message: string) {
		globalMessages.success(message, { key: 'project-list-auto-save', duration: 3000, title: '项目已同步' });
		actionState = { key: '', status: 'idle' };
	}

	const enhanceProjectAction = (key: string, dialog?: 'create'): SubmitFunction => ({ formElement }) => {
		const isAutoSave = key === 'edit';
		const submittedRevision = isAutoSave ? getAutoSaveRevision(formElement) : 0;
		actionState = { key, status: 'pending' };
		return async ({ result, update }) => {
			const responseIsCurrent = !isAutoSave || submittedRevision === getAutoSaveRevision(formElement);
			if (result.type === 'success') {
				const returnedProject = result.data?.project ?? null;
				if (responseIsCurrent && returnedProject) {
					const existingIndex = projectSources.findIndex((project: any) => project.id === returnedProject.id);
					projectSources = existingIndex >= 0
						? projectSources.map((project: any) => project.id === returnedProject.id ? returnedProject : project)
						: [...projectSources, returnedProject];
				}
				const deletedProjectId = String(result.data?.deletedProjectId ?? '');
				if (deletedProjectId) {
					projectSources = projectSources.filter((project: any) => project.id !== deletedProjectId);
					if (String(expandedProject ?? '') === deletedProjectId) expandedProject = null;
				}
				await update({ reset: false, invalidateAll: false });
				if (responseIsCurrent && result.data?.refreshReminders) {
					await invalidate('financing:reminders');
				}
				if (isAutoSave) {
					if (responseIsCurrent) {
						const confirmed = projects.find((project: any) => String(project.id) === String(editingProject?.id));
						if (confirmed) editingProject = confirmed;
						showAutoSaved('已保存');
					} else {
						actionState = { key, status: 'pending' };
					}
				} else {
					globalMessages.success(String(result.data?.message ?? '项目已保存'), {
						key: 'project-list-action'
					});
					actionState = { key: '', status: 'idle' };
				}
				if (dialog === 'create') newProjectDialog?.close();
				if (isAutoSave) completeAutoSave(formElement, true);
				return;
			}
			await update({ reset: false, invalidateAll: false });
			const message = result.type === 'failure'
				? String(result.data?.message ?? '保存失败，请检查填写内容后重试。')
				: result.type === 'error' && result.error?.message
					? result.error.message
					: '保存失败，请稍后重试。';
			globalMessages.error(message, { key: isAutoSave ? 'project-list-auto-save' : 'project-list-action' });
			actionState = { key: '', status: 'idle' };
			if (isAutoSave) completeAutoSave(formElement, false);
		};
	};

	function ensureProjectOptions() {
		if (projectOptionsStatus === 'ready') return Promise.resolve(true);
		if (projectOptionsRequest) return projectOptionsRequest;
		projectOptionsStatus = 'loading';
		projectOptionsRequest = (async () => {
			try {
				const response = await fetch(withBase('/projects/options'), {
					headers: { Accept: 'application/json' },
					cache: 'no-store'
				});
				if (!response.ok) throw new Error(`项目表单选项加载失败（${response.status}）`);
				const options = await response.json();
				projectOptions = {
					people: Array.isArray(options?.people) ? options.people : [],
					projectSops: Array.isArray(options?.projectSops) ? options.projectSops : []
				};
				projectOptionsStatus = 'ready';
				return true;
			} catch (error) {
				projectOptionsStatus = 'error';
				globalMessages.error(
					error instanceof Error ? error.message : '项目表单选项加载失败，请稍后重试',
					{ key: 'project-form-options' }
				);
				return false;
			} finally {
				projectOptionsRequest = null;
			}
		})();
		return projectOptionsRequest;
	}

	function openNewProject() {
		newProjectBookbuildingDate = data.today;
		newProjectDialog.showModal();
		void ensureProjectOptions();
	}

	function openEditProject(project: any) {
		editingProject = project;
		editProjectDialog.showModal();
		void ensureProjectOptions();
	}

	const projectPage = $derived(buildProjectPageData(projectSources, data.today));
	const projects = $derived(projectPage.projects);
	const activeTimeline = $derived(projectPage.timeline);
	const visibleProjects = $derived(
		projects.filter(
			(project: any) =>
				(selectedTypes.length === 0 || selectedTypes.includes(project.type)) &&
				(selectedOwners.length === 0 || selectedOwners.includes(project.owner)) &&
				(selectedStatuses.length === 0 || selectedStatuses.includes(project.status))
		)
	);
	const summary = $derived({
		inProgress: visibleProjects.filter((project: any) => project.progress < 100).length,
		dueThisWeek: visibleProjects.filter((project: any) =>
			['今天', '明天', '2天后', '3天后', '4天后', '5天后', '6天后', '7天后'].includes(project.dueText)
		).length,
		atRisk: visibleProjects.filter((project: any) => project.tone === 'orange').length,
		completed: visibleProjects.filter((project: any) => project.progress === 100).length
	});
	const projectTypes = $derived([
		...new Set<string>(
			projects.map((project: any) => String(project.type))
		)
	]);
	const projectOwners = $derived([
		...new Set<string>(
			projects.map((project: any) => String(project.owner))
		)
	]);
	const projectStatuses = $derived([
		...new Set<string>(
			projects.map((project: any) => String(project.status))
		)
	]);
	const primaryTimelineBands = $derived(
		view === 'quarter' ? activeTimeline?.quarters ?? [] : activeTimeline?.months ?? []
	);
	const secondaryTimelineBands = $derived(
		view === 'quarter' ? activeTimeline?.months ?? [] : activeTimeline?.weeks ?? []
	);
</script>

<svelte:head>
	<title>项目进度 · 融资工作台</title>
</svelte:head>

<section class="summary-strip" aria-label="项目汇总">
	<div>
		<span class="summary-icon blue"><CircleDashed size={17} /></span>
		<p><strong>{summary.inProgress}</strong><span>进行中</span></p>
	</div>
	<div>
		<span class="summary-icon orange"><Clock3 size={17} /></span>
		<p><strong>{summary.dueThisWeek}</strong><span>本周到期节点</span></p>
	</div>
	<div>
		<span class="summary-icon red"><Flag size={17} /></span>
		<p><strong>{summary.atRisk}</strong><span>存在延期风险</span></p>
	</div>
	<div>
		<span class="summary-icon green"><CheckCircle2 size={17} /></span>
		<p><strong>{summary.completed}</strong><span>本月已完成</span></p>
	</div>
</section>

<section class="toolbar" aria-label="甘特图筛选">
	<div class="search-field">
		<Search size={15} />
		<input aria-label="搜索项目" placeholder="搜索项目名称或编号" />
	</div>
	<div class="select-group">
		<Filter size={14} />
		<MultiSelectFilter
			label="融资品种"
			options={projectTypes}
			bind:values={selectedTypes}
			allLabel="全部品种"
		/>
		<MultiSelectFilter
			label="负责人"
			options={projectOwners}
			bind:values={selectedOwners}
			allLabel="全部人员"
		/>
		<MultiSelectFilter
			label="项目状态"
			options={projectStatuses}
			bind:values={selectedStatuses}
			allLabel="全部状态"
		/>
	</div>
	<div class="view-switcher" aria-label="时间视图">
		<button class:active={view === 'month'} type="button" onclick={() => (view = 'month')}>月</button>
		<button class:active={view === 'quarter'} type="button" onclick={() => (view = 'quarter')}
			>季</button
		>
	</div>
</section>

<ModuleCard class="gantt-panel">
	<div class="gantt-head">
		<div class="project-column-title">项目 / 负责人</div>
		<div class="status-column-title">状态</div>
		<div class="timeline-head">
			<div class="month-band">
				{#each primaryTimelineBands as band (band.key)}
					<span style:flex-basis={`${band.widthPct}%`}>{band.label}</span>
				{/each}
			</div>
			<div class="week-band">
				{#each secondaryTimelineBands as band (band.key)}
					<span style:flex-basis={`${band.widthPct}%`}>{band.label}</span>
				{/each}
			</div>
		</div>
	</div>

	<div class="gantt-body">
		{#each visibleProjects as project (project.id)}
			<div class:expanded={expandedProject === project.id} class="project-row">
				<div class="project-info">
					<button
						class="expand-button"
						type="button"
						aria-label={`${expandedProject === project.id ? '收起' : '展开'} ${project.name}`}
						onclick={() => (expandedProject = expandedProject === project.id ? null : project.id)}
					>
						{#if expandedProject === project.id}
							<ChevronDown size={15} />
						{:else}
							<ChevronRight size={15} />
						{/if}
					</button>
					<div>
						<a href={withBase(`/projects/${project.id}`)}>{project.name}</a>
						<p>
							<span>{project.code}</span>
							<i></i>
							<span>{project.type}</span>
						</p>
					</div>
					<div class="project-people" aria-label={`项目成员 ${project.members.join('、')}`}>
						{#each project.members.slice(0, 3) as member, index}
							<span style:z-index={3 - index}>{member}</span>
						{/each}
					</div>
					{#if canManage}
						<div class="project-row-actions">
							<button
								type="button"
								aria-label={`编辑 ${project.name}`}
								title="编辑项目"
								onclick={() => openEditProject(project)}
							>
								<Pencil size={15} />
							</button>
							<form
								method="post"
								action="?/deleteProject"
								use:enhance={enhanceProjectAction(`delete-${project.id}`)}
								onsubmit={(event) => {
									if (!confirm(`确定删除项目 ${project.name} 吗？项目任务和关联提醒将一并删除。`)) event.preventDefault();
								}}
							>
								<input type="hidden" name="id" value={project.id} />
								<button
									type="submit"
									class="danger-action"
									aria-label={`删除 ${project.name}`}
									title="删除项目"
									disabled={actionState.status === 'pending'}
								>
									<Trash2 size={15} />
								</button>
							</form>
						</div>
					{/if}
				</div>
				<div class="project-status">
					<span class={`status-pill ${project.tone}`}>{project.status}</span>
					<div class="progress-line">
						<span style:width={`${project.progress}%`}></span>
					</div>
					<small>{project.progress}%</small>
				</div>
				<div class="timeline-cell" style:--timeline-columns={Math.max(1, secondaryTimelineBands.length)}>
					<div class="today-line" style:left={`${activeTimeline?.todayPct ?? 0}%`}><span>今天</span></div>
					<div
						class={`project-bar ${project.tone}`}
						style:left={`${project.startPct}%`}
						style:width={`${project.widthPct}%`}
						title={`${project.name}：${project.start} 至 ${project.end}`}
					>
						<span>{project.progress}%</span>
					</div>
					<div class="next-node" style:left={`${Math.min(project.startPct + project.widthPct + 2, 84)}%`}>
						<i></i>
						<span>{project.nextNode}</span>
					</div>
				</div>
				<div class="mobile-project-meta">
					<div><CalendarDays size={14} /> {project.start} — {project.end}</div>
					<div><Users size={14} /> {project.owner} · {project.members.length}人</div>
					<div><Clock3 size={14} /> 下一节点：{project.nextNode}（{project.dueText}）</div>
				</div>
			</div>

			{#if expandedProject === project.id && project.tasks.length > 0}
				<div class="task-rows">
					{#each project.tasks as task, index}
						<div class="task-row">
							<div class="task-info">
								<span class={`task-dot ${task.status}`}></span>
								<span>{index + 1}. {task.name}</span>
							</div>
							<div class="task-status">
								{task.status === 'done' ? '已完成' : task.status === 'doing' ? '进行中' : '待开始'}
							</div>
							<div class="task-timeline" style:--timeline-columns={Math.max(1, secondaryTimelineBands.length)}>
								<div
									class={`task-bar ${task.status}`}
									style:left={`${task.startPct}%`}
									style:width={`${task.widthPct}%`}
								></div>
							</div>
						</div>
					{/each}
					<a class="project-detail-link" href={withBase(`/projects/${project.id}`)}>
						查看项目详情与全部任务 <ArrowRight size={13} />
					</a>
				</div>
			{/if}
		{:else}
			<p class="empty-projects">当前筛选条件下暂无项目</p>
		{/each}
	</div>
</ModuleCard>

{#if canCreate}
	<button
		class="floating-create-button"
		type="button"
		onclick={openNewProject}
		aria-label="新建项目"
		title="新建项目"
	>
		<Plus size={23} />
	</button>
{/if}

<dialog class="new-project-modal" bind:this={newProjectDialog}>
	<form method="post" action="?/createProject" use:enhance={enhanceProjectAction('create', 'create')}>
		<div class="modal-header">
			<div>
				<p class="eyebrow">NEW PROJECT</p>
				<h2>新建融资项目</h2>
				<p>项目独立建档，不读取、不绑定也不修改现有负债。</p>
			</div>
			<button type="button" aria-label="关闭" onclick={() => newProjectDialog.close()}>×</button>
		</div>
		<div class="form-grid">
			<label class="wide">
				<span>项目名称</span>
				<input name="name" maxlength="160" required />
			</label>
			<label class="wide">
				<span>融资品种 / SOP</span>
				<select name="sopTemplateId" required disabled={projectOptionsStatus !== 'ready'}>
					<option value="">
						{projectOptionsStatus === 'loading' ? '正在加载选项…' : '请选择融资品种'}
					</option>
					{#each projectOptions.projectSops as sop}
						<option value={sop.id}>{sop.debtType} · {sop.name}</option>
					{/each}
				</select>
			</label>
			<label>
				<span>项目规模（亿元）</span>
				<input name="amountYi" type="number" min="0" step="0.01" inputmode="decimal" />
			</label>
			<label>
				<span>负责人</span>
				<select name="ownerId" value={data.viewContext.personId ?? ''} disabled={projectOptionsStatus !== 'ready'}>
					<option value="">待分配</option>
					{#each projectOptions.people as person}
						<option value={person.id}>{person.name}</option>
					{/each}
				</select>
			</label>
			<label>
				<span>计划簿记</span>
				<input name="plannedBookbuildingDate" type="date" bind:value={newProjectBookbuildingDate} required />
			</label>
			<label class="wide">
				<span>项目说明</span>
				<textarea name="notes" rows="3" maxlength="4000"></textarea>
			</label>
		</div>
		<div class="modal-note">
			{#if projectOptionsStatus === 'loading'}<LoaderCircle class="spin" size={15} />{:else}<CheckCircle2 size={15} />{/if}
			<span>
				{#if projectOptionsStatus === 'loading'}
					正在按需加载人员和 SOP 选项…
				{:else if projectOptionsStatus === 'error'}
					选项加载失败，请关闭后重试。
				{:else if projectOptions.projectSops.length === 0}
					暂无启用中的 SOP，请先在 SOP 管理中启用至少一个模板。
				{:else}
					创建后会按所选 SOP 生成项目节点，现有负债数据保持不变。
				{/if}
			</span>
		</div>
		<div class="modal-actions">
			<button type="button" disabled={actionState.status === 'pending'} onclick={() => newProjectDialog.close()}>取消</button>
			<button
				class="primary-action"
				type="submit"
				disabled={actionState.status === 'pending' || projectOptionsStatus !== 'ready' || projectOptions.projectSops.length === 0}
			>
				{#if actionState.status === 'pending' && actionState.key === 'create'}<LoaderCircle class="spin" size={16} />{/if}
				{actionState.status === 'pending' && actionState.key === 'create' ? '创建中…' : '创建项目'}
			</button>
		</div>
	</form>
</dialog>

<dialog class="new-project-modal" bind:this={editProjectDialog}>
	{#if editingProject}
		<form method="post" action="?/updateProject" use:autoSave use:enhance={enhanceProjectAction('edit')}>
			<div class="modal-header">
				<div>
					<p class="eyebrow">EDIT PROJECT</p>
					<h2>修改融资项目</h2>
					<p>修改后会自动保存，不再需要逐项确认。</p>
				</div>
				<button type="button" aria-label="关闭" onclick={() => editProjectDialog.close()}>×</button>
			</div>
			<input type="hidden" name="id" value={editingProject.id} />
			<div class="form-grid">
				<label class="wide">
					<span>项目名称</span>
					<input name="name" maxlength="160" required value={editingProject.name} />
				</label>
				<label class="wide">
					<span>融资品种</span>
					<input value={editingProject.type} readonly />
				</label>
				<label>
					<span>项目状态</span>
					<select name="status" value={editingProject.rawStatus} required>
						<option value="planning">规划中</option>
						<option value="in_progress">执行中</option>
						<option value="at_risk">存在风险</option>
						<option value="completed">已完成</option>
						<option value="cancelled">已取消</option>
					</select>
				</label>
				<label>
					<span>负责人</span>
					<select name="ownerId" value={editingProject.ownerId ?? ''}>
						<option value="">待分配</option>
						{#if projectOptionsStatus !== 'ready' && editingProject.ownerId}
							<option value={editingProject.ownerId}>{editingProject.owner}</option>
						{/if}
						{#each projectOptions.people as person}
							<option value={person.id}>{person.name}</option>
						{/each}
					</select>
				</label>
				<label>
					<span>计划簿记</span>
					<input name="plannedBookbuildingDate" type="date" value={editingProject.plannedBookbuildingDate} required />
				</label>
				<label class="wide">
					<span>项目说明</span>
					<textarea name="notes" rows="4" maxlength="4000">{editingProject.notes}</textarea>
				</label>
			</div>
			<div class="modal-actions">
				<p class="auto-save-status">修改后自动保存</p>
				<button type="button" onclick={() => editProjectDialog.close()}>关闭</button>
			</div>
		</form>
	{/if}
</dialog>

<style>
	.primary-action {
		display: inline-flex;
		min-height: 2.75rem;
		align-items: center;
		justify-content: center;
		gap: 0.4375rem;
		padding: 0 0.8125rem;
		border: 1px solid var(--color-primary);
		border-radius: 0.5rem;
		font-size: 1rem;
		font-weight: bold;
		color: #fff;
		background: var(--color-primary);
		box-shadow: 0 1px 2px rgb(47 111 237 / 20%);
		cursor: pointer;
		transition: background 180ms ease;
	}

	.primary-action:hover {
		background: #245fd3;
	}

	.primary-action:disabled,
	.modal-actions button:disabled {
		opacity: 0.6;
		cursor: wait;
	}

	.spin {
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(1turn);
		}
	}

	.summary-strip {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		margin-bottom: 0.75rem;
		border: 1px solid var(--border);
		border-radius: 0.625rem;
		background: #fff;
		box-shadow: 0 1px 2px rgb(16 24 40 / 4%);
	}

	.summary-strip > div {
		display: flex;
		align-items: center;
		gap: 0.6875rem;
		min-height: 4.625rem;
		padding: 0.75rem 1.125rem;
		border-right: 1px solid #eaecf0;
	}

	.summary-strip > div:last-child {
		border-right: 0;
	}

	.summary-icon {
		display: grid;
		width: 2.125rem;
		height: 2.125rem;
		flex: 0 0 auto;
		place-items: center;
		border-radius: 0.5rem;
	}

	.summary-icon.blue {
		color: var(--color-primary);
		background: #edf4ff;
	}

	.summary-icon.orange {
		color: #dc6803;
		background: #fff4e8;
	}

	.summary-icon.red {
		color: #d92d20;
		background: #fef3f2;
	}

	.summary-icon.green {
		color: #079455;
		background: #ecfdf3;
	}

	.summary-strip p {
		display: grid;
		margin: 0;
	}

	.summary-strip strong {
		font-family: 'SFMono-Regular', Consolas, monospace;
		font-size: 1.25rem;
		line-height: 1.1;
		color: #101828;
	}

	.summary-strip p span {
		margin-top: 0.1875rem;
		font-size: 0.75rem;
		color: #98a2b3;
	}

	.toolbar {
		display: flex;
		min-height: 3.375rem;
		align-items: center;
		gap: 0.625rem;
		margin-bottom: 0.75rem;
		padding: 0.5625rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: 0.625rem;
		background: #fff;
	}

	.search-field {
		display: flex;
		height: 2.125rem;
		width: 15rem;
		align-items: center;
		gap: 0.4375rem;
		padding: 0 0.625rem;
		border: 1px solid #d0d5dd;
		border-radius: 0.4375rem;
		color: #98a2b3;
	}

	.search-field input {
		width: 100%;
		border: 0;
		outline: 0;
		font-size: 0.75rem;
		color: #344054;
		background: transparent;
	}

	.select-group {
		display: flex;
		align-items: center;
		gap: 0.4375rem;
		color: #98a2b3;
	}

	.select-group :global(.multi-filter) {
		flex: 1 1 10rem;
	}

	.view-switcher {
		display: flex;
		height: 2.125rem;
		margin-left: auto;
		padding: 0.1875rem;
		border: 1px solid #d0d5dd;
		border-radius: 0.4375rem;
		background: #f9fafb;
	}

	.view-switcher button {
		min-width: 2rem;
		border: 0;
		border-radius: 0.3125rem;
		font-size: 0.75rem;
		color: #667085;
		background: transparent;
		cursor: pointer;
	}

	.view-switcher button.active {
		color: var(--color-primary);
		background: #fff;
		box-shadow: 0 1px 2px rgb(16 24 40 / 10%);
	}

	.gantt-panel {
	overflow: hidden;
	margin-bottom: 0.75rem;
	}

	.gantt-head,
	.project-row,
	.task-row {
		display: grid;
		grid-template-columns: minmax(17.5rem, 30%) 7.875rem minmax(32.5rem, 1fr);
	}

	.gantt-head {
		min-height: 4.25rem;
		border-bottom: 1px solid #dfe3e8;
		font-size: 0.75rem;
		font-weight: bold;
		color: #667085;
		background: #f8fafc;
	}

	.project-column-title,
	.status-column-title {
		display: flex;
		align-items: center;
		padding: 0 1rem;
		border-right: 1px solid var(--border);
	}

	.timeline-head {
		min-width: 0;
	}

	.month-band,
	.week-band {
		display: flex;
		align-items: center;
		text-align: center;
	}

	.month-band {
		height: 2rem;
		border-bottom: 1px solid var(--border);
	}

	.month-band span {
		min-width: 0;
		flex: 0 0 auto;
		height: 100%;
		overflow: hidden;
		padding-top: 0.5625rem;
		border-right: 1px solid var(--border);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.month-band span:last-child {
		border-right: 0;
	}

	.week-band {
		height: 2.1875rem;
	}

	.week-band span {
		min-width: 0;
		flex: 0 0 auto;
		height: 100%;
		overflow: hidden;
		padding-top: 0.625rem;
		border-right: 1px solid #eaecf0;
		font-weight: normal;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.project-row {
		position: relative;
		min-height: 4.9375rem;
		border-bottom: 1px solid #eaecf0;
		transition: background 180ms ease;
	}

	.project-row:hover,
	.project-row.expanded {
		background: #fbfcfe;
	}

	.project-info {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6875rem 0.875rem 0.6875rem 0.5rem;
		border-right: 1px solid #eaecf0;
	}

	.expand-button {
		display: grid;
		width: 1.6875rem;
		height: 1.875rem;
		flex: 0 0 auto;
		place-items: center;
		border: 0;
		border-radius: 0.3125rem;
		color: #98a2b3;
		background: transparent;
		cursor: pointer;
	}

	.expand-button:hover {
		color: var(--color-primary);
		background: #edf4ff;
	}

	.project-info > div:nth-child(2) {
		min-width: 0;
	}

	.project-info a {
		display: block;
		overflow: hidden;
		font-size: 0.75rem;
		font-weight: bold;
		color: #1d2939;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.project-info a:hover {
		color: var(--color-primary);
	}

	.project-info p {
		display: flex;
		align-items: center;
		gap: 0.3125rem;
		margin: 0.25rem 0 0;
		font-size: 0.75rem;
		color: #98a2b3;
	}

	.project-info p i {
		width: 2px;
		height: 2px;
		border-radius: 50%;
		background: #cbd0d8;
	}

	.project-people {
		display: flex;
		margin-left: auto;
		padding-left: 0.5rem;
	}

	.project-people span {
		display: grid;
		width: 1.5rem;
		height: 1.5rem;
		margin-left: -0.375rem;
		place-items: center;
		border: 2px solid #fff;
		border-radius: 50%;
		font-size: 0.75rem;
		font-weight: bold;
		color: var(--color-primary);
		background: #e9f1ff;
	}

	.project-row-actions {
		display: flex;
		flex: 0 0 auto;
		gap: 0.25rem;
		margin-left: 0.25rem;
	}

	.project-row-actions form {
		display: contents;
	}

	.project-row-actions button {
		display: grid;
		width: 2.75rem;
		height: 2.75rem;
		place-items: center;
		border: 1px solid #d0d5dd;
		border-radius: 0.4375rem;
		color: #475467;
		background: #fff;
		cursor: pointer;
	}

	.project-row-actions button:hover {
		border-color: #84adff;
		color: var(--color-primary);
		background: #eff4ff;
	}

	.project-row-actions button.danger-action:hover {
		border-color: #fda29b;
		color: #b42318;
		background: #fef3f2;
	}

	.project-row-actions button:disabled {
		cursor: wait;
		opacity: 0.55;
	}

	.project-status {
		display: grid;
		grid-template-columns: 1fr auto;
		align-content: center;
		gap: 0.375rem 0.4375rem;
		padding: 0.625rem 0.8125rem;
		border-right: 1px solid #eaecf0;
	}

	.status-pill {
		grid-column: 1 / -1;
		justify-self: start;
		padding: 0.25rem 0.4375rem;
		border: 1px solid #d6e4ff;
		border-radius: 0.3125rem;
		font-size: 0.75rem;
		font-weight: bold;
		color: var(--color-primary);
		background: #eff4ff;
	}

	.status-pill.teal {
		border-color: #a6f4c5;
		color: #067647;
		background: #ecfdf3;
	}

	.status-pill.violet {
		border-color: #d9d6fe;
		color: #5925dc;
		background: #f4f3ff;
	}

	.status-pill.orange {
		border-color: #fedf89;
		color: #b54708;
		background: #fffaeb;
	}

	.status-pill.gray {
		border-color: var(--border);
		color: #475467;
		background: #f9fafb;
	}

	.progress-line {
		height: 0.1875rem;
		align-self: center;
		overflow: hidden;
		border-radius: 6.1875rem;
		background: #eaecf0;
	}

	.progress-line span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--color-primary);
	}

	.project-status small {
		font-size: 0.75rem;
		color: #98a2b3;
	}

	.timeline-cell,
	.task-timeline {
		position: relative;
		overflow: hidden;
		background-image: linear-gradient(to right, #eef0f3 1px, transparent 1px);
		background-size: calc(100% / var(--timeline-columns, 1)) 100%;
	}

	.today-line {
		position: absolute;
		z-index: 2;
		top: 0;
		bottom: 0;
		width: 1px;
		background: #f04438;
	}

	.empty-projects {
		margin: 0;
		padding: 2rem 1rem;
		font-size: 1rem;
		color: #667085;
		text-align: center;
	}

	.today-line span {
		position: absolute;
		top: 0.25rem;
		left: 0.25rem;
		padding: 1px 0.25rem;
		border-radius: 0.1875rem;
		font-size: 0.75rem;
		font-weight: bold;
		color: #b42318;
		background: #fef3f2;
	}

	.project-bar {
		position: absolute;
		z-index: 1;
		top: 1.875rem;
		height: 1.25rem;
		min-width: 1rem;
		overflow: hidden;
		border-radius: 0.3125rem;
		background: linear-gradient(90deg, #356ee0, #5d8cf0);
		box-shadow: 0 2px 0.3125rem rgb(47 111 237 / 18%);
	}

	.project-bar.teal {
		background: linear-gradient(90deg, #0e9384, #38b8a8);
	}

	.project-bar.violet {
		background: linear-gradient(90deg, #6941c6, #875bf7);
	}

	.project-bar.orange {
		background: linear-gradient(90deg, #dc6803, #f79009);
	}

	.project-bar.gray {
		background: linear-gradient(90deg, #667085, #98a2b3);
	}

	.project-bar span {
		display: block;
		padding: 0.25rem 0.4375rem;
		font-size: 0.75rem;
		font-weight: bold;
		color: #fff;
	}

	.next-node {
		position: absolute;
		top: 3.375rem;
		display: flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.75rem;
		color: #667085;
		white-space: nowrap;
	}

	.next-node i {
		width: 0.375rem;
		height: 0.375rem;
		border: 2px solid var(--color-primary);
		border-radius: 50%;
		background: #fff;
	}

	.mobile-project-meta {
		display: none;
	}

	.task-rows {
		border-bottom: 1px solid #dfe3e8;
		background: #f9fbfd;
	}

	.task-row {
		min-height: 2.4375rem;
		color: #667085;
	}

	.task-info,
	.task-status {
		display: flex;
		align-items: center;
		border-right: 1px solid #eaecf0;
		font-size: 0.75rem;
	}

	.task-info {
		gap: 0.4375rem;
		padding-left: 3.125rem;
	}

	.task-status {
		padding-left: 0.875rem;
	}

	.task-dot {
		width: 0.4375rem;
		height: 0.4375rem;
		border: 2px solid #98a2b3;
		border-radius: 50%;
	}

	.task-dot.done {
		border-color: #12b76a;
		background: #12b76a;
	}

	.task-dot.doing {
		border-color: var(--color-primary);
		background: #dbe8ff;
	}

	.task-bar {
		position: absolute;
		top: 0.9375rem;
		height: 0.5rem;
		border-radius: 6.1875rem;
		background: #98a2b3;
	}

	.task-bar.done {
		background: #12b76a;
	}

	.task-bar.doing {
		background: var(--color-primary);
	}

	.project-detail-link {
		display: flex;
		min-height: 2.125rem;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		border-top: 1px solid #eef0f3;
		font-size: 0.75rem;
		font-weight: bold;
		color: var(--color-primary);
	}

	.new-project-modal {
		width: min(35rem, calc(100vw - 2rem));
		padding: 0;
		border: 0;
		border-radius: 0.8125rem;
		color: #1d2939;
		background: #fff;
		box-shadow: 0 1.5rem 3rem rgb(16 24 40 / 22%);
	}

	.new-project-modal::backdrop {
		background: rgb(10 18 31 / 55%);
		backdrop-filter: blur(2px);
	}

	.new-project-modal form {
		padding: 1.25rem;
	}

	.modal-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		padding-bottom: 0.9375rem;
		border-bottom: 1px solid #eaecf0;
	}

	.modal-header h2 {
		margin: 0;
		font-size: 1.125rem;
	}

	.modal-header p:not(.eyebrow) {
		margin: 0.3125rem 0 0;
		font-size: 0.75rem;
		color: #667085;
	}

	.modal-header button {
		display: grid;
		width: 2.125rem;
		height: 2.125rem;
		place-items: center;
		border: 0;
		border-radius: 0.375rem;
		font-size: 1.375rem;
		color: #667085;
		background: #f2f4f7;
		cursor: pointer;
	}

	.form-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.8125rem;
		padding: 1.0625rem 0;
	}

	.form-grid label {
		display: grid;
		gap: 0.3125rem;
	}

	.form-grid label.wide {
		grid-column: 1 / -1;
	}

	.form-grid label span {
		font-size: 0.75rem;
		font-weight: bold;
		color: #475467;
	}

	.form-grid input,
	.form-grid select,
	.form-grid textarea {
		min-height: 2.75rem;
		padding: 0 0.625rem;
		border: 1px solid #d0d5dd;
		border-radius: 0.4375rem;
		font-size: 1rem;
		color: #344054;
		background: #fff;
	}

	.form-grid textarea {
		padding-block: 0.625rem;
		resize: vertical;
	}

	.form-grid input[readonly] {
		color: #667085;
		background: #f9fafb;
	}

	.modal-note {
		display: flex;
		align-items: center;
		gap: 0.4375rem;
		padding: 0.5625rem 0.625rem;
		border-radius: 0.4375rem;
		font-size: 0.75rem;
		color: var(--color-primary);
		background: #eff4ff;
	}

	.modal-actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.5rem;
		padding-top: 1rem;
	}

	.modal-actions > button:not(.primary-action) {
		min-height: 2.75rem;
		padding: 0 0.8125rem;
		border: 1px solid #d0d5dd;
		border-radius: 0.5rem;
		font-size: 1rem;
		color: #475467;
		background: #fff;
		cursor: pointer;
	}

	.auto-save-status {
		margin: 0 auto 0 0;
		font-size: 0.75rem;
		color: #067647;
	}

	@media (max-width: 75rem) {
		.gantt-panel {
			overflow-x: auto;
		}

		.gantt-head,
		.project-row,
		.task-row {
			min-width: 65.625rem;
		}

		.select-group :global(svg) {
			display: none;
		}
	}

	@media (max-width: 51.25rem) {
		.summary-strip {
			grid-template-columns: 1fr 1fr;
		}

		.summary-strip > div:nth-child(2) {
			border-right: 0;
		}

		.summary-strip > div:nth-child(-n + 2) {
			border-bottom: 1px solid #eaecf0;
		}

		.toolbar {
			flex-wrap: wrap;
		}

		.search-field {
			flex: 1 1 13.75rem;
		}

		.select-group {
			order: 3;
			width: 100%;
		}

		.gantt-panel {
			overflow: visible;
			border: 0;
			background: transparent;
			box-shadow: none;
		}

		.gantt-head {
			display: none;
		}

		.project-row {
			display: grid;
			min-width: 0;
			grid-template-columns: minmax(0, 1fr) 6.625rem;
			margin-bottom: 0.5625rem;
			border: 1px solid var(--border);
			border-radius: 0.625rem;
			background: #fff;
			box-shadow: 0 1px 2px rgb(16 24 40 / 4%);
		}

		.project-info,
		.project-status {
			border-right: 0;
		}

		.timeline-cell {
			display: none;
		}

		.mobile-project-meta {
			display: grid;
			grid-column: 1 / -1;
			gap: 0.3125rem;
			padding: 0.625rem 0.875rem;
			border-top: 1px solid #eaecf0;
			font-size: 0.75rem;
			color: #667085;
			background: #f9fafb;
		}

		.mobile-project-meta div {
			display: flex;
			align-items: center;
			gap: 0.3125rem;
		}

		.task-rows {
			display: none;
		}

	}

	@media (max-width: 35rem) {
		.summary-strip > div {
			padding: 0.625rem 0.75rem;
		}

		.select-group {
			display: grid;
			grid-template-columns: 1fr 1fr;
		}

		.select-group :global(.multi-filter:last-child) {
			grid-column: 1 / -1;
		}

		.form-grid {
			grid-template-columns: 1fr;
		}

		.form-grid label.wide {
			grid-column: auto;
		}
	}
</style>
