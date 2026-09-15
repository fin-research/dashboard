<script lang="ts">
  import { tick, untrack } from 'svelte';
  import type { ShiborRate } from '../../data-contracts';
  import { blankInquiry, displayField, inheritRow, invalidField, suggestions, type InquiryDirectory, type InquiryField, type InquiryRow } from './inquiries';
  let { rows, loan, directory, rates, date, now, onRows, onRemember }: {
    rows: InquiryRow[]; loan: boolean; directory: InquiryDirectory; rates: ShiborRate[]; date: string; now: Date;
    onRows: (rows: InquiryRow[]) => void; onRemember: (row: InquiryRow) => void;
  } = $props();
  let entries = $state<InquiryRow[]>(untrack(() => rows.map(row => ({ ...row }))));
  let pending: string | null = null;
  $effect(() => {
    const incoming = rows;
    untrack(() => {
      const fingerprint = JSON.stringify(incoming);
      if (pending !== null) { if (pending === fingerprint) pending = null; return; }
      if (!active) entries = incoming.map(row => ({ ...row }));
    });
  });
  function publish(next: InquiryRow[]) { entries = next; pending = JSON.stringify(next); onRows(next); }
  let tail = $state<InquiryRow>(blankInquiry());
  let active = $state<{ id: string; field: InquiryField } | null>(null);
  let selected = $state(0);
  let dismissed = $state(false);
  let composing = $state(false);
  let invalid = $state('');
  let root: HTMLDivElement;
  const fields = $derived<InquiryField[]>(loan ? ['counterparty', 'trader', 'tenor', 'amount', 'price'] : ['counterparty', 'tenor', 'amount', 'price']);
  const allRows = $derived([...entries, tail]);
  const activeRow = $derived(allRows.find(row => row.id === active?.id));
  const options = $derived(!dismissed && activeRow && (active?.field === 'counterparty' || active?.field === 'trader')
    ? suggestions(active.field === 'counterparty' ? directory.counterparties : directory.traders, activeRow[active.field]) : []);
  const placeholders: Record<InquiryField, string> = { counterparty: '对手方', trader: '交易员', tenor: '期限', amount: '金额（亿）', price: '价格' };
  function update(row: InquiryRow, field: InquiryField, value: string) {
    if (row.id === tail.id) { publish([...entries, { ...tail, [field]: value }]); tail = blankInquiry(); }
    else publish(entries.map(item => item.id === row.id ? { ...item, [field]: value } : item));
    invalid = ''; selected = 0; dismissed = false;
  }
  async function focus(id: string, field: InquiryField) {
    await tick();
    root.querySelector<HTMLInputElement>(`[data-row="${id}"][data-field="${field}"]`)?.focus();
  }
  function normalize(row: InquiryRow, field: InquiryField) {
    row = allRows.find(item => item.id === row.id) ?? row;
    const index = allRows.findIndex(item => item.id === row.id);
    const value = inheritRow(row, allRows[index - 1])[field];
    if (value !== row[field]) update(row, field, value);
    return { ...row, [field]: value };
  }
  async function finish(row: InquiryRow) {
    row = allRows.find(item => item.id === row.id) ?? row;
    const index = allRows.findIndex(item => item.id === row.id);
    const completed = inheritRow(row, allRows[index - 1]);
    const error = invalidField(completed, loan);
    if (error) { invalid = `${row.id}:${error}`; await focus(row.id, error); return; }
    onRemember(completed);
    if (row.id === tail.id) {
      publish([...entries, completed]); tail = blankInquiry(); await focus(tail.id, 'counterparty');
    } else {
      publish(entries.map(item => item.id === row.id ? completed : item));
      await focus(allRows[index + 1]?.id ?? tail.id, 'counterparty');
    }
  }
  async function key(event: KeyboardEvent, row: InquiryRow, field: InquiryField) {
    if (event.isComposing || composing) return;
    if (event.key === 'Escape') { dismissed = true; return; }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && options.length) {
      event.preventDefault(); selected = (selected + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length; return;
    }
    if ((event.key === 'Backspace' || event.key === 'Delete') && (event.ctrlKey || event.metaKey) && row.id !== tail.id) {
      event.preventDefault(); publish(entries.filter(item => item.id !== row.id)); await focus(tail.id, 'counterparty'); return;
    }
    if (event.key !== 'Tab' && event.key !== 'Enter') return;
    if (event.shiftKey) return;
    let next = row;
    if (options.length && active?.id === row.id && active.field === field) {
      next = { ...row, [field]: options[selected] ?? options[0]! }; update(row, field, next[field]); dismissed = true;
    }
    next = normalize(next, field);
    event.preventDefault();
    if (field === 'price' || event.key === 'Enter' && invalidField(inheritRow(next, allRows[allRows.findIndex(item => item.id === row.id) - 1]), loan) === null) await finish(next);
    else await focus(row.id, fields[fields.indexOf(field) + 1]!);
  }
  function leave(row: InquiryRow, field: InquiryField) {
    const current = normalize(row, field);
    if (field === 'counterparty' || field === 'trader') onRemember(current);
    active = null;
  }
</script>

<div class="inquiry-table nodrag nopan nowheel" class:loan bind:this={root} role="table" aria-label="询价记录">
  {#each allRows as row (row.id)}
    <div class="inquiry-row" role="row">
      {#each fields as field}
        <div class="inquiry-cell" role="cell">
          <input class="input" type="text" inputmode={field === 'amount' || field === 'price' ? 'decimal' : 'text'}
            data-row={row.id} data-field={field} aria-label={placeholders[field]} placeholder={placeholders[field]}
            maxlength={field === 'counterparty' ? 160 : field === 'trader' ? 80 : 24}
            role={field === 'counterparty' || field === 'trader' ? 'combobox' : undefined}
            aria-autocomplete={field === 'counterparty' || field === 'trader' ? 'list' : undefined}
            aria-expanded={field === 'counterparty' || field === 'trader' ? active?.id === row.id && active.field === field && options.length > 0 : undefined}
            aria-controls={field === 'counterparty' || field === 'trader' ? `choices-${row.id}-${field}` : undefined}
            aria-activedescendant={active?.id === row.id && active.field === field && options.length ? `choice-${row.id}-${field}-${selected}` : undefined}
            aria-invalid={invalid === `${row.id}:${field}`} autocomplete="off"
            value={active?.id === row.id && active.field === field || row.id === tail.id ? row[field] : displayField(row, field, loan, rates, date, now)}
            onfocus={event => { active = { id: row.id, field }; selected = 0; dismissed = false; event.currentTarget.value = row[field]; event.currentTarget.select(); }}
            onblur={() => leave(row, field)} oninput={event => update(row, field, event.currentTarget.value)}
            oncompositionstart={() => composing = true} oncompositionend={() => composing = false}
            onkeydown={event => void key(event, row, field)} />
          {#if active?.id === row.id && active.field === field && options.length}
            <ul id={`choices-${row.id}-${field}`} class="inquiry-options" role="listbox" aria-label={placeholders[field]}>
              {#each options as option, index}
                <li id={`choice-${row.id}-${field}-${index}`} role="option" aria-selected={index === selected}
                  onpointerdown={event => { event.preventDefault(); update(row, field, option); dismissed = true; void focus(row.id, fields[fields.indexOf(field) + 1]!); }}>{option}</li>
              {/each}
            </ul>
          {/if}
        </div>
      {/each}
    </div>
  {/each}
</div>

<style>
  .inquiry-table { padding: 6px 8px 10px; background: white; border: 1px solid var(--tr-border, #dbe7f7); border-top: 0; border-radius: 0 0 8px 8px; }
  .inquiry-row { display: grid; grid-template-columns: minmax(90px, 1.5fr) minmax(52px, .65fr) minmax(65px, .8fr) minmax(68px, .9fr); border-bottom: 1px solid var(--tr-border, #dbe7f7); }
  .loan .inquiry-row { grid-template-columns: minmax(90px, 1.4fr) minmax(66px, 1fr) minmax(52px, .65fr) minmax(65px, .8fr) minmax(68px, .9fr); }
  .inquiry-cell { position: relative; min-width: 0; }
  .inquiry-cell .input { width: 100%; min-width: 0; height: 38px; padding-inline: 5px; font-size: .875rem; border: 0; border-radius: 0; background: transparent; box-shadow: none; font-weight: normal; }
  .inquiry-cell .input:focus { outline: 2px solid var(--brand, #2f6fd6); outline-offset: -2px; }
  .inquiry-cell .input[aria-invalid="true"] { outline: 2px solid var(--color-error, #d92d20); outline-offset: -2px; }
  .inquiry-options { position: absolute; top: 100%; left: 0; z-index: 20; min-width: 160px; max-height: 240px; overflow: auto; margin: 0; padding: 4px; list-style: none; border: 1px solid var(--tr-border, #dbe7f7); border-radius: 6px; background: white; box-shadow: 0 4px 12px #17203318; }
  .inquiry-options li { padding: 8px; cursor: pointer; font-size: .875rem; }
  .inquiry-options li[aria-selected="true"] { background: #eaf2ff; }
</style>
