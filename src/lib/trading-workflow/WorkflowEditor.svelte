<script lang="ts">
  import { workflowGroups } from './graph';
  import { onMount } from 'svelte';
  import { descendants, isInquiry, products, type Scope, type WorkflowNode } from './model';
  let { nodes = $bindable(), selectedId, disabled, onSelect, onClose, onBranch, expanded, onSave, onAdd, onReset, notificationsEnabled, notificationsSupported, onNotifications }: {
    nodes: WorkflowNode[]; selectedId: string; disabled: boolean; onSelect: (id: string) => void;
    onSave: () => void; onAdd: () => void; onReset: () => void; notificationsEnabled: boolean; notificationsSupported: boolean; onNotifications: () => void;
    onClose: () => void; onBranch: (id: string, value: boolean) => void; expanded: boolean;
  } = $props();
  const selected = $derived(nodes.find(node => node.id === selectedId));
  const group = $derived(workflowGroups(nodes).find(items => items.some(node => node.id === selectedId)) ?? []);
  const offset = $derived(group[0]?.offset ?? { x: 0, y: 0 });
  function setOffset(axis: 'x' | 'y', value: number) {
    const ids = new Set(group.map(node => node.id));
    const next = { ...offset, [axis]: value };
    nodes = nodes.map(node => ids.has(node.id) ? { ...node, offset: next } : node);
  }
  const scopes = [{ id: 'shared', label: '日内协同' }, ...products];
  let panel: HTMLElement;
  onMount(() => panel.querySelector<HTMLInputElement>('input')?.focus());
  function remove(node: WorkflowNode) {
    if (!window.confirm(`删除“${node.title}”及其子节点？`)) return;
    const ids = descendants(nodes, node.id); nodes = nodes.filter(item => !ids.has(item.id)); onClose();
  }
  function addChild(node: WorkflowNode) {
    const child: WorkflowNode = { id: crypto.randomUUID(), scope: node.scope, kind: 'task', parentId: node.kind === 'branch' ? node.id : node.parentId, title: '新节点', detail: '', startTime: null, endTime: null };
    const index = nodes.findIndex(item => item.id === node.id);
    nodes = [...nodes.slice(0, index + 1), child, ...nodes.slice(index + 1)];
    if (node.kind === 'branch') onBranch(node.id, true);
    onSelect(child.id);
  }
</script>

<aside class="workflow-editor" aria-labelledby="workflow-editor-title" bind:this={panel}>
  <div class="editor-heading"><h2 id="workflow-editor-title">节点编辑</h2><button class="btn btn-ghost" type="button" aria-label="关闭节点编辑" onclick={onClose}>×</button></div>
  <fieldset disabled={disabled} class="editor-fields">
    {#if selected}
      <label>编辑节点<select class="select" value={selectedId} onchange={event => onSelect(event.currentTarget.value)}>
        {#each nodes as node}<option value={node.id}>{scopes.find(scope => scope.id === node.scope)?.label} · {isInquiry(node) ? '询价' : node.title}</option>{/each}
      </select></label>
      <label>节点名称<input class="input" required maxlength="160" bind:value={selected.title} /></label>
      {#if selected.kind === 'task'}
        <div class="editor-pair">
          <label>开始 / 提醒<input class="input" type="time" value={selected.startTime ?? ''} oninput={event => { if (selected) selected.startTime = event.currentTarget.value || null; }} /></label>
          <label>结束<input class="input" type="time" value={selected.endTime ?? ''} oninput={event => { if (selected) selected.endTime = event.currentTarget.value || null; }} /></label>
        </div>
      {/if}
      <label>所属流程<select class="select" value={selected.scope} onchange={(event) => {
        if (!selected) return; const scope = event.currentTarget.value as Scope;
        const ids = descendants(nodes, selected.id); nodes = nodes.map(node => ids.has(node.id) ? { ...node, scope, parentId: node.id === selectedId ? null : node.parentId } : node);
      }}>{#each scopes as scope}<option value={scope.id}>{scope.label}</option>{/each}</select></label>
      <label class="editor-checkbox"><input class="checkbox checkbox-primary" type="checkbox" checked={notificationsEnabled} disabled={!notificationsSupported} onchange={onNotifications} />浏览器提醒</label>
      <label>备注<textarea class="textarea" maxlength="1200" rows="4" bind:value={selected.detail}></textarea></label>
      <button class="btn btn-primary editor-save" type="button" onclick={onSave}>{disabled ? '保存中…' : '保存'}</button>
      <div class="editor-actions"><button type="button" class="btn btn-outline btn-error" style="--btn-color: var(--color-error-content)" onclick={() => selected && remove(selected)}>删除节点</button><button type="button" class="btn btn-outline btn-primary" onclick={() => selected && addChild(selected)}>新增下级节点</button></div>
      <details class="collapse editor-advanced"><summary class="collapse-title">节点设置</summary><div class="collapse-content editor-settings">
        <label>节点类型<select class="select" value={selected.kind} onchange={event => {
          if (!selected) return;
          if (event.currentTarget.value === 'task' && nodes.some(node => node.parentId === selectedId)) return;
          selected.kind = event.currentTarget.value as 'task' | 'branch';
          if (selected.kind === 'branch') { selected.startTime = null; selected.endTime = null; }
        }}><option value="task" disabled={nodes.some(node => node.parentId === selectedId)}>任务</option><option value="branch">条件分支</option></select></label>
        <label>上级分支<select class="select" bind:value={selected.parentId}>
          <option value={null}>主流程</option>
          {#each nodes.filter(node => node.scope === selected.scope && node.kind === 'branch' && !descendants(nodes, selected.id).has(node.id)) as parent}<option value={parent.id}>{parent.title}</option>{/each}
        </select></label>
        {#if selected.kind === 'task'}
          <label class="editor-checkbox"><input type="checkbox" class="checkbox" checked={isInquiry(selected)} onchange={event => { if (selected) selected.inquiry = event.currentTarget.checked; }} />询价输入框</label>
        {:else}<label class="editor-checkbox"><input type="checkbox" class="checkbox" checked={expanded} onchange={event => onBranch(selectedId, event.currentTarget.checked)} />展开分支</label>{/if}
        <div class="editor-pair">
          <label>水平偏移<input class="input" type="number" min="-10000" max="10000" value={offset.x} oninput={event => setOffset('x', event.currentTarget.valueAsNumber || 0)} /></label>
          <label>垂直偏移<input class="input" type="number" min="-10000" max="10000" value={offset.y} oninput={event => setOffset('y', event.currentTarget.valueAsNumber || 0)} /></label>
        </div>
        <button class="btn btn-ghost" type="button" onclick={onReset}>恢复自动布局</button>
      </div></details>
    {:else}<button class="btn btn-primary" type="button" onclick={onAdd}>新增节点</button>{/if}
  </fieldset>
</aside>

<style>
  .workflow-editor { width: 350px; max-height: calc(100dvh - 120px); overflow-y: auto; padding: 24px; background: #fff; border-radius: 8px; flex: none; position: sticky; top: 0; }
  .editor-heading { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding-bottom: 12px; border-bottom: 1px solid #dde6f4; }
  h2 { font-size: 1.25rem; font-weight: bold; margin: 0; }
  .editor-fields { border: 0; margin: 0; padding: 0; display: grid; gap: 22px; min-width: 0; }
  .editor-fields label { display: grid; gap: 8px; font-weight: bold; font-size: 1rem; min-width: 0; }
  .editor-fields :is(input:not([type="checkbox"]), select, textarea) { width: 100%; font-weight: normal; }
  .editor-fields .editor-checkbox { display: flex; align-items: center; gap: 10px; }
  .editor-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .editor-save { width: 100%; }
  .editor-advanced { border: 1px solid var(--tr-border); border-radius: 8px; }
  .editor-settings { display: grid; gap: 16px; }
  .editor-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  @media (max-width: 1200px) { .workflow-editor { position: fixed; right: 16px; bottom: 16px; z-index: 30; width: min(340px, calc(100vw - 32px)); max-height: calc(100dvh - 130px); border: 1px solid var(--tr-border); box-shadow: 0 8px 32px rgb(23 32 51 / 12%); } }
</style>
