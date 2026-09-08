<script lang="ts">
import PanelHeading from '$lib/trading-research/PanelHeading.svelte';
import ModuleCard from '../../../components/ModuleCard.svelte';
	import '../management.css';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { untrack } from 'svelte';
	import {
		ArrowRight,
		BellRing,
		Clock3,
		GitBranch,
		Mail,
		Plus,
		Trash2,
		UserRound,
		Users,
		Workflow
	} from '@lucide/svelte';
	import { globalMessages } from '$lib/global-messages';
	import { withBase } from '$lib/financing/app-paths';
	import { MAX_REMINDER_PERIODS, reminderPeriodLabel } from '$lib/financing/reminder-periods.js';
	import { hasPermission } from '$lib/financing/permissions.js';

	let { data } = $props();
	let reminderDialog = $state<HTMLDialogElement>();
	let sopDialog = $state<HTMLDialogElement>();
	let reminderRecipientMode = $state('assignee');
	let reminderPeriodSequence = 1;
	let reminderPeriods = $state([{ key: 'period-1', days: 3, hours: 0 }]);
	let actionState = $state<{
		key: string;
		status: 'idle' | 'pending';
	}>({ key: '', status: 'idle' });

	const fallback = {
		sopTemplates: [],
		reminderRules: []
	};
	let displayedSettings = $state(untrack(() => data?.settings ?? fallback));
	$effect(() => {
		displayedSettings = data?.settings ?? fallback;
	});
	const settings = $derived(displayedSettings);
	const canManage = $derived(hasPermission(data?.permissions, 'sop_manage'));
	const canCreateSop = $derived(canManage);
	const activeSopTemplates = $derived(
		settings.sopTemplates.filter((sop: { isActive: boolean }) => sop.isActive)
	);

	function resetReminderDraft() {
		reminderRecipientMode = 'assignee';
		reminderPeriodSequence += 1;
		reminderPeriods = [{ key: `period-${reminderPeriodSequence}`, days: 3, hours: 0 }];
	}

	function addReminderPeriod() {
		if (reminderPeriods.length >= MAX_REMINDER_PERIODS) return;
		const usedLeadHours = new Set(reminderPeriods.map((period) => period.days * 24 + period.hours));
		let leadHours = 24;
		while (usedLeadHours.has(leadHours)) leadHours += 24;
		reminderPeriodSequence += 1;
		reminderPeriods = [...reminderPeriods, {
			key: `period-${reminderPeriodSequence}`,
			days: Math.floor(leadHours / 24),
			hours: leadHours % 24
		}];
	}

	function removeReminderPeriod(key: string) {
		if (reminderPeriods.length === 1) return;
		reminderPeriods = reminderPeriods.filter((period) => period.key !== key);
	}

	const enhanceAction = (key: string, successMessage: string): SubmitFunction => {
		return ({ formElement }) => {
			actionState = { key, status: 'pending' };
			return async ({ result, update }) => {
				if (result.type === 'success') {
					if (result.data?.sopTemplate) {
						displayedSettings = {
							...displayedSettings,
							sopTemplates: [...displayedSettings.sopTemplates, result.data.sopTemplate]
								.sort((left: any, right: any) => `${left.debtType}\0${left.name}`.localeCompare(`${right.debtType}\0${right.name}`, 'zh-CN'))
						};
					}
					if (result.data?.reminderRule) {
						displayedSettings = {
							...displayedSettings,
							reminderRules: [...displayedSettings.reminderRules, result.data.reminderRule]
								.sort((left: any, right: any) => Number(right.isActive) - Number(left.isActive) || left.name.localeCompare(right.name, 'zh-CN'))
						};
					}
					await update({ reset: false, invalidateAll: false });
					globalMessages.success(String(result.data?.message ?? successMessage), {
						key: 'sop-management-action'
					});
					actionState = { key: '', status: 'idle' };
					if (key === 'reminder') {
						formElement.reset();
						resetReminderDraft();
						reminderDialog?.close();
					}
					if (key === 'sop') sopDialog?.close();
					return;
				}
				await update({ reset: false, invalidateAll: false });
				const message = result.type === 'failure'
					? String(result.data?.message ?? '提交失败，请检查后重试')
					: result.type === 'error' && result.error?.message
						? result.error.message
						: '提交失败，请稍后重试';
				globalMessages.error(message, { key: 'sop-management-action' });
				actionState = { key: '', status: 'idle' };
			};
		};
	};
</script>

<svelte:head>
	<title>SOP 管理 · 融资工作台</title>
</svelte:head>

<div class="management-page workflow-page">
	<section class="workflow-grid">
		<ModuleCard class="section-card">
			<PanelHeading id="sop-heading-0" title="负债品种 SOP" controlsInline>{#if canCreateSop}
					<button class="link-button" type="button" onclick={() => sopDialog?.showModal()}>
						<Plus size={14} /> 新建
					</button>
				{/if}</PanelHeading>
			<div class="sop-list">
				{#each settings.sopTemplates as sop}
					<a class="sop-item" href={withBase(`/sop/${sop.id}`)}>
						<span class="sop-type">{sop.debtType.slice(0, 2)}</span>
						<div class="sop-copy">
							<div>
								<strong>{sop.name}</strong>
								<span class:inactive={!sop.isActive} class="status-badge">
									{sop.isActive ? '启用' : '停用'}
								</span>
							</div>
							<p>{sop.description}</p>
							<div class="sop-meta">
								<span><GitBranch size={13} /> {sop.nodeCount} 个节点</span>
								<span><Users size={13} /> 按默认角色分工</span>
							</div>
						</div>
						<ArrowRight size={16} />
					</a>
				{:else}
					<p class="empty-state">尚未配置 SOP。未配置品种不会生成首页付息和到期事件。</p>
				{/each}
			</div>
		</ModuleCard>

		<ModuleCard class="section-card">
			<PanelHeading id="sop-heading-1" title="提醒规则" controlsInline><div class="header-actions">
					<a class="link-button" href={withBase('/sop/reminders')}>发送历史</a>
					{#if canManage}
						<button class="link-button" type="button" onclick={() => reminderDialog?.showModal()}>
							<Plus size={14} /> 新建
						</button>
					{/if}
				</div></PanelHeading>
			<div class="reminder-list">
				{#each settings.reminderRules as rule}
					<div class="reminder-item">
						<span class="channel-icon"><Mail size={17} /></span>
						<div>
							<div class="rule-title">
								<strong>{rule.name}</strong>
								<span class:inactive={!rule.isActive} class="status-badge">
									{rule.isActive ? '启用' : '停用'}
								</span>
							</div>
							<p>
								<GitBranch size={13} />
								{rule.targets.length} 个节点：{rule.targets.map((target: any) => `${target.sopName} / ${target.name}`).join('、')}
							</p>
							<div class="rule-meta">
								<span><Clock3 size={12} /> {rule.periods.map((period: any) => reminderPeriodLabel(period.leadHours)).join('、')}</span>
								<span><UserRound size={12} />
									{rule.recipientMode === 'owner'
										? '项目负责人'
										: rule.recipientMode === 'custom'
											? '指定邮箱'
											: '任务负责人'}
								</span>
							</div>
						</div>
					</div>
				{:else}
					<p class="empty-state">尚未配置提醒规则。</p>
				{/each}
				{#if canManage}
					<button class="add-rule" type="button" onclick={() => reminderDialog?.showModal()}>
						<Plus size={15} />
						添加提醒规则
					</button>
				{/if}
			</div>
		</ModuleCard>
	</section>

	{#if canCreateSop}
	<button
		class="floating-create-button"
		type="button"
		onclick={() => sopDialog?.showModal()}
		aria-label="新建 SOP"
		title="新建 SOP"
	>
		<Plus size={23} />
	</button>
	{/if}

	{#if canManage}
	<dialog class="config-modal" bind:this={reminderDialog}>
		<form method="post" action="?/createReminder" use:enhance={enhanceAction('reminder', '提醒规则已保存')}>
			<div class="modal-header">
				<div>
					<p class="eyebrow">REMINDER RULE</p>
					<h2>配置邮件提醒</h2>
					<p>一条规则可关联多个 SOP 节点，并配置多个提前提醒周期。</p>
				</div>
				<button type="button" aria-label="关闭" onclick={() => reminderDialog?.close()}>×</button>
			</div>
			<div class="form-grid">
				<label class="wide">
					<span>规则名称</span>
					<input name="name" required value="任务到期提醒" />
				</label>
				<fieldset class="wide rule-fieldset node-selector">
					<legend>关联 SOP 节点（可多选）</legend>
					<p id="node-selector-help">仅展示已启用 SOP，提醒只匹配由所选节点生成的项目任务。</p>
					<div class="node-groups" aria-describedby="node-selector-help">
						{#each activeSopTemplates as sop}
							<section class="node-group">
								<strong>{sop.name}<span>{sop.debtType}</span></strong>
								<div>
									{#each sop.nodes as node}
										<label>
											<input type="checkbox" name="nodeIds" value={node.id} />
											<span>{node.name}</span>
										</label>
									{:else}
										<p>该 SOP 尚未配置节点</p>
									{/each}
								</div>
							</section>
						{:else}
							<p class="empty-selector">尚无可关联的已启用 SOP 节点。</p>
						{/each}
					</div>
				</fieldset>
				<fieldset class="wide rule-fieldset period-editor">
					<legend>提醒周期（可多选）</legend>
					<div class="fieldset-heading">
						<p>整天周期在对应日期 09:00（上海时间）提醒；包含小时的周期按节点到期日 00:00 倒推到实际整点。</p>
						<button type="button" class="add-period" onclick={addReminderPeriod} disabled={reminderPeriods.length >= MAX_REMINDER_PERIODS}><Plus size={14} /> 添加周期</button>
					</div>
					<div class="period-list">
						{#each reminderPeriods as period, index (period.key)}
							<div class="period-row">
								<span>第 {index + 1} 次</span>
								<label>
									<span>天</span>
									<input name="periodDays" type="number" min="0" max="3650" step="1" required bind:value={period.days} />
								</label>
								<label>
									<span>小时</span>
									<input name="periodHours" type="number" min="0" max="23" step="1" required bind:value={period.hours} />
								</label>
								<button
									type="button"
									class="remove-period"
									onclick={() => removeReminderPeriod(period.key)}
									disabled={reminderPeriods.length === 1}
									aria-label={`删除第 ${index + 1} 个提醒周期`}
									title="删除周期"
								><Trash2 size={15} /></button>
							</div>
						{/each}
					</div>
				</fieldset>
				<label class="wide">
					<span>收件人</span>
					<select name="recipientMode" bind:value={reminderRecipientMode}>
						<option value="assignee">任务负责人</option>
						<option value="owner">项目负责人</option>
						<option value="custom">指定邮箱</option>
					</select>
				</label>
				{#if reminderRecipientMode === 'custom'}
					<label class="wide">
						<span>指定邮箱</span>
						<input name="recipients" type="text" required placeholder="多个邮箱使用逗号分隔" />
					</label>
				{/if}
			</div>
			<div class="modal-actions">
				<button type="button" onclick={() => reminderDialog?.close()}>取消</button>
				<button class="primary-action" type="submit" disabled={actionState.status === 'pending'}>
					{actionState.status === 'pending' && actionState.key === 'reminder' ? '保存中…' : '保存规则'}
				</button>
			</div>
		</form>
	</dialog>
	{/if}

	{#if canCreateSop}
	<dialog class="config-modal" bind:this={sopDialog}>
		<form method="post" action="?/createSop" use:enhance={enhanceAction('sop', 'SOP 模板已创建')}>
			<div class="modal-header">
				<div>
					<p class="eyebrow">SOP TEMPLATE</p>
					<h2>新建负债品种 SOP</h2>
					<p>{canManage ? '保存后再编排节点、默认角色和相对日期。' : '复核可新建模板，节点编排和启停由管理员维护。'}</p>
				</div>
				<button type="button" aria-label="关闭" onclick={() => sopDialog?.close()}>×</button>
			</div>
			<div class="form-grid">
				<label class="wide">
					<span>SOP 名称</span>
					<input name="name" required placeholder="例如：收益凭证发行 SOP" />
				</label>
				<label class="wide">
					<span>负债品种</span>
					<select name="debtType" required>
						<option value="">请选择</option>
						<option>收益凭证</option>
						<option>公司债</option>
						<option>短期融资券</option>
						<option>转融资</option>
						<option>同业拆借</option>
						<option>集团借款</option>
					</select>
				</label>
				<label class="wide">
					<span>说明</span>
					<textarea name="description" rows="3" placeholder="说明适用范围和关键控制要求"></textarea>
				</label>
			</div>
			<div class="modal-actions">
				<button type="button" onclick={() => sopDialog?.close()}>取消</button>
				<button class="primary-action" type="submit" disabled={actionState.status === 'pending'}>
					{actionState.status === 'pending' && actionState.key === 'sop' ? '创建中…' : canManage ? '创建并配置节点' : '创建 SOP'}
				</button>
			</div>
		</form>
	</dialog>
	{/if}
</div>

<style>
	.workflow-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.2fr) minmax(20rem, 0.8fr);
		gap: 1rem;
	}

	.sop-list,
	.reminder-list {
		display: grid;
	}

	.sop-item {
		display: grid;
		grid-template-columns: 2.75rem minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.875rem;
		padding: 1rem 1.125rem;
		border-top: 1px solid var(--line);
		transition: background 180ms ease;
	}

	.sop-item:hover {
		background: #f8faff;
	}

	.sop-type,
	.channel-icon {
		display: grid;
		width: 2.5rem;
		height: 2.5rem;
		place-items: center;
		border-radius: 0.5rem;
		font-size: 0.75rem;
		font-weight: bold;
		color: var(--color-primary);
		background: #eff4ff;
	}

	.sop-copy > div:first-child,
	.rule-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.sop-copy p,
	.reminder-item p {
		margin: 0.25rem 0;
		color: #667085;
	}

	.reminder-item p {
		display: flex;
		align-items: flex-start;
		gap: 0.35rem;
		line-height: 1.55;
	}

	.sop-meta,
	.rule-meta {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.75rem;
		color: #98a2b3;
	}

	.sop-meta span,
	.rule-meta span {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}

	.rule-meta {
		flex-wrap: wrap;
	}

	.reminder-item {
		display: grid;
		grid-template-columns: 2.75rem minmax(0, 1fr);
		gap: 0.75rem;
		padding: 1rem 1.125rem;
		border-top: 1px solid var(--line);
	}

	.channel-icon {
		color: #b54708;
		background: #fff7ed;
	}

	.add-rule {
		min-height: 3rem;
		margin: 0.75rem;
		border: 1px dashed #b9c5d6;
		border-radius: 0.5rem;
		color: var(--color-primary);
		background: #f8faff;
	}

	.rule-fieldset {
		grid-column: 1 / -1;
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}

	.rule-fieldset > legend {
		font-weight: bold;
		color: #344054;
	}

	.rule-fieldset > p,
	.fieldset-heading p {
		margin: 0.25rem 0 0;
		font-size: 0.75rem;
		line-height: 1.5;
		color: #667085;
	}

	.node-groups,
	.period-list {
		display: grid;
		gap: 0.625rem;
		margin-top: 0.625rem;
	}

	.node-groups {
		max-height: min(32vh, 18rem);
		overflow-y: auto;
		padding: 0.625rem;
		border: 1px solid var(--line);
		border-radius: 0.5rem;
		background: #f8fafc;
	}

	.node-group {
		display: grid;
		gap: 0.5rem;
	}

	.node-group + .node-group {
		padding-top: 0.625rem;
		border-top: 1px solid var(--line);
	}

	.node-group > strong {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		color: #1d2939;
	}

	.node-group > strong span {
		font-size: 0.75rem;
		font-weight: normal;
		color: #667085;
	}

	.node-group > div {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.375rem 0.75rem;
	}

	.node-group label {
		display: grid;
		grid-template-columns: 1.25rem minmax(0, 1fr);
		align-items: center;
		gap: 0.5rem;
		min-height: 2.75rem;
		cursor: pointer;
	}

	.node-group input {
		width: 1.125rem;
		min-height: 1.125rem;
		height: 1.125rem;
		padding: 0;
	}

	.fieldset-heading {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.fieldset-heading p {
		flex: 1;
	}

	.add-period {
		display: inline-flex;
		min-height: 2.75rem;
		align-items: center;
		gap: 0.375rem;
		padding-inline: 0.75rem;
		border: 1px solid #b9c5d6;
		border-radius: 0.5rem;
		color: var(--color-primary);
		background: #fff;
	}

	.add-period:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	.period-row {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) minmax(0, 1fr) 2.75rem;
		align-items: end;
		gap: 0.5rem;
	}

	.period-row > span {
		align-self: center;
		font-size: 0.75rem;
		font-weight: bold;
		color: #667085;
	}

	.period-row label {
		display: grid;
		gap: 0.25rem;
	}

	.period-row label span {
		font-size: 0.75rem;
		color: #667085;
	}

	.period-row input {
		width: 100%;
		min-height: 2.75rem;
		padding-inline: 0.75rem;
		border: 1px solid var(--line);
		border-radius: 0.5rem;
	}

	.remove-period {
		display: grid;
		width: 2.75rem;
		height: 2.75rem;
		place-items: center;
		border: 1px solid #f0b9b4;
		border-radius: 0.5rem;
		color: #b42318;
		background: #fff;
	}

	.remove-period:disabled {
		cursor: not-allowed;
		opacity: 0.4;
	}

	@media (max-width: 64rem) {
		.workflow-grid {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 51.25rem) {
		.rule-fieldset {
			grid-column: auto;
		}
		.node-group > div {
			grid-template-columns: 1fr;
		}

		.fieldset-heading {
			align-items: stretch;
			flex-direction: column;
		}

		.period-row {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 2.75rem;
		}

		.period-row > span {
			grid-column: 1 / -1;
		}

		.add-rule {
			margin-right: 4.75rem;
		}
	}
</style>
