<script lang="ts">
	import { enhance } from '$app/forms';
	import { AtSign, BarChart3, LoaderCircle, LockKeyhole } from '@lucide/svelte';

	let { data, form } = $props();
	let submitting = $state(false);
</script>

<svelte:head>
	<title>登录 · 融资工作台</title>
</svelte:head>

<main class="login-page">
	<section class="login-card" aria-labelledby="login-title">
		<div class="login-brand" aria-hidden="true">
			<BarChart3 size={26} strokeWidth={2.1} />
		</div>
		<p class="eyebrow">FINANCING OPS</p>
		<h1 id="login-title">登录融资工作台</h1>

		{#if form?.message}
			<div class="login-error" role="alert">{form.message}</div>
		{/if}

		<form
			method="POST"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					await update();
					submitting = false;
				};
			}}
		>
			<input type="hidden" name="redirectTo" value={data.redirectTo} />
			<label for="email">邮箱</label>
			<div class="field">
				<span class="field-icon"><AtSign size={18} aria-hidden="true" /></span>
				<input
					id="email"
					name="email"
					type="text"
					inputmode="email"
					value={form?.email ?? ''}
					autocomplete="username"
					required
				/>
			</div>

			<label for="password">密码</label>
			<div class="field">
				<span class="field-icon"><LockKeyhole size={18} aria-hidden="true" /></span>
				<input
					id="password"
					name="password"
					type="password"
					autocomplete="current-password"
					required
				/>
			</div>

			<button type="submit" disabled={submitting}>
				{#if submitting}<span class="spinner"><LoaderCircle size={18} aria-hidden="true" /></span>{/if}
				{submitting ? '正在登录…' : '登录'}
			</button>
		</form>
		<p class="security-note">账号、密码与会话由 Neon Auth 安全托管。</p>
	</section>
</main>

<style>
	.login-page {
		display: grid;
		min-height: 100dvh;
		place-items: center;
		padding: clamp(1rem, 4vw, 3rem);
		background:
			radial-gradient(circle at 15% 15%, rgb(47 111 237 / 18%), transparent 32%),
			linear-gradient(145deg, var(--navy), #111d33);
	}

	.login-card {
		width: min(100%, 28rem);
		padding: clamp(1.5rem, 4vw, 2.5rem);
		border: 1px solid rgb(255 255 255 / 14%);
		border-radius: 0.75rem;
		background: var(--surface);
		box-shadow: 0 1.5rem 4rem rgb(2 8 23 / 30%);
	}

	.login-brand {
		display: grid;
		width: 3rem;
		height: 3rem;
		margin-bottom: 1rem;
		place-items: center;
		border-radius: 0.625rem;
		color: white;
		background: var(--blue);
	}

	.eyebrow {
		margin: 0 0 0.375rem;
		color: var(--blue);
		font-size: 0.75rem;
		font-weight: bold;
		letter-spacing: 0.14em;
	}

	h1 {
		margin: 0;
		font-size: clamp(1.5rem, 4vw, 1.875rem);
		line-height: 1.3;
	}

	form {
		display: grid;
		gap: 0.625rem;
	}

	label {
		margin-top: 0.375rem;
		font-weight: bold;
	}

	.field {
		display: flex;
		min-height: 2.75rem;
		align-items: center;
		gap: 0.625rem;
		padding-inline: 0.75rem;
		border: 1px solid var(--line);
		border-radius: 0.5rem;
		background: #fff;
		transition: border-color 180ms ease, box-shadow 180ms ease;
	}

	.field:focus-within {
		border-color: var(--blue);
		box-shadow: 0 0 0 0.1875rem rgb(47 111 237 / 14%);
	}

	.field-icon {
		display: flex;
		flex: 0 0 auto;
		color: var(--muted);
	}

	input {
		width: 100%;
		min-width: 0;
		border: 0;
		outline: 0;
		color: var(--ink);
		background: transparent;
	}

	button {
		display: flex;
		min-height: 2.75rem;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		margin-top: 0.75rem;
		border: 0;
		border-radius: 0.5rem;
		color: white;
		font-weight: bold;
		background: var(--blue);
		transition: background 180ms ease, transform 180ms ease;
	}

	button:hover:not(:disabled) {
		background: #245dce;
	}

	button:active:not(:disabled) {
		transform: translateY(0.0625rem);
	}

	button:disabled {
		cursor: wait;
		opacity: 0.72;
	}

	.login-error {
		margin-bottom: 1rem;
		padding: 0.75rem;
		border: 1px solid rgb(217 45 32 / 24%);
		border-radius: 0.5rem;
		color: var(--red);
		background: rgb(217 45 32 / 7%);
	}

	.security-note {
		margin: 1rem 0 0;
		color: var(--muted);
		font-size: 0.75rem;
		text-align: center;
	}

	.spinner {
		display: flex;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	@media (prefers-reduced-motion: reduce) {
		.spinner { animation: none; }
		.field, button { transition: none; }
	}
</style>
