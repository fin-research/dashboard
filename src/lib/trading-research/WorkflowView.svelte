<script lang="ts">
  import { onMount } from 'svelte';
  import ModuleCard from "../../components/ModuleCard.svelte";
  import { Clock } from '@lucide/svelte';
  import { portal } from '../portal';
  import WorkflowCanvas from '../trading-workflow/WorkflowCanvas.svelte';
  import { workflowGroups } from '../trading-workflow/graph';
  import WorkflowEditor from '../trading-workflow/WorkflowEditor.svelte';
  import { globalMessages } from '../global-messages';
  import { configResponseSchema, configSchema, dayKey, dueReminders, emptyDay, products, nodesSchema,
    readDay, shanghaiClock, updateDay, type Product, type WorkflowConfig, type WorkflowDay, type WorkflowNode } from '../trading-workflow/model';

  let config = $state<WorkflowConfig | null>(null);
  let actorKey = '';
  let canEdit = $state(false);
  let now = $state(new Date());
  let day = $state<WorkflowDay>(emptyDay(shanghaiClock().date));
  let loading = $state(true);
  let loadError = $state('');
  let editing = $state(false);
  let draft = $state<WorkflowNode[]>([]);
  let selectedId = $state('');
  let saving = $state(false);
  let preview = $state<WorkflowDay>(emptyDay(shanghaiClock().date));
  const displayDay = $derived(editing ? { ...day, enabled: preview.enabled, branches: preview.branches } : day);
  function startEditing() {
    if (!config) return;
    draft = structuredClone($state.snapshot(config.nodes));
    preview = structuredClone($state.snapshot(day)); selectedId = ''; editing = true;
  }
  function cancelEditing() {
    if (saving) return;
    if (config && JSON.stringify(draft) !== JSON.stringify(config.nodes) && !window.confirm('放弃未保存的流程修改？')) return;
    editing = false; selectedId = '';
  }
  async function saveDraft() {
    const result = nodesSchema.safeParse(draft);
    if (!result.success) { globalMessages.error(result.error.issues[0]?.message ?? '节点配置无效'); return; }
    saving = true;
    try { if (await saveConfig(result.data)) { editing = false; selectedId = ''; } }
    catch { globalMessages.error('配置保存失败，请重试'); }
    finally { saving = false; }
  }
  function move(id: string, offset: { x: number; y: number }) {
    if (editing && !saving) {
      const ids = new Set(workflowGroups(draft).find(group => group.some(node => node.id === id))?.map(node => node.id));
      draft = draft.map(node => ids.has(node.id) ? { ...node, offset } : node); selectedId = id;
    }
  }
  function addNode() {
    const node: WorkflowNode = { id: crypto.randomUUID(), scope: 'shared', parentId: null, kind: 'task', title: '新节点', detail: '', startTime: null, endTime: null };
    draft = [...draft, node]; selectedId = node.id;
  }
  function setBranch(ids: string[], value: boolean) {
    if (editing) { for (const id of ids) preview.branches[id] = value; } else branch(ids, value);
  }
  function setEnabled(product: Product, value: boolean) {
    if (editing) preview.enabled[product] = value; else enable(product, value);
  }
  function note(id: string, value: string) { void change(state => { state.notes[id] = value; }); }
  let permission = $state<NotificationPermission | 'unsupported'>('unsupported');
  let notificationsEnabled = $state(false);
  let mounted = false;
  let localAvailable = true;
  let checking = false;
  let abort: AbortController;
  const clock = $derived(shanghaiClock(now));
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
  function complete(ids: string[], value: boolean) { void change(state => { for (const id of ids) state.completed[id] = value; }); }
  function branch(ids: string[], value: boolean) { void change(state => { for (const id of ids) state.branches[id] = value; }).then(remind); }
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
            notification.onclick = () => { window.focus(); window.dispatchEvent(new CustomEvent('workflow-locate', { detail: item.node.id })); notification.close(); };
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

<div class="workflow-view">
  <div class="workflow-header" use:portal={'#tr-topbar-actions'}>
    <time class="workflow-clock" datetime={`${clock.date}T${clock.time}+08:00`} aria-label="当前时间"><Clock size={18} aria-hidden="true" />{clock.time}</time>
    {#if canEdit && config}
      <label class="edit-mode"><input type="checkbox" class="toggle toggle-primary" checked={editing} disabled={saving}
        onchange={event => { editing ? cancelEditing() : startEditing(); event.currentTarget.checked = editing; }} />编辑模式</label>
    {/if}
  </div>
  {#if loading}<p role="status">正在加载交易流程…</p>
  {:else if loadError}<ModuleCard><p role="alert">{loadError}</p><button class="btn" onclick={loadConfig}>重新加载</button></ModuleCard>
  {:else if config}
    <div class="flow-workspace" class:saving>
      <WorkflowCanvas nodes={editing ? draft : config.nodes} day={displayDay} clockMinutes={clock.minutes} {editing} {selectedId}
        onSelect={id => selectedId = id} onMove={move} onComplete={complete} onBranch={setBranch} onEnable={setEnabled} onNote={note} />
      {#if editing && (selectedId || !draft.length)}
        {#key selectedId}<WorkflowEditor bind:nodes={draft} {selectedId} disabled={saving} onSelect={id => selectedId = id}
          onClose={() => selectedId = ''} onBranch={(id, value) => setBranch([id], value)} expanded={!!preview.branches[selectedId]}
          onSave={saveDraft} onAdd={addNode} onReset={() => draft = draft.map(({ offset, ...node }) => node)}
          notificationsEnabled={notificationsEnabled} notificationsSupported={permission !== 'unsupported'} onNotifications={toggleNotifications} />{/key}
      {/if}
    </div>
  {/if}
</div>

<style>
  .workflow-view { min-width: 0; }
  .workflow-header { display: flex; align-items: center; gap: 28px; }
  .workflow-clock { display: flex; gap: 8px; align-items: center; color: var(--tr-text); font-size: 1rem; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .workflow-clock :global(svg) { color: #5b759c; }
  .edit-mode { display: flex; align-items: center; gap: 10px; min-height: 44px; font-size: 1rem; white-space: nowrap; }
  .flow-workspace { display: flex; min-width: 0; align-items: flex-start; gap: 16px; }
  .flow-workspace :global(.workflow-diagram) { flex: 1; }
  .flow-workspace.saving { pointer-events: none; }
  @media (max-width: 720px) { .workflow-header { gap: 12px; } .workflow-clock { font-size: .875rem; } }
</style>
