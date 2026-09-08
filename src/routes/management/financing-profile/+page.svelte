<script lang="ts">
import PanelHeading from '$lib/trading-research/PanelHeading.svelte';
import ModuleCard from '../../../components/ModuleCard.svelte';
	import './profile.css';
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { untrack } from 'svelte';
	import { Camera, KeyRound, LoaderCircle, Save, ShieldCheck, UserRound } from '@lucide/svelte';
	import { globalMessages } from '$lib/global-messages';
	import { MIN_PASSWORD_LENGTH } from '$lib/financing/password-policy';
	import { withBase } from '$lib/financing/app-paths';

	let { data, form } = $props();
	let displayedProfile = $state(untrack(() => ({
		hasAvatar: Boolean(data.user?.hasAvatar),
		avatarVersion: data.user?.avatarVersion ?? '0',
		name: data.user?.personName ?? '',
		email: data.user?.email ?? null,
		role: data.user?.role ?? 'reviewer'
	})));
	let avatarPreview = $state<string | null>(null);
	let avatarTouched = $state(false);
	const avatarUrl = (profile: any) => profile.hasAvatar
		? `${withBase('/avatar')}?v=${encodeURIComponent(`${data.user?.personId ?? ''}:${profile.avatarVersion}`)}`
		: null;
	const displayedAvatar = $derived(avatarTouched ? avatarPreview : avatarUrl(displayedProfile));
	let pendingSection = $state<'profile' | 'password' | null>(null);
	let handledForm = $state<unknown>(null);
	let suppressFormFeedback = $state(false);
	$effect(() => {
		if (!form?.message || suppressFormFeedback || handledForm === form) return;
		handledForm = form;
		const message = String(form.message);
		if (form.success) globalMessages.success(message, { key: 'settings-action' });
		else globalMessages.error(message, { key: 'settings-action' });
	});

	const enhanceSection = (section: 'profile' | 'password'): SubmitFunction => () => {
		pendingSection = section;
		suppressFormFeedback = true;
		return async ({ result, update }) => {
			const returnedProfile = result.type === 'success' ? result.data?.profile : null;
			if (returnedProfile) {
				displayedProfile = { ...returnedProfile };
				avatarTouched = false;
				avatarPreview = null;
			}
			await update({
				reset: result.type === 'success' && section === 'password',
				invalidateAll: false
			});
			if (result.type === 'success' && result.data?.refreshIdentity) {
				await invalidate('financing:identity');
			}
			if (returnedProfile) displayedProfile = { ...returnedProfile };
			pendingSection = null;
			if (result.type === 'success' || result.type === 'failure') {
				const message = String(result.data?.message ?? (result.type === 'success' ? '保存成功' : '保存失败'));
				if (result.type === 'success' && Boolean(result.data?.success)) {
					globalMessages.success(message, { key: 'settings-action' });
				} else {
					globalMessages.error(message, { key: 'settings-action' });
				}
			} else {
				globalMessages.error('请求失败，请稍后重试', { key: 'settings-action' });
			}
		};
	};

	const previewAvatar = (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		avatarTouched = true;
		const reader = new FileReader();
		reader.onload = () => (avatarPreview = String(reader.result));
		reader.readAsDataURL(file);
	};
</script>

<svelte:head>
	<title>个人设置 · 融资工作台</title>
</svelte:head>

<div class="profile-page">
	<section class="profile-summary" aria-label="当前账号信息">
		{#if displayedAvatar}
			<img src={displayedAvatar} alt={`${displayedProfile.name}的头像`} />
		{:else}
			<span class="profile-initial">{displayedProfile.name.slice(0, 1).toUpperCase()}</span>
		{/if}
		<div>
			<strong>{displayedProfile.name}</strong>
			<span>{displayedProfile.email ?? '待设置登录邮箱'}</span>
		</div>
		<span class="security-state"><ShieldCheck size={16} /> 账号已启用</span>
	</section>

	<div class="settings-grid">
		<ModuleCard class="settings-card">
			<PanelHeading id="financing-person-profile" title="融资人员资料" />
			<form method="post" action="?/updateProfile" enctype="multipart/form-data" use:enhance={enhanceSection('profile')}>
				<div class="avatar-editor">
					{#if displayedAvatar}
						<img src={displayedAvatar} alt="头像预览" />
					{:else}
						<span>{displayedProfile.name.slice(0, 1).toUpperCase()}</span>
					{/if}
					<div>
						<label class="upload-button">
							<Camera size={16} /> 选择头像
							<input name="avatar" type="file" accept="image/jpeg,image/png,image/webp" aria-label="选择头像文件" onchange={previewAvatar} />
						</label>
						<small>支持 JPG、PNG、WebP，文件不超过 512KB</small>
						<label class="remove-avatar"><input type="checkbox" name="removeAvatar" value="1" /> 保存时移除当前头像</label>
					</div>
				</div>

				<div class="form-grid">
					<label>
						<span>显示姓名</span>
						<input name="name" required maxlength="50" value={displayedProfile.name} autocomplete="name" />
					</label>
					<label>
						<span>登录邮箱</span>
						<input type="email" readonly value={displayedProfile.email ?? ''} autocomplete="email" />
						<small>登录邮箱由管理员在“人员与权限”中维护</small>
					</label>
				</div>

				<div class="form-actions">
					<button class="primary-action" type="submit" disabled={pendingSection !== null}>
						{#if pendingSection === 'profile'}<LoaderCircle class="spin" size={16} />{:else}<Save size={16} />{/if}
						{pendingSection === 'profile' ? '保存中…' : '保存个人资料'}
					</button>
				</div>
			</form>
		</ModuleCard>

		<ModuleCard class="settings-card"><PanelHeading id="financing-person-account" title="登录账号" /><a href="/profile">前往个人信息维护登录邮箱、密码和显示偏好</a></ModuleCard>
	</div>
</div>
