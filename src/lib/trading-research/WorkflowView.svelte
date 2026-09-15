<script lang="ts">
  import { onMount } from 'svelte';
  import ModuleCard from "../../components/ModuleCard.svelte";
  import PanelHeading from "./PanelHeading.svelte";
  import SectionHeading from "./SectionHeading.svelte";
  import Badge from "./Badge.svelte";
  import WorkflowLane from '../trading-workflow/WorkflowLane.svelte';
  import WorkflowTree from '../trading-workflow/WorkflowTree.svelte';
  import WorkflowEditor from '../trading-workflow/WorkflowEditor.svelte';
  import { globalMessages } from '../global-messages';
  import { activeTasks, configResponseSchema, configSchema, dayKey, dueReminders, emptyDay, products,
    readDay, shanghaiClock, updateDay, type Product, type WorkflowConfig, type WorkflowDay, type WorkflowNode } from '../trading-workflow/model';

  let config = $state<WorkflowConfig | null>(null);
  let actorKey = '';
  let canEdit = $state(false);
  let now = $state(new Date());
  let day = $state<WorkflowDay>(emptyDay(shanghaiClock().date));
  let loading = $state(true);
  let loadError = $state('');
  let editing = $state(false);
  let permission = $state<NotificationPermission | 'unsupported'>('unsupported');
  let notificationsEnabled = $state(false);
  let mounted = false;
  let localAvailable = true;
  let checking = false;
  let abort: AbortController;
  const clock = $derived(shanghaiClock(now));
  const tasks = $derived(config ? activeTasks(config.nodes, day) : []);
  const completed = $derived(tasks.filter(node => day.completed[node.id]).length);
  const notificationLabel = $derived(permission === 'unsupported' ? '浏览器不支持通知' : permission === 'denied' ? '通知已被阻止' : notificationsEnabled ? '关闭浏览器提醒' : '开启浏览器提醒');
  function prefsKey() { return `eastmoney:trading-workflow:notifications:${encodeURIComponent(actorKey)}`; }
  function storageFailure() {
    localAvailable = false;
    globalMessages.warning('本地存储不可用或记录损坏，当前进度仅在本页保留', { key: 'workflow-storage', duration: 10000 });
  }
  function restore(date: string) {
    try { day = readDay(localStorage, dayKey(actorKey, date), date); }
    catch { if (day.date !== date) day = emptyDay(date); storageFailure(); }
  }
  function persist(changeDay: (value: WorkflowDay) => void) {
    const date = shanghaiClock().date;
    if (day.date !== date) restore(date);
    if (localAvailable) {
      try { day = updateDay(localStorage, dayKey(actorKey, date), date, changeDay); return; }
      catch { storageFailure(); }
    }
    const copy = structuredClone($state.snapshot(day)); changeDay(copy); day = copy;
  }
  async function change(changeDay: (value: WorkflowDay) => void) {
    if (navigator.locks) await navigator.locks.request(`trading-workflow:${actorKey}`, () => { if (mounted) persist(changeDay); });
    else persist(changeDay);
  }
  async function loadConfig() {
    loading = true; loadError = '';
    try {
      const response = await fetch('/api/trading-workflow/config', { signal: abort?.signal });
      if (!response.ok) throw new Error(await responseError(response));
      const data = configResponseSchema.parse(await response.json());
      if (!mounted) return;
      config = { version: data.version, nodes: data.nodes }; actorKey = data.actorKey; canEdit = data.canEdit;
      restore(shanghaiClock().date);
      try { notificationsEnabled = localStorage.getItem(prefsKey()) === 'true'; } catch { storageFailure(); }
      void remind();
    } catch (error) { if (mounted) loadError = error instanceof Error ? error.message : '交易流程加载失败'; }
    finally { if (mounted) loading = false; }
  }
  async function responseError(response: Response) {
    try { const body = await response.json() as { error?: unknown }; return typeof body.error === 'string' ? body.error : `请求失败（${response.status}）`; }
    catch { return `请求失败（${response.status}）`; }
  }
  async function saveConfig(nodes: WorkflowNode[]) {
    if (!config) return false;
    const response = await fetch('/api/trading-workflow/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedVersion: config.version, nodes }) });
    if (!response.ok) { globalMessages.error(await responseError(response)); return false; }
    config = configSchema.parse(await response.json());
    globalMessages.success('交易流程节点已保存');
    void remind(); return true;
  }
  function complete(id: string, value: boolean) { void change(state => { state.completed[id] = value; }); }
  function branch(id: string, value: boolean) { void change(state => { state.branches[id] = value; }).then(remind); }
  function enable(product: Product, value: boolean) { void change(state => { state.enabled[product] = value; }).then(remind); }
  async function toggleNotifications() {
    if (permission === 'unsupported') return;
    try {
      if (!notificationsEnabled) permission = await Notification.requestPermission();
      if (permission !== 'granted') { globalMessages.warning('请在浏览器网站设置中允许通知'); return; }
      notificationsEnabled = !notificationsEnabled;
      try { localStorage.setItem(prefsKey(), String(notificationsEnabled)); } catch { storageFailure(); }
      if (notificationsEnabled) void remind();
    } catch { globalMessages.error('浏览器通知开启失败，请检查网站通知权限'); }
  }
  function locate() {
    const pending = tasks.find(node => !day.completed[node.id]);
    if (pending) document.querySelector<HTMLElement>(`[data-workflow-node="${pending.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'instant' });
  }
  async function remind() {
    if (!mounted || !config || checking) return;
    checking = true;
    const run = () => {
      if (!mounted || !config) return;
      const date = shanghaiClock().date;
      if (day.date !== date) restore(date);
      // Re-read inside the browser lock so another tab's delivered alerts are not replayed.
      if (localAvailable) { try { day = readDay(localStorage, dayKey(actorKey, date), date); } catch { storageFailure(); } }
      if ('Notification' in window) permission = Notification.permission;
      const browser = notificationsEnabled && permission === 'granted';
      const due = dueReminders(config.nodes, day, new Date(), browser ? 'browser' : 'page');
      if (!due.length) return;
      let sent = false;
      if (browser) {
        try {
          for (const item of due) {
            const label = products.find(product => product.id === item.node.scope)?.label ?? '日内协同';
            const notification = new Notification(`${item.time} · ${label}`, { body: item.node.title, tag: `${actorKey}:${date}:${item.key}` });
            notification.onclick = () => { window.focus(); document.querySelector<HTMLElement>(`[data-workflow-node="${item.node.id}"]`)?.scrollIntoView({ block: 'center' }); notification.close(); };
            notification.onerror = () => globalMessages.warning('浏览器通知未送达，请查看到点待办', { key: 'workflow-notification-error' });
          }
          sent = true;
        } catch { globalMessages.warning('浏览器无法发送通知，请查看到点待办', { key: 'workflow-notification-error' }); notificationsEnabled = false; }
      }
      if (!sent) globalMessages.info(due.map(item => `${item.time} ${item.node.title}`).join('；'), { key: 'workflow-reminder', title: '交易待办提醒', duration: 10000 });
      persist(state => { for (const item of due) state.notified[sent ? item.key : item.key.replace(/^browser:/, 'page:')] = true; });
    };
    try {
      if (navigator.locks) await navigator.locks.request(`trading-workflow:${actorKey}`, run);
      else run();
    } catch { globalMessages.warning('提醒检查失败，请刷新交易流程', { key: 'workflow-notification-error' }); }
    finally { checking = false; }
  }
  onMount(() => {
    mounted = true; abort = new AbortController();
    permission = 'Notification' in window && window.isSecureContext ? Notification.permission : 'unsupported';
    void loadConfig();
    const timer = setInterval(() => {
      now = new Date();
      if (config && day.date !== clock.date) restore(clock.date);
      void remind();
    }, 1000);
    function sync(event: StorageEvent) {
      if (event.key === dayKey(actorKey, shanghaiClock().date) || event.key === null) restore(shanghaiClock().date);
      if (event.key === prefsKey() || event.key === null) { try { notificationsEnabled = localStorage.getItem(prefsKey()) === 'true'; } catch { storageFailure(); } }
    }
    function wake() { now = new Date(); void remind(); }
    window.addEventListener('storage', sync); window.addEventListener('focus', wake); document.addEventListener('visibilitychange', wake);
    return () => { mounted = false; abort.abort(); clearInterval(timer); window.removeEventListener('storage', sync); window.removeEventListener('focus', wake); document.removeEventListener('visibilitychange', wake); };
  });
</script>

<div class="tr-view-stack">
  <SectionHeading id="workflow-day-title" title="日内交易" meta={`${clock.date} · ${clock.time}`} />
  {#if loading}<p role="status">正在加载交易流程…</p>
  {:else if loadError}<ModuleCard><p role="alert">{loadError}</p><button class="btn" onclick={loadConfig}>重新加载</button></ModuleCard>
  {:else if config}
    <div class="flow-toolbar" aria-label="交易流程操作">
      <Badge tone={completed === tasks.length ? 'success' : 'info'}>已完成 {completed} / {tasks.length}</Badge>
      <button class="btn" onclick={locate}>定位待办</button>
      <button class="btn" disabled={permission === 'unsupported'} onclick={toggleNotifications}>{notificationLabel}</button>
      <button class="btn" onclick={loadConfig}>刷新配置</button>
      {#if canEdit}<button class="btn btn-primary" onclick={() => editing = true}>编辑节点</button>{/if}
    </div>
    <ModuleCard labelledBy="workflow-common-title">
      <PanelHeading id="workflow-common-title" title="日内协同" />
      <WorkflowTree nodes={config.nodes} {day} scope="shared" clockMinutes={clock.minutes} onComplete={complete} onBranch={branch} />
    </ModuleCard>
    <div class="flow-lanes">
      {#each products as product}
        <WorkflowLane product={product.id} label={product.label} nodes={config.nodes} {day} clockMinutes={clock.minutes} clockTime={clock.time} onComplete={complete} onBranch={branch} onEnable={enable} />
      {/each}
    </div>
    {#if editing}<WorkflowEditor {config} onSave={saveConfig} onClose={() => editing = false} />{/if}
  {/if}
</div>

<style>
  .flow-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
  .flow-lanes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; align-items: start; }
  @media (max-width: 1000px) { .flow-lanes { grid-template-columns: minmax(0, 1fr); } }
</style>
