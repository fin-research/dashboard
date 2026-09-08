<script lang="ts">
import { formatFinancingTimestamp } from '$lib/financing/time.js';
	import {
		ArrowLeft,
		CheckCircle2,
		Clock3,
		LoaderCircle,
		Mail,
		Search,
		TriangleAlert
	} from '@lucide/svelte';
	import { globalMessages } from '$lib/global-messages';
	import { withBase } from '$lib/financing/app-paths';
	import { untrack } from 'svelte';

	let { data } = $props();
	const initialHistory = untrack(() => data.history);
	const initialFilters = untrack(() => data.filters);
	let loadedFilterKey = `${initialFilters.status}\0${initialFilters.query}`;
	let historyRows = $state<any[]>([...initialHistory.rows]);
	let nextCursor = $state<string | null>(initialHistory.nextCursor);
	let hasMore = $state(Boolean(initialHistory.hasMore));
	let loadingMore = $state(false);

	$effect(() => {
		const key = `${data.filters.status}\0${data.filters.query}`;
		if (key === loadedFilterKey) return;
		loadedFilterKey = key;
		historyRows = [...data.history.rows];
		nextCursor = data.history.nextCursor;
		hasMore = Boolean(data.history.hasMore);
	});

	async function loadMore() {
		if (!hasMore || !nextCursor || loadingMore) return;
		loadingMore = true;
		const search = new URLSearchParams({
			status: data.filters.status,
			query: data.filters.query,
			cursor: nextCursor
		});
		try {
			const response = await fetch(`${withBase('/sop/reminders/more')}?${search}`);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const page = await response.json();
			const knownIds = new Set(historyRows.map((row) => row.id));
			historyRows = [...historyRows, ...page.rows.filter((row: any) => !knownIds.has(row.id))];
			nextCursor = page.nextCursor;
			hasMore = Boolean(page.hasMore);
		} catch {
			globalMessages.error('加载更多记录失败，请稍后重试', { key: 'reminder-history-load' });
		} finally {
			loadingMore = false;
		}
	}

	const statusLabel: Record<string, string> = {
		sent: '已发送',
		pending: '待发送',
		failed: '失败'
	};

	function scheduledTimeLabel(value: string | null) {
		if (!value) return '—';
		return formatFinancingTimestamp(value);
	}
</script>

<svelte:head>
	<title>提醒发送历史 · 融资工作台</title>
</svelte:head>

<nav class="back-nav" aria-label="返回 SOP 管理">
	<a class="btn btn-ghost back-link" href={withBase('/sop')}><ArrowLeft size={16} /> 返回 SOP 管理</a>
</nav>

<section class="summary-grid" aria-label="提醒发送汇总">
	<article>
		<span class="summary-icon all"><Mail size={19} /></span>
		<div><strong>{data.history.summary.total}</strong><span>全部记录</span></div>
	</article>
	<article>
		<span class="summary-icon sent"><CheckCircle2 size={19} /></span>
		<div><strong>{data.history.summary.sent}</strong><span>已发送</span></div>
	</article>
	<article>
		<span class="summary-icon pending"><Clock3 size={19} /></span>
		<div><strong>{data.history.summary.pending}</strong><span>待发送</span></div>
	</article>
	<article>
		<span class="summary-icon failed"><TriangleAlert size={19} /></span>
		<div><strong>{data.history.summary.failed}</strong><span>发送失败</span></div>
	</article>
</section>

<form class="filter-bar" method="get" aria-label="提醒历史筛选">
	<label>
		<span>状态</span>
		<select class="select" name="status" value={data.filters.status}>
			<option value="">全部状态</option>
			<option value="sent">已发送</option>
			<option value="pending">待发送</option>
			<option value="failed">失败</option>
		</select>
	</label>
	<div class="query-field">
		<span>关键词</span>
		<label class="input query-input">
			<Search size={16} />
			<input aria-label="提醒关键词"
				name="query"
				value={data.filters.query}
				placeholder="规则、目标、邮箱或失败原因"
			/>
		</label>
	</div>
	<button class="btn btn-primary" type="submit">查询</button>
	<a class="btn btn-ghost" href={withBase('/sop/reminders')}>清除</a>
</form>

<section class="history-panel">
	<div class="table-head">
		<span>日期 / 状态</span>
		<span>提醒规则与目标</span>
		<span>收件人</span>
		<span>结果</span>
	</div>
	{#if historyRows.length}
		<div class="history-list">
			{#each historyRows as row (row.id)}
				<article class="history-row">
					<div>
						<span class={`badge status-pill ${row.status}`}>{statusLabel[row.status] ?? row.status}</span>
						<strong>{row.deliveryDate}</strong>
						<small>{row.periodLabel} · 计划 {scheduledTimeLabel(row.scheduledFor)}</small>
						<small>记录 {row.sentAt ?? row.createdAt}</small>
					</div>
					<div>
						<strong>{row.ruleName}</strong>
						<span>{row.targetType} · {row.targetId}</span>
					</div>
					<div class="recipient-list">
						{#each row.recipients as recipient}
							<span>{recipient}</span>
						{/each}
					</div>
					<div class:error-copy={row.status === 'failed'}>
						{#if row.status === 'failed'}
							<strong>{row.errorMessage ?? '未记录失败原因'}</strong>
							<span>请修正配置后重新执行提醒任务</span>
						{:else if row.status === 'sent'}
							<strong>Resend 已接受</strong>
							<span>{row.providerMessageId ?? '未返回消息编号'}</span>
						{:else}
							<strong>等待发送</strong>
							<span>配置密钥后执行发送任务</span>
						{/if}
					</div>
				</article>
			{/each}
		</div>
		{#if hasMore}
			<div class="load-more-row">
				<button class="btn" type="button" onclick={loadMore} disabled={loadingMore}>
					{#if loadingMore}<LoaderCircle class="spin" size={16} />{/if}
					{loadingMore ? '加载中…' : '加载更多'}
				</button>
			</div>
		{/if}
	{:else}
		<div class="empty-state">
			<Mail size={24} />
			<strong>没有匹配的提醒记录</strong>
			<p>调整筛选条件，或先运行一次提醒任务。</p>
		</div>
	{/if}
</section>

<style>
	.back-nav {
		margin-bottom: 1.25rem;
	}

	.back-link {
		display: inline-flex;
		min-height: 2.75rem;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.75rem;
		font-weight: bold;
		color: #475467;
	}

	.summary-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}

	.summary-grid article {
		display: flex;
		min-height: 5rem;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem;
		border: 1px solid var(--border-color);
		border-radius: 0.75rem;
		background: #fff;
	}

	.summary-icon {
		display: grid;
		width: 2.5rem;
		height: 2.5rem;
		place-items: center;
		border-radius: 0.625rem;
		color: var(--color-primary);
		background: #eff4ff;
	}

	.summary-icon.sent {
		color: #067647;
		background: #ecfdf3;
	}

	.summary-icon.pending {
		color: #b54708;
		background: #fffaeb;
	}

	.summary-icon.failed {
		color: #b42318;
		background: #fef3f2;
	}

	.summary-grid strong,
	.summary-grid span {
		display: block;
	}

	.summary-grid strong {
		font-size: 1.375rem;
		color: #101828;
	}

	.summary-grid div > span {
		margin-top: 0.125rem;
		font-size: 0.75rem;
		color: #667085;
	}

	.filter-bar {
		display: flex;
		align-items: end;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
		padding: 0.875rem 1rem;
		border: 1px solid var(--border-color);
		border-radius: 0.75rem;
		background: #fff;
	}

	.filter-bar label, .query-field {
		display: grid;
		gap: 0.375rem;
	}

	.filter-bar label > span, .query-field > span {
		font-size: 0.75rem;
		font-weight: bold;
		color: #475467;
	}

	.filter-bar select,
	.query-input,
	.filter-bar button,
	.filter-bar > a {
		min-height: 2.75rem;
		border: 1px solid #d0d5dd;
		border-radius: 0.5rem;
		font-size: 1rem;
		background: #fff;
	}

	.filter-bar select {
		min-width: 9rem;
		padding-inline: 0.75rem;
	}

	.query-field {
		flex: 1;
	}

	.filter-bar .query-input {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding-inline: 0.75rem;
		color: #667085;
	}

	.query-field input {
		width: 100%;
	}

	.filter-bar button,
	.filter-bar > a {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding-inline: 1rem;
		font-weight: bold;
	}

	.history-panel {
		overflow: hidden;
		border: 1px solid var(--border-color);
		border-radius: 0.75rem;
		background: #fff;
	}

	.table-head,
	.history-row {
		display: grid;
		grid-template-columns: minmax(9rem, 0.8fr) minmax(12rem, 1.2fr) minmax(12rem, 1fr) minmax(14rem, 1.4fr);
		gap: 1rem;
	}

	.table-head {
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--border-color);
		font-size: 0.75rem;
		font-weight: bold;
		color: #667085;
		background: #f9fafb;
	}

	.history-row {
		align-items: start;
		padding: 1rem;
		border-bottom: 1px solid #eaecf0;
	}

	.history-row:last-child {
		border-bottom: 0;
	}

	.load-more-row {
		display: flex;
		justify-content: center;
		padding: 1rem;
		border-top: 1px solid #eaecf0;
	}

	.load-more-row button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding-inline: 1.25rem;
	}

	.history-row > div {
		display: grid;
		gap: 0.25rem;
		min-width: 0;
	}

	.history-row strong {
		overflow-wrap: anywhere;
		font-size: 1rem;
		color: #344054;
	}

	.history-row span,
	.history-row small {
		overflow-wrap: anywhere;
		font-size: 0.75rem;
		color: #667085;
	}

	.status-pill {
		justify-self: start;
		padding: 0.25rem 0.5rem;
		border-radius: 999rem;
		font-weight: bold;
	}

	.status-pill.sent {
		color: #067647;
		background: #ecfdf3;
	}

	.status-pill.pending {
		color: #b54708;
		background: #fffaeb;
	}

	.status-pill.failed,
	.error-copy strong {
		color: #b42318;
		background: #fef3f2;
	}

	.recipient-list span {
		padding: 0.25rem 0.5rem;
		border-radius: 0.375rem;
		background: #f2f4f7;
	}

	.empty-state {
		display: grid;
		min-height: 16rem;
		place-items: center;
		align-content: center;
		gap: 0.5rem;
		padding: 2rem;
		text-align: center;
		color: #667085;
	}

	.empty-state strong {
		font-size: 1rem;
		color: #344054;
	}

	.empty-state p {
		margin: 0;
		font-size: 0.75rem;
	}

	@media (max-width: 64rem) {
		.summary-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.history-panel {
			overflow-x: auto;
		}

		.table-head,
		.history-row {
			min-width: 62rem;
		}
	}

	@media (max-width: 51.25rem) {
		.filter-bar {
			align-items: stretch;
			flex-direction: column;
		}

		.filter-bar select {
			width: 100%;
		}
	}

	@media (max-width: 35rem) {
		.summary-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
