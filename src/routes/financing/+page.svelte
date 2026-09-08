<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { withBase } from '$lib/financing/app-paths';
	import {
		CalendarClock, ChevronLeft, ChevronRight, CircleAlert, CircleDollarSign, Clock3,
		Info, Landmark, Percent
	} from '@lucide/svelte';
	import DebtPresetFilter from '$lib/financing/DebtPresetFilter.svelte';
	import './dashboard.css';
import MetricCard from '../../components/MetricCard.svelte';
import ModuleCard from '../../components/ModuleCard.svelte';
import PanelHeading from '$lib/trading-research/PanelHeading.svelte';
import ChartHost from '../../components/ChartHost.svelte';
import { financingCompositionOption, financingMaturityOption } from '../../charts/financing-dashboard';


	let { data } = $props();
	const initialSelectedTypes = () => data.selectedTypes;
	const initialPreset = () => data.preset;
	let selectedTypes = $state<string[]>([...initialSelectedTypes()]);
	let preset = $state(initialPreset());
	let lastQuery = $state(page.url.search);
	const dashboard = $derived(data.dashboard);
	const reminders = $derived(page.data.reminders);
	const colors = ['#2f6fed', '#16a394', '#6941c6', '#f79009', '#d92d20', '#0ba5ec', '#6172f3', '#12b76a'];
	const presets = [
		{ key: 'all', label: '全量', exclude: [] },
		{ key: 'no_interbank', label: '不含拆借', exclude: ['同业拆借'] },
		{ key: 'no_interbank_swap', label: '不含拆借、互换便利', exclude: ['同业拆借', '互换便利'] },
		{ key: 'core_financing', label: '不含拆借、互换便利、浮动收益凭证', exclude: ['同业拆借', '互换便利', '浮动收益凭证'] }
	];

	$effect(() => {
		const params = new URLSearchParams();
		params.set('preset', preset);
		if (preset === 'custom') for (const type of selectedTypes) params.append('type', type);
		const query = `?${params.toString()}`;
		if (query !== lastQuery) {
			lastQuery = query;
			goto(query, { keepFocus: true, noScroll: true, replaceState: true });
		}
	});

	const ratioText = (value: number | null) => value == null ? '待配置' : `${value.toFixed(2)}%`;
	const ratioTone = (value: number | null, threshold: number) => value == null
		? 'muted'
		: value > threshold
			? 'danger'
			: value > threshold * 0.8
				? 'warning'
				: 'good';
	const toneLabel = (tone: string) => ({
		good: '指标正常',
		warning: '超过监管上限的 80%',
		danger: '超过监管上限',
		muted: '监管参数待配置'
	}[tone] ?? '');
	const comparison = (label: string, value: number, unit: string, digits: number) => ({
		label,
		text: `${value > 0 ? '+' : ''}${value.toFixed(digits)}${unit}`,
		direction: value > 0 ? 'increase' : value < 0 ? 'decrease' : 'flat'
	});
	const dateLabel = (date: string | null) => date ? date.replaceAll('-', '/') : '';
	type FinancingMetric = {
		label: string;
		value: string;
		icon: typeof CircleDollarSign;
		accent: string;
		tone: string;
		details: { label: string; value: string }[];
		comparisons: { label: string; text: string; direction: string }[];
	};
	const metricCards = $derived<FinancingMetric[]>([
		{
			label: '存续负债余额', value: `${dashboard.metrics.balanceYi.toFixed(2)}亿元`, icon: CircleDollarSign,
			accent: 'blue', tone: 'normal', details: [],
			comparisons: [
				comparison('较上月末', dashboard.metrics.balanceMonthChangeYi, '亿', 2),
				comparison('较上年末', dashboard.metrics.balanceYearChangeYi, '亿', 2)
			]
		},
		{
			label: '加权融资利率', value: `${dashboard.metrics.weightedRatePct.toFixed(2)}%`, icon: Percent,
			accent: 'teal', tone: 'normal', details: [],
			comparisons: [
				comparison('较上月末', dashboard.metrics.weightedRateMonthBp, 'bp', 0),
				comparison('较上年末', dashboard.metrics.weightedRateYearBp, 'bp', 0)
			]
		},
		{
			label: '加权剩余期限', value: `${Math.round(dashboard.metrics.weightedRemainingDays)}天`, icon: Clock3,
			accent: 'violet', tone: 'normal', details: [],
			comparisons: [
				comparison('较上月末', dashboard.metrics.remainingMonthChangeDays, '天', 0),
				comparison('较上年末', dashboard.metrics.remainingYearChangeDays, '天', 0)
			]
		},
		{ label: '未来30天到期', value: `${dashboard.metrics.due30Yi.toFixed(2)}亿元`, icon: CalendarClock, accent: 'orange', tone: 'normal', details: [], comparisons: [] },
		{ label: '推进中的融资项目', value: `${dashboard.metrics.projectAmountYi.toFixed(2)}亿元`, icon: Landmark, accent: 'purple', tone: 'normal', details: [], comparisons: [] }
	]);
	const regulatoryItems = $derived([
		{
			label: '1年以内短期负债占净资本', value: ratioText(dashboard.metrics.shortDebtRatio),
			tone: ratioTone(dashboard.metrics.shortDebtRatio, 100),
			limit: '100%', detailLabel: '短期负债', detailValue: `${dashboard.metrics.shortDebtYi.toFixed(2)}亿元`
		},
		{
			label: '新增单笔借款较证券上年末净资产', value: ratioText(dashboard.metrics.largestBorrowingRatio),
			tone: ratioTone(dashboard.metrics.largestBorrowingRatio, 20),
			limit: '20%', detailLabel: '最大单笔', detailValue: `${dashboard.metrics.largestBorrowingYi.toFixed(2)}亿元`
		},
		{
			label: '累计新增借款较证券上年末净资产', value: ratioText(dashboard.metrics.cumulativeSecuritiesRatio),
			tone: ratioTone(dashboard.metrics.cumulativeSecuritiesRatio, 50),
			limit: '50%', detailLabel: '净新增', detailValue: `${dashboard.metrics.cumulativeBorrowingYi > 0 ? '+' : ''}${dashboard.metrics.cumulativeBorrowingYi.toFixed(2)}亿元`
		},
		{
			label: '累计新增借款较集团上年末净资产', value: ratioText(dashboard.metrics.cumulativeGroupRatio),
			tone: ratioTone(dashboard.metrics.cumulativeGroupRatio, 10),
			limit: '10%', detailLabel: '净新增', detailValue: `${dashboard.metrics.cumulativeBorrowingYi > 0 ? '+' : ''}${dashboard.metrics.cumulativeBorrowingYi.toFixed(2)}亿元`
		}
	]);
	const projectTableAmountYi = $derived(dashboard.projects.reduce((sum: number, item: any) => sum + item.amountYi, 0));
	const compositionTotal = $derived(dashboard.composition.reduce((sum: number, item: any) => sum + item.amountYi, 0));
	const maxMaturity = $derived(Math.max(1, ...dashboard.maturityDistribution.map((item: any) => item.amountYi)));
	const maturityStep = $derived.by(() => {
		const roughStep = maxMaturity / 4;
		const magnitude = 10 ** Math.floor(Math.log10(Math.max(roughStep, 1)));
		const normalized = roughStep / magnitude;
		return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
	});
	const maturityScaleMax = $derived(maturityStep * 4);
	const maturityTicks = $derived(Array.from({ length: 5 }, (_, index) => maturityScaleMax - index * maturityStep));

	const calendarPresets = [
		{ key: 'default', label: '不含拆借、浮动收益凭证', exclude: ['同业拆借', '浮动收益凭证'] },
		{ key: 'all', label: '全部', exclude: [] }
	];
	let calendarPreset = $state('default');
	const initialCalendarTypes = () => data.dashboard.typeOptions.filter((type: string) => !['同业拆借', '浮动收益凭证'].includes(type));
	let calendarTypes = $state<string[]>(initialCalendarTypes());
	let calendarExpanded = $state(false);
	const visibleEvents = $derived(dashboard.events.filter((event: any) => calendarTypes.length === 0 || calendarTypes.includes(event.filterType)));
	const cellsPerWeek = $derived(calendarExpanded ? 7 : 5);
	const calendarStart = $derived.by(() => {
		const firstDate = new Date(`${dashboard.calendarMonth}-01T00:00:00Z`);
		const startOffset = firstDate.getUTCDay();
		firstDate.setUTCDate(firstDate.getUTCDate() - startOffset);
		if (!calendarExpanded) firstDate.setUTCDate(firstDate.getUTCDate() + 1);
		return firstDate;
	});
	const calendarCells = $derived(Array.from({ length: 6 * cellsPerWeek }, (_, index) => {
		const date = new Date(calendarStart); date.setUTCDate(date.getUTCDate() + index);
		const key = date.toISOString().slice(0, 10);
		return { date: key, day: date.getUTCDate(), other: key.slice(0, 7) !== dashboard.calendarMonth, today: key === dashboard.today, events: visibleEvents.filter((event: any) => event.date === key) };
	}));
	const calendarWeekdays = $derived(calendarExpanded ? ['日', '一', '二', '三', '四', '五', '六'] : ['一', '二', '三', '四', '五']);
	const calendarSummaryDefinitions = [
		{ label: '公司债券', types: ['小公募', '私募债', '科创债'] },
		{ label: '次级债', types: ['次级债'] }, { label: '短融', types: ['短期融资券'] },
		{ label: '固定收益凭证', types: ['固定收益凭证'] }, { label: '转融资', types: ['转融资'] },
		{ label: '集团借款', types: ['集团借款'] }
	];
	const calendarSubtitle = $derived(calendarSummaryDefinitions.map((group) => {
		const amount = visibleEvents.filter((event: any) => event.id.startsWith('maturity:') && group.types.includes(event.filterType)).reduce((sum: number, event: any) => sum + event.amountYi, 0);
		return `${amount.toFixed(2)}亿元${group.label}`;
	}).join('、'));

	let simulationType = $state('小公募');
	const initialToday = () => data.dashboard.today;
	let simulationDate = $state(initialToday());
	let simulationAmount = $state<number | null>(null);
	let simulationTenor = $state('3Y');
	const simulationLimit = $derived(dashboard.limits.find((item: any) => item.debtType === simulationType));
	const simulationResult = $derived.by(() => {
		if (!simulationAmount || simulationAmount <= 0) return null;
		if (!simulationLimit) return { pass: false, message: '该品种尚未配置发行额度' };
		const remaining = simulationLimit.remainingYi - simulationAmount;
		return remaining >= 0
			? { pass: true, message: `额度校验通过，试算后剩余 ${remaining.toFixed(2)} 亿元` }
			: { pass: false, message: `超出可用额度 ${Math.abs(remaining).toFixed(2)} 亿元` };
	});
</script>

<svelte:head><title>仪表盘 · 融资工作台</title></svelte:head>

<DebtPresetFilter options={dashboard.typeOptions} {presets} bind:preset bind:values={selectedTypes} note={`数据截至 ${dashboard.asOfDate}`} />

<section class="financing-metric-grid" aria-label="融资指标">
	{#each metricCards as metric}
    <MetricCard label={metric.label} value={metric.value} iconComponent={metric.icon}
      tone={metric.accent === 'violet' ? 'purple' : metric.accent as 'blue' | 'teal' | 'orange' | 'purple'}>
      {#snippet details()}
        {#each metric.comparisons as item}
          <span class="financing-comparison">{item.label}<b class:positive={item.direction === 'increase'} class:negative={item.direction === 'decrease'}>{item.text}</b></span>
        {/each}
      {/snippet}
    </MetricCard>
	{/each}

	<div class="regulatory-region" aria-label="监管监控指标">
		<div class="regulatory-grid">
			{#each regulatoryItems as item}
				<div class="regulatory-cell">
					<div class="regulatory-title">
						<span>{item.label}</span>
						<span class={`financing-status-light ${item.tone}`} role="img" aria-label={toneLabel(item.tone)} title={toneLabel(item.tone)}></span>
					</div>
					<strong class:financing-muted-value={item.value === '待配置'}>{item.value}</strong>
					<div class="regulatory-details">
						<span>上限 <b class={item.tone}>{item.limit}</b></span>
						<span>{item.detailLabel} <b class={item.tone}>{item.detailValue}</b></span>
					</div>
				</div>
			{/each}
		</div>
	</div>
</section>

<section class="overview-row">
	<ModuleCard class="financing-panel structure-panel">
		<PanelHeading id="financing-panel-1" title="存量负债结构" controlsInline><span>{compositionTotal.toFixed(2)}亿元</span></PanelHeading>
    <ChartHost option={financingCompositionOption(dashboard.composition)} ariaLabel={`存量负债结构，合计 ${compositionTotal.toFixed(2)}亿元`} height={19} />
	</ModuleCard>

	<ModuleCard class="financing-panel maturity-panel">
		<PanelHeading id="financing-panel-2" title="到期分布" controlsInline><span>未来 6 个月 · 亿元</span></PanelHeading>
    <ChartHost option={financingMaturityOption(dashboard.maturityDistribution)} ariaLabel="未来六个月到期本金分布，单位亿元" height={19} />
	</ModuleCard>
</section>

<section class="dashboard-grid">
	<ModuleCard class="financing-panel project-panel">
		<PanelHeading id="financing-panel-3" title="推进中的融资项目" controlsInline></PanelHeading>
		<table class="table"><thead><tr><th>融资方式</th><th>融资金额</th><th>期限</th><th>融资成本</th><th>落地时间</th></tr></thead><tbody>
			{#each dashboard.projects as project}<tr><td><a href={withBase(`/projects/${project.id}`)}>{project.debtType}</a><small>{project.name}</small></td><td>{project.amountYi.toFixed(2)}</td><td>{project.tenor}</td><td>{project.cost}</td><td>{project.landingDate ? `${project.landingDate.replaceAll('-', '/')}簿记` : '待定'}</td></tr>{/each}
		</tbody><tfoot><tr><th>合计</th><th>{projectTableAmountYi.toFixed(2)}</th><th colspan="3"></th></tr></tfoot></table>
	</ModuleCard>

	<ModuleCard class="financing-panel issuance-panel">
		<PanelHeading id="financing-panel-4" title="月度发行统计" controlsInline></PanelHeading>
		<table class="table"><thead><tr><th>品种</th><th>{dashboard.monthlyIssuance.currentMonth.replace('-', '年')}月</th><th>{dashboard.monthlyIssuance.comparisonMonth.replace('-', '年')}月</th></tr></thead><tbody>
			{#each dashboard.monthlyIssuance.rows as row}<tr><td>{row.label}</td><td>{row.currentYi.toFixed(2)}</td><td>{row.comparisonYi.toFixed(2)}</td></tr>{/each}
		</tbody></table>
	</ModuleCard>

	<ModuleCard class="financing-panel limit-card">
		<PanelHeading id="financing-panel-5" title="负债额度管理" controlsInline></PanelHeading>
		<table class="table"><thead><tr><th>融资品种</th><th>可发行额度</th><th>已发行额度</th><th>剩余可用额度</th><th>获批日期</th><th>到期日期</th></tr></thead><tbody>
			{#each dashboard.limits as item}<tr><td><strong>{item.debtType}</strong></td><td>{item.limitYi.toFixed(2)}</td><td>{item.issuedYi.toFixed(2)}</td><td class:negative={item.remainingYi < 0}><strong>{item.remainingYi.toFixed(2)}</strong><span class="quota-utilization">已用 {item.limitYi > 0 ? (item.issuedYi / item.limitYi * 100).toFixed(0) : 0}%</span></td><td>{dateLabel(item.approvedDate)}</td><td>{dateLabel(item.expiryDate)}</td></tr>{/each}
		</tbody><tfoot><tr><th>合计</th><th>{dashboard.limitTotals.limitYi.toFixed(2)}</th><th>{dashboard.limitTotals.issuedYi.toFixed(2)}</th><th>{dashboard.limitTotals.remainingYi.toFixed(2)}</th><th></th><th></th></tr></tfoot></table>
		{#if dashboard.financeParameterReminder}
			<div class="parameter-reminder" role="status"><CircleAlert size={18} /><span>请在本月初更新“上月末净资本”，收益凭证可发行额度按其 60% 计算。</span><a href={withBase('/data')}>去配置</a></div>
		{/if}
	</ModuleCard>

	<ModuleCard class="financing-panel simulator-card">
		<PanelHeading id="financing-panel-6" title="发行试算" controlsInline></PanelHeading>
		<div class="simulator-form">
			<label><span>拟发行品种</span><select class="select" bind:value={simulationType}>{#each dashboard.limits as item}<option>{item.debtType}</option>{/each}</select></label>
			<label><span>起息日</span><input class="input" type="date" bind:value={simulationDate} /></label>
			<label><span>规模（亿元）</span><input class="input" type="number" min="0.01" step="0.01" bind:value={simulationAmount} placeholder="0.00" /></label>
			<label><span>期限</span><input class="input" bind:value={simulationTenor} placeholder="例如 3Y/5Y" /></label>
		</div>
		<div class="simulation-results">
			<div class:pass={simulationResult?.pass} class:fail={simulationResult && !simulationResult.pass}><Landmark size={18} /><span><strong>负债额度</strong>{simulationResult?.message ?? '输入发行规模后自动校验'}</span></div>
			<div class="todo"><Info size={18} /><span><strong>到期当月集中度</strong>TODO：纳入拟发行后的月度到期分布</span></div>
			<div class="todo"><Info size={18} /><span><strong>LCR / NSFR / 资产负债率 / 长短期负债比</strong>TODO：接入财务数据后试算</span></div>
		</div>
	</ModuleCard>

	<ModuleCard class="financing-panel calendar-card">
		<header>
			<h2>融资日历</h2>
			<div class="calendar-filter"><DebtPresetFilter options={dashboard.typeOptions} presets={calendarPresets} bind:preset={calendarPreset} bind:values={calendarTypes} note={`台账截至 ${dashboard.asOfDate}`} compact /></div>
		</header>
		<div class="calendar-wrap" class:expanded={calendarExpanded}>
			<div class="calendar-grid" style={`--cols: ${cellsPerWeek}`}>
				{#each calendarWeekdays as weekday}<div class="weekday">{weekday}</div>{/each}
				{#each calendarCells as cell}
					<div class:other={cell.other} class:today={cell.today} class="calendar-cell">
						<span class="day-number">{cell.day}</span>
						<div class="calendar-events">
							{#each cell.events as event}<a class={event.tone} href={withBase(event.href)} title={event.title}>{event.title}</a>{/each}
						</div>
					</div>
				{/each}
			</div>
			<button
				class="btn btn-ghost calendar-expand"
				type="button"
				aria-expanded={calendarExpanded}
				aria-label={calendarExpanded ? '收起周末，仅显示工作日' : '展开周末，显示完整日历'}
				title={calendarExpanded ? '收起周末' : '展开周末'}
				onclick={() => (calendarExpanded = !calendarExpanded)}
			>
				{#if calendarExpanded}<ChevronLeft size={16} />{:else}<ChevronRight size={16} />{/if}
			</button>
		</div>
	</ModuleCard>

	<ModuleCard class="financing-panel reminder-card">
		<PanelHeading id="financing-panel-7" title="待办与提醒" controlsInline><span>{reminders.total} 条</span></PanelHeading>
		<div class="reminder-list">
			{#each reminders.items as reminder}
				<a href={withBase(reminder.href)} class="reminder-item">
					<span class={`reminder-dot ${reminder.level}`} aria-hidden="true"></span>
					<div class="reminder-copy">
						<strong>{reminder.projectName}</strong>
						<span>{reminder.taskName}</span>
						<small>{reminder.debtType} · {reminder.assigneeName ? `负责人：${reminder.assigneeName}` : '待分配'}</small>
					</div>
					<span class={`reminder-due ${reminder.level}`}>{reminder.dueLabel}</span>
				</a>
			{:else}
				<p class="reminder-empty">当前没有需要处理的项目节点</p>
			{/each}
		</div>
	</ModuleCard>
</section>
