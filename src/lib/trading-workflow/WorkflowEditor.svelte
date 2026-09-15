<script lang="ts">
  import { onMount } from 'svelte';
  import { childrenOf, descendants, moveNode, nodesSchema, products, type Scope, type WorkflowNode, type WorkflowConfig } from './model';
  import { globalMessages } from '../global-messages';
  let { config, onSave, onClose }: { config: WorkflowConfig; onSave: (nodes: WorkflowNode[]) => Promise<boolean>; onClose: () => void } = $props();
  let draft = $state<WorkflowNode[]>([]);
  let selectedId = $state('');
  let saving = $state(false);
  let validation = $state('');
  let dialog: HTMLDialogElement;
  const selected = $derived(draft.find(node => node.id === selectedId));
  const scopes = [{ id: 'shared', label: '日内协同' }, ...products];
  onMount(() => { draft = structuredClone($state.snapshot(config.nodes)); selectedId = draft[0]?.id ?? ''; dialog.showModal(); });
  function add(scope: Scope, kind: 'task' | 'branch') {
    const node: WorkflowNode = { id: crypto.randomUUID(), scope, kind, parentId: null, title: kind === 'task' ? '新节点' : '新分支', detail: '', startTime: null, endTime: null };
    draft = [...draft, node]; selectedId = node.id;
  }
  function remove(node: WorkflowNode) {
    if (!window.confirm(`删除“${node.title}”及其子节点？`)) return;
    const ids = descendants(draft, node.id);
    draft = draft.filter(item => !ids.has(item.id)); selectedId = draft[0]?.id ?? '';
  }
  async function save() {
    validation = '';
    const result = nodesSchema.safeParse(draft);
    if (!result.success) { validation = result.error.issues[0]?.message ?? '节点配置无效'; return; }
    saving = true;
    try { if (await onSave(result.data)) onClose(); }
    catch { globalMessages.error('配置保存失败，请重试'); }
    finally { saving = false; }
  }
</script>

{#snippet tree(scope: Scope, parentId: string | null = null)}
  <ol class="editor-list">
    {#each childrenOf(draft, scope, parentId) as node, index (node.id)}
      <li>
        <div class="editor-row">
          <button type="button" class="btn btn-ghost node-select" class:chosen={selectedId === node.id} aria-pressed={selectedId === node.id} onclick={() => selectedId = node.id}>{node.kind === 'branch' ? '◇ ' : ''}{node.title}</button>
          <button type="button" class="btn btn-ghost" aria-label={`上移 ${node.title}`} disabled={saving || index === 0} onclick={() => draft = moveNode(draft, node.id, -1)}>↑</button>
          <button type="button" class="btn btn-ghost" aria-label={`下移 ${node.title}`} disabled={saving || index === childrenOf(draft, scope, parentId).length - 1} onclick={() => draft = moveNode(draft, node.id, 1)}>↓</button>
        </div>
        {#if node.kind === 'branch'}{@render tree(scope, node.id)}{/if}
      </li>
    {/each}
  </ol>
{/snippet}

<dialog bind:this={dialog} class="modal" aria-labelledby="workflow-editor-title" oncancel={(event) => { event.preventDefault(); if (!saving) onClose(); }}>
  <div class="modal-box workflow-editor">
    <h2 id="workflow-editor-title">编辑流程节点</h2>
    <form onsubmit={(event) => { event.preventDefault(); void save(); }}>
      <fieldset disabled={saving}>
        <div class="editor-layout">
          <div class="editor-navigation">
            {#each scopes as scope}
              <section aria-label={scope.label}>
                <h3>{scope.label}</h3>
                <div class="editor-add"><button class="btn btn-ghost" type="button" onclick={() => add(scope.id as Scope, 'task')}>＋ 节点</button><button class="btn btn-ghost" type="button" onclick={() => add(scope.id as Scope, 'branch')}>＋ 分支</button></div>
                {@render tree(scope.id as Scope)}
              </section>
            {/each}
          </div>
          <div class="editor-fields">
            {#if selected}
              <label>节点名称<input class="input" required maxlength="160" bind:value={selected.title} /></label>
              <label>业务内容<textarea class="textarea" maxlength="1200" rows="5" bind:value={selected.detail}></textarea></label>
              <label>品种<select class="select" value={selected.scope} onchange={(event) => {
                if (!selected) return; const scope = event.currentTarget.value as Scope;
                const ids = descendants(draft, selected.id); draft = draft.map(node => ids.has(node.id) ? { ...node, scope, parentId: node.id === selectedId ? null : node.parentId } : node);
              }}>{#each scopes as scope}<option value={scope.id}>{scope.label}</option>{/each}</select></label>
              <label>上级分支<select class="select" bind:value={selected.parentId}>
                <option value={null}>主流程</option>
                {#each draft.filter(node => node.scope === selected.scope && node.kind === 'branch' && !descendants(draft, selected.id).has(node.id)) as parent}<option value={parent.id}>{parent.title}</option>{/each}
              </select></label>
              {#if selected.kind === 'task'}
                <div class="editor-times">
                  <label>开始 / 提醒<input class="input" type="time" value={selected.startTime ?? ''} oninput={(event) => { if (selected) selected.startTime = event.currentTarget.value || null; }} /></label>
                  <label>结束<input class="input" type="time" value={selected.endTime ?? ''} oninput={(event) => { if (selected) selected.endTime = event.currentTarget.value || null; }} /></label>
                </div>
              {/if}
              <button type="button" class="btn btn-outline btn-error" onclick={() => selected && remove(selected)}>删除节点</button>
            {:else}<p>暂无节点</p>{/if}
          </div>
        </div>
      </fieldset>
      {#if validation}<p role="alert" class="text-error">{validation}</p>{/if}
      <div class="modal-action"><button class="btn" type="button" disabled={saving} onclick={onClose}>取消</button><button class="btn btn-primary" disabled={saving}>{saving ? '保存中…' : '保存配置'}</button></div>
    </form>
  </div>
</dialog>

<style>
  .workflow-editor { width: min(1000px, calc(100vw - 32px)); max-width: 1000px; max-height: calc(100dvh - 32px); }
  h2 { font-size: 1.25rem; font-weight: bold; margin: 0 0 20px; }
  h3 { font-size: 1rem; font-weight: bold; margin: 0; }
  fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
  .editor-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; }
  .editor-navigation section { margin-bottom: 20px; }
  .editor-list { list-style: none; padding: 0; margin: 0; }
  .editor-list .editor-list { padding-left: 16px; border-left: 1px solid var(--tr-border); }
  .editor-row { display: flex; gap: 4px; align-items: center; }
  .node-select { flex: 1; min-width: 0; height: auto; min-height: 44px; text-align: left; justify-content: flex-start; white-space: normal; overflow-wrap: anywhere; }
  .chosen { color: var(--tr-primary); background: var(--color-base-200); }
  .editor-add { display: flex; gap: 8px; margin: 6px 0; }
  .editor-fields { display: grid; gap: 16px; align-content: start; position: sticky; top: 0; align-self: start; }
  .editor-fields label { display: grid; gap: 6px; font-weight: bold; font-size: .875rem; min-width: 0; }
  .editor-fields :is(input, select, textarea) { width: 100%; font-weight: normal; }
  .editor-times { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  @media (max-width: 720px) { .editor-layout { grid-template-columns: minmax(0, 1fr); } .editor-fields { position: static; } .editor-navigation { max-height: 35dvh; overflow-y: auto; } }
</style>
