<script lang="ts">
  import { onMount } from 'svelte';
  import { descendants, isInquiry, products, type Scope, type WorkflowNode } from './model';
  let { nodes = $bindable(), selectedId, disabled, onSelect, onClose, onBranch, expanded }: {
    nodes: WorkflowNode[]; selectedId: string; disabled: boolean; onSelect: (id: string) => void;
    onClose: () => void; onBranch: (id: string, value: boolean) => void; expanded: boolean;
  } = $props();
  const selected = $derived(nodes.find(node => node.id === selectedId));
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
      <label>节点名称<input class="input" required maxlength="160" bind:value={selected.title} /></label>
      <label>业务内容<textarea class="textarea" maxlength="1200" rows="4" bind:value={selected.detail}></textarea></label>
      <label>所属流程<select class="select" value={selected.scope} onchange={(event) => {
        if (!selected) return; const scope = event.currentTarget.value as Scope;
        const ids = descendants(nodes, selected.id); nodes = nodes.map(node => ids.has(node.id) ? { ...node, scope, parentId: node.id === selectedId ? null : node.parentId } : node);
      }}>{#each scopes as scope}<option value={scope.id}>{scope.label}</option>{/each}</select></label>
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
        <div class="editor-pair">
          <label>开始 / 提醒<input class="input" type="time" value={selected.startTime ?? ''} oninput={event => { if (selected) selected.startTime = event.currentTarget.value || null; }} /></label>
          <label>结束<input class="input" type="time" value={selected.endTime ?? ''} oninput={event => { if (selected) selected.endTime = event.currentTarget.value || null; }} /></label>
        </div>
        <label class="editor-checkbox"><input type="checkbox" class="checkbox" checked={isInquiry(selected)} onchange={event => { if (selected) selected.inquiry = event.currentTarget.checked; }} />询价文本框</label>
      {:else}
        <label class="editor-checkbox"><input type="checkbox" class="checkbox" checked={expanded} onchange={event => onBranch(selectedId, event.currentTarget.checked)} />展开分支</label>
      {/if}
      <div class="editor-pair">
        <label>水平偏移<input class="input" type="number" min="-10000" max="10000" value={selected.offset?.x ?? 0} oninput={event => { if (selected) selected.offset = { x: event.currentTarget.valueAsNumber || 0, y: selected.offset?.y ?? 0 }; }} /></label>
        <label>垂直偏移<input class="input" type="number" min="-10000" max="10000" value={selected.offset?.y ?? 0} oninput={event => { if (selected) selected.offset = { x: selected.offset?.x ?? 0, y: event.currentTarget.valueAsNumber || 0 }; }} /></label>
      </div>
      <div class="editor-actions"><button type="button" class="btn" onclick={() => selected && addChild(selected)}>新增下级节点</button><button type="button" class="btn btn-outline btn-error" onclick={() => selected && remove(selected)}>删除节点</button></div>
    {/if}
  </fieldset>
</aside>

<style>
  .workflow-editor { width: 340px; max-height: 76dvh; overflow-y: auto; padding: 20px; background: var(--tr-surface); border-left: 1px solid var(--tr-border); flex: none; }
  .editor-heading { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
  h2 { font-size: 1.25rem; font-weight: bold; margin: 0; }
  .editor-fields { border: 0; margin: 0; padding: 0; display: grid; gap: 16px; min-width: 0; }
  .editor-fields label { display: grid; gap: 6px; font-weight: bold; font-size: .875rem; min-width: 0; }
  .editor-fields :is(input:not([type="checkbox"]), select, textarea) { width: 100%; font-weight: normal; }
  .editor-fields .editor-checkbox { display: flex; align-items: center; gap: 8px; }
  .editor-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .editor-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  @media (max-width: 1100px) { .workflow-editor { position: fixed; right: 16px; bottom: 16px; z-index: 30; width: min(340px, calc(100vw - 32px)); max-height: calc(100dvh - 130px); border: 1px solid var(--tr-border); border-radius: 10px; box-shadow: 0 8px 32px rgb(23 32 51 / 12%); } }
</style>
