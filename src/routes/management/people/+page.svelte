<script lang="ts">
import MetricCard from '../../../components/MetricCard.svelte';
import PanelHeading from '$lib/trading-research/PanelHeading.svelte';
import ModuleCard from '../../../components/ModuleCard.svelte';
	import '../../financing/management.css';
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import { untrack } from 'svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import {
		BadgeCheck,
		BriefcaseBusiness,
		Eye,
		KeyRound,
		Pencil,
		Plus,
		Save,
		Settings2,
		ShieldCheck,
		Trash2,
		UserX,
		Users
	} from '@lucide/svelte';
	import { ROLE_DEFINITIONS, roleLabel } from '$lib/financing/roles';
	import { hasPermission, PERMISSION_CODES, PERMISSION_DEFINITIONS } from '$lib/financing/permissions.js';
	import { globalMessages } from '$lib/global-messages';
	import { MIN_PASSWORD_LENGTH } from '$lib/financing/password-policy';

	let { data } = $props();
	let personDialog = $state<HTMLDialogElement>();
	let editingPerson = $state<any>(null);
	let accountEnabled = $state(true);
	let actionState = $state<{
		key: string;
		status: 'idle' | 'pending';
	}>({ key: '', status: 'idle' });

	const fallback = {
		people: [],
		rolePermissions: { admin: [], handler: [], reviewer: [] }
	};
	let displayedPeople = $state<any[]>(untrack(() => [...(data?.peopleAccess?.people ?? fallback.people)]));
	const initialRolePermissions = untrack(() => ({
		...fallback.rolePermissions,
		...(data?.peopleAccess?.rolePermissions ?? {})
	})) as Record<string, string[]>;
	let displayedRolePermissions = $state<Record<string, string[]>>(initialRolePermissions);
	let permissionDrafts = $state<Record<string, string[]>>(Object.fromEntries(
		Object.entries(initialRolePermissions).map(([role, permissions]) => [role, [...permissions]])
	));
	const peopleAccess = $derived({ people: displayedPeople });
	const roleCount = (role: string) =>
		displayedPeople.filter((person: any) => person.role === role).length;
	const canManage = $derived(hasPermission(data?.permissions, 'people_manage'));
	const canConfigurePermissions = $derived(hasPermission(data?.permissions, 'permission_manage'));
	const canCreate = $derived(canManage);
	const creatableRoles = ROLE_DEFINITIONS;
	const rolePermissionCount = (role: string) => permissionDrafts[role]?.length ?? 0;
	const rolePermissionsDirty = (role: string) => {
		const saved = displayedRolePermissions[role] ?? [];
		const draft = permissionDrafts[role] ?? [];
		return saved.length !== draft.length || saved.some((permission) => !draft.includes(permission));
	};

	function toggleRolePermission(role: string, permission: string, checked: boolean) {
		const current = permissionDrafts[role] ?? [];
		permissionDrafts[role] = checked
			? [...new Set([...current, permission])]
			: current.filter((item) => item !== permission);
	}

	function setAllRolePermissions(role: string, granted: boolean) {
		permissionDrafts[role] = granted ? [...PERMISSION_CODES] : [];
	}

	const enhanceAction = (key: string, closeDialog = false): SubmitFunction => {
		return () => {
			actionState = { key, status: 'pending' };
			return async ({ result, update }) => {
				if (result.type === 'success') {
					const returnedRolePermissions = result.data?.rolePermissions ?? null;
					if (returnedRolePermissions?.role) {
						const role = String(returnedRolePermissions.role);
						const permissions = Array.isArray(returnedRolePermissions.permissions)
							? returnedRolePermissions.permissions.map(String)
							: [];
						displayedRolePermissions[role] = permissions;
						permissionDrafts[role] = [...permissions];
					}
					const returnedPerson = result.data?.person ?? null;
					if (returnedPerson) {
						const exists = displayedPeople.some((person: any) => person.id === returnedPerson.id);
						displayedPeople = exists
							? displayedPeople.map((person: any) => person.id === returnedPerson.id ? returnedPerson : person)
							: [...displayedPeople, returnedPerson];
					}
					const deletedPersonId = String(result.data?.deletedPersonId ?? '');
					if (deletedPersonId) {
						displayedPeople = displayedPeople.filter((person: any) => person.id !== deletedPersonId);
					}
					await update({ reset: false, invalidateAll: false });
					if (result.data?.refreshIdentity) {
						await invalidate('financing:identity');
					}
					if (returnedRolePermissions) {
						await invalidate('financing:permissions');
					}
					if (returnedPerson && editingPerson?.id === returnedPerson.id) editingPerson = returnedPerson;
					globalMessages.success(String(result.data?.message ?? '人员与账号信息已保存'), {
						key: 'people-action'
					});
					actionState = { key: '', status: 'idle' };
					if (closeDialog) personDialog?.close();
					return;
				}
				await update({ reset: false, invalidateAll: false });
				const message = result.type === 'failure'
					? String(result.data?.message ?? '保存失败，请检查后重试')
					: result.type === 'error' && result.error?.message
						? result.error.message
						: '保存失败，请稍后重试';
				globalMessages.error(message, { key: 'people-action' });
				actionState = { key: '', status: 'idle' };
			};
		};
	};

	function openPerson(person: any = null) {
		editingPerson = person;
		accountEnabled = person ? Boolean(person.accountId) : canManage;
		personDialog?.showModal();
	}
</script>

<svelte:head>
	<title>人员与权限 · 管理中心</title>
</svelte:head>

<div class="management-page people-page">
	<section class="role-grid" aria-label="系统角色">
		{#each ROLE_DEFINITIONS as role, index}
      <MetricCard label={role.label} value={String(roleCount(role.code))} unit="人" detail={role.description}
        tone={index === 0 ? 'blue' : index === 1 ? 'teal' : 'purple'}
        iconComponent={index === 0 ? ShieldCheck : index === 1 ? BriefcaseBusiness : Eye} />
		{/each}
	</section>

	<ModuleCard class="section-card permission-config-card">
		<PanelHeading id="people-heading-0" title="角色权限配置" controlsInline><span class="count-badge">{PERMISSION_DEFINITIONS.length} 类</span></PanelHeading>

		{#if canConfigurePermissions}
			<div class="permission-grid">
				{#each ROLE_DEFINITIONS as role}
					<form
						class={`permission-role-card role-${role.code}`}
						method="post"
						action="?/saveRolePermissions"
						use:enhance={enhanceAction(`permissions-${role.code}`)}
					>
						<input type="hidden" name="role" value={role.code} />
						<div class="permission-role-header">
							<div>
								<strong>{role.label}</strong>
								<span>{rolePermissionCount(role.code)} / {PERMISSION_DEFINITIONS.length} 已授权</span>
							</div>
							<div class="permission-shortcuts" aria-label={`${role.label}权限快捷操作`}>
								<button type="button" onclick={() => setAllRolePermissions(role.code, true)}>全选</button>
								<button type="button" onclick={() => setAllRolePermissions(role.code, false)}>清空</button>
							</div>
						</div>
						<fieldset>
							<legend class="sr-only">{role.label}权限类型</legend>
							{#each PERMISSION_DEFINITIONS as permission}
								<label class="permission-option">
									<input
										type="checkbox"
										name="permissions"
										value={permission.code}
										checked={permissionDrafts[role.code]?.includes(permission.code)}
										onchange={(event) => toggleRolePermission(role.code, permission.code, event.currentTarget.checked)}
									/>
									<span>
										<strong>{permission.label}</strong>
										<small>{permission.description}</small>
									</span>
								</label>
							{/each}
						</fieldset>
						<button
							class="save-role-permissions"
							type="submit"
							disabled={actionState.status === 'pending' || !rolePermissionsDirty(role.code)}
						>
							<Save size={15} />
							{actionState.status === 'pending' && actionState.key === `permissions-${role.code}`
								? '保存中…'
								: `保存${role.label}权限`}
						</button>
					</form>
				{/each}
			</div>
		{:else}
			<p class="permission-read-only">当前角色可以查看人员信息，但没有“权限配置”权限。</p>
		{/if}
	</ModuleCard>

	<ModuleCard class="section-card identity-card">
		<PanelHeading id="people-heading-1" title="人员与登录权限" controlsInline><span class="count-badge">{peopleAccess.people.length} 人</span></PanelHeading>

		<div class="identity-table" role="table" aria-label="人员、角色与登录权限关联">
			<div class="identity-head" role="row">
				<span role="columnheader">人员</span>
				<span role="columnheader">角色</span>
				<span role="columnheader">登录邮箱</span>
				<span role="columnheader">状态</span>
				<span role="columnheader">操作</span>
			</div>
			{#each peopleAccess.people as person, index}
				<div class:inactive-row={!person.active} class="identity-row" role="row">
					<div class="person-cell" role="cell">
						<span class={`avatar-color color-${(index % 4) + 1}`}>{person.name.slice(0, 1)}</span>
						<div>
							<strong>{person.name}</strong>
							<p>{person.email ?? '未填写邮箱'}</p>
						</div>
					</div>
					<div role="cell">
						<span class={`role-badge role-${person.role}`}><BadgeCheck size={14} />{roleLabel(person.role)}</span>
					</div>
					<div class="account-cell" role="cell">
						{#if person.accountId}
							<KeyRound size={16} />
							<div>
								<strong>{person.email ?? '待设置登录邮箱'}</strong>
								<p>{person.lastLoginAt ? `最近登录 ${person.lastLoginAt}` : '尚未登录'}</p>
							</div>
						{:else}
							<span class="no-account"><UserX size={15} /> 未开通</span>
						{/if}
					</div>
					<div role="cell">
						<span class:inactive={!person.active} class="status-badge">
							{person.active ? '启用' : '停用'}
						</span>
					</div>
					<div class="person-actions" role="cell">
						{#if canManage}
							<button type="button" aria-label={`编辑 ${person.name}`} title="编辑" onclick={() => openPerson(person)}>
								<Pencil size={16} />
							</button>
							<form method="post" action="?/togglePerson" use:enhance={enhanceAction(`toggle-${person.id}`)}>
								<input type="hidden" name="id" value={person.id} />
								<input type="hidden" name="active" value={person.active ? '0' : '1'} />
								<button
									type="submit"
									class="text-action"
									disabled={actionState.status === 'pending' || data.user?.personId === person.id}
								>
									{person.active ? '停用' : '启用'}
								</button>
							</form>
							<form
								method="post"
								action="?/deletePerson"
								use:enhance={enhanceAction(`delete-${person.id}`)}
								onsubmit={(event) => {
									if (!confirm(`确定删除 ${person.name} 及其登录权限吗？项目中的负责人关联将被清空。`)) event.preventDefault();
								}}
							>
								<input type="hidden" name="id" value={person.id} />
								<button
									type="submit"
									class="danger-action"
									aria-label={`删除 ${person.name}`}
									title="删除"
									disabled={actionState.status === 'pending' || data.user?.personId === person.id}
								>
									<Trash2 size={16} />
								</button>
							</form>
						{:else}
							<span class="read-only-copy">没有人员与账号维护权限</span>
						{/if}
					</div>
				</div>
			{:else}
				<p class="empty-state">暂无人员，请先添加人员并配置角色与登录权限。</p>
			{/each}
		</div>
	</ModuleCard>

	{#if canCreate}
		<button
			class="floating-create-button"
			type="button"
			onclick={() => openPerson()}
			aria-label="添加人员"
			title="添加人员"
		>
			<Plus size={23} />
		</button>
	{/if}

	{#if canCreate}
	<dialog class="config-modal" bind:this={personDialog}>
		<form
			method="post"
			action={editingPerson ? '?/updatePerson' : '?/createPerson'}
			use:enhance={enhanceAction('person', true)}
		>
			<div class="modal-header">
				<div>
					<p class="eyebrow">UNIFIED IDENTITY</p>
					<h2>{editingPerson ? '编辑人员与账号' : '添加人员与账号'}</h2>
					<p>工作邮箱同时作为登录标识，项目责任关系直接使用该人员主档。</p>
				</div>
				<button type="button" aria-label="关闭" onclick={() => personDialog?.close()}>×</button>
			</div>
			{#if editingPerson}
				<input type="hidden" name="id" value={editingPerson.id} />
			{/if}
			<div class="form-grid">
				<label>
					<span>姓名</span>
					<input name="name" required value={editingPerson?.name ?? ''} autocomplete="name" />
				</label>
				<label>
					<span>系统角色</span>
					<select name="role" required value={editingPerson?.role ?? 'handler'}>
					{#each creatableRoles as role}<option value={role.code}>{role.label}</option>{/each}
					</select>
				</label>
				<label class="wide">
					<span>工作邮箱</span>
					<input name="email" type="email" required value={editingPerson?.email ?? ''} autocomplete="email" />
				</label>
				{#if canManage}
					<label class="account-switch wide">
						<input type="checkbox" bind:checked={accountEnabled} />
						<input type="hidden" name="accountEnabled" value={accountEnabled ? '1' : '0'} />
						<span>允许使用邮箱登录</span>
					</label>
				{:else}
					<input type="hidden" name="accountEnabled" value="0" />
					<p class="permission-note wide">当前角色没有人员与账号维护权限。</p>
				{/if}
				{#if canManage && accountEnabled}
					<label class="wide">
						<span>{editingPerson?.accountId ? '重置密码（留空不变）' : data.auth0 ? '初始密码（已注册账号可留空）' : '初始密码'}</span>
						<input
							name="password"
							type="password"
							required={!editingPerson?.accountId && !data.auth0}
							minlength={MIN_PASSWORD_LENGTH}
							autocomplete="new-password"
						/>
					</label>
				{/if}
			</div>
			<div class="modal-actions">
				<button type="button" onclick={() => personDialog?.close()}>取消</button>
				<button class="primary-action" type="submit" disabled={actionState.status === 'pending'}>
					<Save size={15} />
					{actionState.status === 'pending' && actionState.key === 'person' ? '保存中…' : '保存'}
				</button>
			</div>
		</form>
	</dialog>
	{/if}
</div>

<style>
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.role-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 1rem;
		margin-bottom: 1rem;
	}









	.permission-config-card { margin-bottom: 1rem; }

	.permission-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
		gap: 0.875rem;
		padding: 1rem;
		border-top: 1px solid var(--line);
	}

	.permission-role-card {
		display: flex;
		min-width: 0;
		flex-direction: column;
		padding: 0.875rem;
		border: 1px solid #dbe3ef;
		border-top: 0.1875rem solid var(--color-primary);
		border-radius: 0.625rem;
		background: #fff;
	}

	.permission-role-card.role-admin { border-top-color: #5925dc; }
	.permission-role-card.role-reviewer { border-top-color: #067647; }

	.permission-role-header,
	.permission-shortcuts,
	.permission-option,
	.save-role-permissions {
		display: flex;
		align-items: center;
	}

	.permission-role-header {
		justify-content: space-between;
		gap: 0.75rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid var(--line);
	}

	.permission-role-header > div:first-child {
		display: grid;
		gap: 0.125rem;
	}

	.permission-role-header strong { color: #1d2939; }
	.permission-role-header span { font-size: 0.75rem; color: #475467; }
	.permission-shortcuts { gap: 0.375rem; }
	.permission-shortcuts button {
		min-width: 2.75rem;
		min-height: 2.75rem;
		padding: 0.375rem 0.625rem;
		border: 1px solid #d0d5dd;
		border-radius: 0.4375rem;
		font-size: 0.75rem;
		font-weight: bold;
		color: #475467;
		background: #fff;
		transition: border-color 180ms ease, background-color 180ms ease, color 180ms ease;
	}

	.permission-shortcuts button:hover {
		border-color: #84adff;
		color: var(--color-primary);
		background: #f8faff;
	}

	.permission-role-card fieldset {
		display: grid;
		gap: 0.375rem;
		margin: 0;
		padding: 0.75rem 0;
		border: 0;
	}

	.permission-option {
		min-height: 3.5rem;
		gap: 0.625rem;
		padding: 0.5rem 0.625rem;
		border: 1px solid transparent;
		border-radius: 0.5rem;
		cursor: pointer;
		transition: border-color 180ms ease, background-color 180ms ease;
	}

	.permission-option:hover,
	.permission-option:has(input:checked) {
		border-color: #dbe6fb;
		background: #f8faff;
	}

	.permission-option input {
		width: 1.125rem;
		height: 1.125rem;
		flex: 0 0 auto;
		accent-color: var(--color-primary);
	}

	.permission-option span { display: grid; gap: 0.125rem; min-width: 0; }
	.permission-option strong { font-size: 0.875rem; color: #344054; }
	.permission-option small { font-size: 0.75rem; line-height: 1.45; color: #475467; }

	.save-role-permissions {
		min-height: 2.75rem;
		justify-content: center;
		gap: 0.375rem;
		margin-top: auto;
		border: 1px solid var(--color-primary);
		border-radius: 0.5rem;
		font-weight: bold;
		color: #fff;
		background: var(--color-primary);
		transition: border-color 180ms ease, background-color 180ms ease, opacity 180ms ease;
	}

	.save-role-permissions:hover:not(:disabled) { border-color: var(--color-primary); background: var(--color-primary); }
	.save-role-permissions:disabled { cursor: not-allowed; opacity: 0.48; }
	.permission-read-only {
		margin: 0;
		padding: 1rem 1.125rem;
		border-top: 1px solid var(--line);
		color: #475467;
	}

	.identity-card { margin-bottom: 1rem; }

	.identity-table { border-top: 1px solid var(--line); }

	.identity-head,
	.identity-row {
		display: grid;
		grid-template-columns: minmax(14rem, 1.3fr) minmax(7rem, 0.6fr) minmax(11rem, 0.9fr) 5rem minmax(12rem, auto);
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1.125rem;
	}

	.identity-head {
		font-size: 0.75rem;
		font-weight: bold;
		color: #475467;
		background: #f8fafc;
	}

	.identity-row {
		min-height: 4.5rem;
		border-top: 1px solid var(--line);
		transition: background-color 180ms ease;
	}

	.identity-row:hover { background: #f8faff; }
	.identity-row.inactive-row { background: #fcfcfd; }

	.person-cell,
	.account-cell,
	.person-actions,
	.role-badge,
	.no-account {
		display: flex;
		align-items: center;
	}

	.person-cell,
	.account-cell { gap: 0.625rem; min-width: 0; }

	.person-cell p,
	.account-cell p {
		margin: 0.1875rem 0 0;
		font-size: 0.75rem;
		color: #667085;
		overflow-wrap: anywhere;
	}

	.avatar-color {
		display: grid;
		width: 2.25rem;
		height: 2.25rem;
		flex: 0 0 auto;
		place-items: center;
		border-radius: 0.5rem;
		font-weight: bold;
		color: var(--color-primary);
		background: #eff4ff;
	}

	.color-2 { color: #067647; background: #ecfdf3; }
	.color-3 { color: #b54708; background: #fff7ed; }
	.color-4 { color: #5925dc; background: #f4f3ff; }

	.role-badge {
		width: fit-content;
		gap: 0.25rem;
		padding: 0.25rem 0.5rem;
		border-radius: 999rem;
		font-size: 0.75rem;
		font-weight: bold;
		color: var(--color-primary);
		background: #eff4ff;
	}

	.role-badge.role-admin { color: #5925dc; background: #f4f3ff; }
	.role-badge.role-reviewer { color: #067647; background: #ecfdf3; }

	.no-account,
	.read-only-copy { gap: 0.3125rem; font-size: 0.75rem; color: #667085; }

	.person-actions { justify-content: flex-end; gap: 0.375rem; }
	.person-actions form { display: contents; }
	.person-actions button {
		min-width: 2.75rem;
		min-height: 2.75rem;
		padding-inline: 0.625rem;
		border: 1px solid #d0d5dd;
		border-radius: 0.4375rem;
		color: #475467;
		background: #fff;
		transition: border-color 180ms ease, background-color 180ms ease, color 180ms ease;
	}

	.person-actions button:hover:not(:disabled) { border-color: #84adff; color: var(--color-primary); background: #f8faff; }
	.person-actions .text-action { min-width: 3.75rem; font-size: 0.75rem; }
	.person-actions .danger-action { color: #b42318; }
	.person-actions .danger-action:hover:not(:disabled) { border-color: #fda29b; color: #b42318; background: #fef3f2; }

	.account-switch {
		grid-template-columns: 1.25rem minmax(0, 1fr) !important;
		align-items: center;
		padding: 0.625rem 0.75rem;
		border: 1px solid #dbe6fb;
		border-radius: 0.5rem;
		background: #f8faff;
	}

	.account-switch input[type='checkbox'] { width: 1.125rem; min-height: 1.125rem; }
	.permission-note {
		grid-column: 1 / -1;
		margin: 0;
		padding: 0.75rem;
		border: 1px solid #dbe6fb;
		border-radius: 0.5rem;
		font-size: 0.75rem;
		line-height: 1.5;
		color: #475467;
		background: #f8faff;
	}

	@media (max-width: 75rem) {
		.identity-head { display: none; }
		.identity-row {
			grid-template-columns: minmax(13rem, 1fr) minmax(7rem, auto) minmax(11rem, 1fr);
		}
		.identity-row > :nth-child(4) { grid-column: 2; }
		.person-actions { grid-column: 3; grid-row: 1 / span 2; }
	}

	@media (max-width: 51.25rem) {
		.role-grid { grid-template-columns: 1fr; }
		.identity-row {
			grid-template-columns: 1fr auto;
			align-items: start;
			padding-right: 4.75rem;
		}
		.person-cell { grid-column: 1 / -1; }
		.account-cell { grid-column: 1 / -1; }
		.identity-row > :nth-child(4) { grid-column: 2; grid-row: 2; }
		.person-actions { grid-column: 1 / -1; grid-row: auto; justify-content: flex-start; }
	}

	@media (prefers-reduced-motion: reduce) {
		.identity-row,
		.person-actions button,
		.permission-option,
		.permission-shortcuts button,
		.save-role-permissions { transition: none; }
	}
</style>
