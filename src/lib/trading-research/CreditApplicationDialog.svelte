<script lang="ts">
  import Modal from '$lib/components/Modal.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { NativeSelect } from '$lib/components/ui/native-select/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';
  import { globalMessages } from '../global-messages.ts';
  import { updateCreditInstitution } from '../credit/client.ts';
  import { creditItemLabels, creditItemTypes, type CreditApplicationType, type CreditInstitutionView,
    type CreditItemType, type CreditStatus } from '../credit/types.ts';
  import type { CreditInstitutionChanges, CreditInstitutionUpdateInput, CreditItemChanges } from '../credit/update.ts';

  let { institutions, reportDate, onapplied }: {
    institutions: CreditInstitutionView[];
    reportDate: string;
    onapplied: (date: string) => Promise<void>;
  } = $props();

  type ItemDraft = { limitAmount: number | null; details: string; usedAmount: number | null; secondaryUsedAmount: number | null };
  type Draft = {
    institutionType: string; status: CreditStatus; confidentialityStatus: boolean;
    totalLimit: number | null; effectiveDate: string; expiryDate: string;
    bankOffice: string; applyingDepartment: string; handler: string;
    detail: string; bondPreference: string; notes: string;
    items: Record<CreditItemType, ItemDraft>;
  };
  const labels: Record<CreditApplicationType, string> = {
    new: '新增', renewal: '续期', increase: '扩额', revocation: '撤销', maintenance: '维护',
  };
  const operations: CreditApplicationType[] = ['new','renewal','increase','revocation','maintenance'];
  let dialog: Modal;
  let operation = $state<CreditApplicationType>('new');
  let institutionName = $state('');
  let businessDate = $state('');
  let draft = $state<Draft>(blankDraft());
  let confirmedRevocation = $state(false);
  let submitting = $state(false);
  let errorText = $state('');
  const selected = $derived(institutions.find(row => row.institutionName === institutionName));
  const eligible = $derived(institutions.filter(row => operation === 'maintenance' ||
    (operation === 'revocation' ? row.status !== 'revoked' : row.status === 'approved')));

  function blankDraft(): Draft {
    return {
      institutionType:'', status:'approved', confidentialityStatus:false, totalLimit:null,
      effectiveDate:'', expiryDate:'', bankOffice:'', applyingDepartment:'', handler:'',
      detail:'', bondPreference:'', notes:'',
      items:Object.fromEntries(creditItemTypes.map(type => [type,
        {limitAmount:null,details:'',usedAmount:null,secondaryUsedAmount:null}])) as Draft['items'],
    };
  }

  function copyDraft(row?: CreditInstitutionView): Draft {
    if (!row) return blankDraft();
    return {
      institutionType:row.institutionType,status:row.status,confidentialityStatus:row.confidentialityStatus,
      totalLimit:row.totalLimit,effectiveDate:row.effectiveDate ?? '',expiryDate:row.expiryDate ?? '',
      bankOffice:row.bankOffice ?? '',applyingDepartment:row.applyingDepartment ?? '',handler:row.handler ?? '',
      detail:row.detail ?? '',bondPreference:row.bondPreference ?? '',notes:row.notes ?? '',
      items:Object.fromEntries(creditItemTypes.map(type => {
        const item = row.items.find(value => value.type === type);
        return [type,{limitAmount:item?.limitAmount ?? null,details:item?.details ?? '',
          usedAmount:item?.usedAmount ?? null,secondaryUsedAmount:item?.secondaryUsedAmount ?? null}];
      })) as Draft['items'],
    };
  }

  export function open(): void {
    businessDate = reportDate;
    selectOperation('new');
    dialog.showModal();
  }

  function selectOperation(next: CreditApplicationType): void {
    operation = next;
    institutionName = next === 'new' ? '' : institutions.find(row => next === 'maintenance' ||
      (next === 'revocation' ? row.status !== 'revoked' : row.status === 'approved'))?.institutionName ?? '';
    draft = copyDraft(institutions.find(row => row.institutionName === institutionName));
    confirmedRevocation = false;
    errorText = '';
  }

  function selectInstitution(event: Event): void {
    institutionName = (event.currentTarget as HTMLSelectElement).value;
    draft = copyDraft(institutions.find(row => row.institutionName === institutionName));
    errorText = '';
  }

  function numberInput(event: Event): number | null {
    const value = (event.currentTarget as HTMLInputElement).value;
    return value === '' ? null : Number(value);
  }

  function changesForSubmission(): CreditInstitutionUpdateInput['changes'] {
    const original = selected;
    const institution: CreditInstitutionChanges = {};
    const items: CreditItemChanges[] = [];
    if (operation === 'new') {
      Object.assign(institution,{
        institutionType:draft.institutionType,status:draft.status,
        confidentialityStatus:draft.confidentialityStatus,totalLimit:draft.totalLimit,
        ...(draft.effectiveDate ? {effectiveDate:draft.effectiveDate} : {}),
        ...(draft.expiryDate ? {expiryDate:draft.expiryDate} : {}),
      });
      for (const field of ['bankOffice','applyingDepartment','handler','detail','bondPreference','notes'] as const) {
        if (draft[field]) (institution as Record<string, unknown>)[field] = draft[field];
      }
    } else if (original) {
      if (operation === 'renewal') {
        if (draft.effectiveDate !== (original.effectiveDate ?? '')) institution.effectiveDate = draft.effectiveDate;
        institution.expiryDate = draft.expiryDate;
        if (draft.totalLimit !== original.totalLimit) institution.totalLimit = draft.totalLimit;
      } else if (operation === 'increase') {
        institution.totalLimit = draft.totalLimit;
      } else if (operation === 'revocation') {
        institution.status = 'revoked';
      } else {
        for (const field of ['institutionType','status','confidentialityStatus','totalLimit','effectiveDate','expiryDate',
          'bankOffice','applyingDepartment','handler','detail','bondPreference','notes'] as const) {
          const oldValue = original[field] ?? (field === 'totalLimit' ? null : '');
          if (draft[field] !== oldValue) (institution as Record<string, unknown>)[field] = draft[field];
        }
      }
      if (operation !== 'maintenance' && draft.notes !== (original.notes ?? '')) institution.notes = draft.notes;
    }
    if (operation === 'new' || operation === 'increase' || operation === 'maintenance') {
      for (const type of creditItemTypes) {
        const before = original?.items.find(item => item.type === type);
        const item = draft.items[type];
        const change: CreditItemChanges = {type};
        if (item.limitAmount !== (before?.limitAmount ?? null)) change.limitAmount = item.limitAmount;
        if (operation !== 'increase' && item.details !== (before?.details ?? '')) change.details = item.details;
        if (operation === 'maintenance') {
          if (type === 'bond_investment' && item.secondaryUsedAmount !== (before?.secondaryUsedAmount ?? null))
            change.secondaryUsedAmount = item.secondaryUsedAmount;
          if ((type === 'legal_overdraft' || type === 'other') && item.usedAmount !== (before?.usedAmount ?? null))
            change.usedAmount = item.usedAmount;
        }
        if (Object.keys(change).length > 1) items.push(change);
      }
    }
    return {institution, ...(items.length ? {items} : {})};
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    if (!institutionName.trim() || !businessDate) { errorText = '请选择机构并填写业务生效日'; return; }
    if (operation === 'new' && !draft.institutionType.trim()) { errorText = '请填写机构性质'; return; }
    if (operation === 'renewal' && (!selected?.expiryDate || !draft.expiryDate || draft.expiryDate <= selected.expiryDate)) {
      errorText = '新到期日须晚于原到期日'; return;
    }
    if (operation === 'increase' && (draft.totalLimit == null || draft.totalLimit <= (selected?.totalLimit ?? 0))) {
      errorText = '新授信总额须高于原额度'; return;
    }
    if (operation === 'revocation' && !confirmedRevocation) { errorText = '请确认撤销授信'; return; }
    if (draft.effectiveDate && draft.expiryDate && draft.effectiveDate > draft.expiryDate) {
      errorText = '授信到期日不能早于生效日'; return;
    }
    const changes = changesForSubmission();
    if (!Object.keys(changes.institution ?? {}).length && !changes.items?.length) { errorText = '没有需要提交的变更'; return; }
    submitting = true; errorText = '';
    try {
      await updateCreditInstitution({operation,reportDate:businessDate,institutionName:institutionName.trim(),changes},fetch,operation === 'new');
      dialog.close();
      await onapplied(businessDate);
      globalMessages.success(`授信${labels[operation]}已提交`);
    } catch (error) { errorText = error instanceof Error ? error.message : '授信申请提交失败'; }
    finally { submitting = false; }
  }
</script>

<Modal bind:this={dialog} aria-labelledby="credit-application-title" class="credit-application-dialog">
  <div class="dialog-body">
    <form onsubmit={submit}>
      <h2 id="credit-application-title">授信申请</h2>
      <div class="tr-credit-application-tabs" role="group" aria-label="申请类型">
        {#each operations as option}
          <Button type="button" variant={operation === option ? 'default' : 'outline'} aria-pressed={operation === option}
            onclick={() => selectOperation(option)}>{labels[option]}</Button>
        {/each}
      </div>
      <div class="tr-credit-editor-grid">
        {#if operation === 'new'}
          <label><span>机构名称</span><Input required maxlength={200} bind:value={institutionName} /></label>
        {:else}
          <label><span>授信机构</span><NativeSelect required value={institutionName} onchange={selectInstitution}>
            {#each eligible as row}<option value={row.institutionName}>{row.institutionName}</option>{/each}
          </NativeSelect></label>
        {/if}
        <label><span>业务生效日</span><Input required type="date" bind:value={businessDate} /></label>
      </div>

      {#if operation === 'new'}
        <div class="tr-credit-editor-grid">
          <label><span>机构性质</span><Input required maxlength={100} bind:value={draft.institutionType} /></label>
          <label><span>审批状态</span><NativeSelect bind:value={draft.status}><option value="approved">已获批</option><option value="applying">申请中</option></NativeSelect></label>
          <label class="tr-credit-checkbox"><Checkbox checked={draft.confidentialityStatus} onCheckedChange={value => draft.confidentialityStatus = value === true} /><span>已签署保密协议</span></label>
          <label><span>授信总额（亿元）</span><Input type="number" min="0" step="0.000001" value={draft.totalLimit ?? ''} oninput={event => draft.totalLimit = numberInput(event)} /></label>
          <label><span>生效日</span><Input type="date" bind:value={draft.effectiveDate} /></label>
          <label><span>到期日</span><Input type="date" bind:value={draft.expiryDate} /></label>
        </div>
      {:else if selected && operation === 'renewal'}
        <div class="tr-credit-application-current">原期限 <strong>{selected.effectiveDate ?? '—'} 至 {selected.expiryDate ?? '—'}</strong> · 原总额 <strong>{selected.totalLimit ?? '—'}亿元</strong></div>
        <div class="tr-credit-editor-grid">
          <label><span>新生效日</span><Input required type="date" bind:value={draft.effectiveDate} /></label>
          <label><span>新到期日</span><Input required type="date" bind:value={draft.expiryDate} /></label>
          <label><span>续期后总额（亿元）</span><Input type="number" min="0" step="0.000001" value={draft.totalLimit ?? ''} oninput={event => draft.totalLimit = numberInput(event)} /></label>
        </div>
      {:else if selected && operation === 'increase'}
        <div class="tr-credit-application-current">原总额 <strong>{selected.totalLimit ?? '—'}亿元</strong></div>
        <div class="tr-credit-editor-grid">
          <label><span>扩额后总额（亿元）</span><Input required type="number" min="0" step="0.000001" value={draft.totalLimit ?? ''} oninput={event => draft.totalLimit = numberInput(event)} /></label>
        </div>
      {:else if selected && operation === 'revocation'}
        <div class="tr-credit-application-current">{selected.institutionName} · {selected.totalLimit ?? '—'}亿元 · 到期日 {selected.expiryDate ?? '—'}</div>
        <label class="tr-credit-application-confirm"><Checkbox checked={confirmedRevocation} onCheckedChange={value => confirmedRevocation = value === true} /><span>确认撤销该机构授信</span></label>
      {:else if selected}
        <div class="tr-credit-editor-grid">
          <label><span>机构性质</span><Input bind:value={draft.institutionType} /></label>
          {#if selected.status === 'applying'}
            <label><span>审批状态</span><NativeSelect bind:value={draft.status}><option value="applying">申请中</option><option value="approved">已获批</option></NativeSelect></label>
          {:else}
            <label><span>审批状态</span><Input readonly value={selected.status === 'approved' ? '已获批' : '已撤销'} /></label>
          {/if}
          <label class="tr-credit-checkbox"><Checkbox checked={draft.confidentialityStatus} onCheckedChange={value => draft.confidentialityStatus = value === true} /><span>已签署保密协议</span></label>
          <label><span>授信总额（亿元）</span><Input type="number" min="0" step="0.000001" value={draft.totalLimit ?? ''} oninput={event => draft.totalLimit = numberInput(event)} /></label>
          <label><span>生效日</span><Input type="date" bind:value={draft.effectiveDate} /></label>
          <label><span>到期日</span><Input type="date" bind:value={draft.expiryDate} /></label>
          <label><span>银行经办机构</span><Input bind:value={draft.bankOffice} /></label>
          <label><span>我司申请部门</span><Input bind:value={draft.applyingDepartment} /></label>
          <label><span>我司经办人</span><Input bind:value={draft.handler} /></label>
        </div>
      {/if}

      {#if operation === 'new' || operation === 'increase' || operation === 'maintenance'}
        <div class="tr-credit-item-grid">
          {#each creditItemTypes as type}
            <fieldset>
              <legend>{creditItemLabels[type]}</legend>
              <label><span>额度（亿元）</span><Input type="number" min="0" step="0.000001" value={draft.items[type].limitAmount ?? ''} oninput={event => draft.items[type].limitAmount = numberInput(event)} /></label>
              {#if operation !== 'increase'}
                {#if operation === 'maintenance' && (type === 'legal_overdraft' || type === 'other')}
                  <label><span>已用（亿元）</span><Input type="number" step="0.000001" value={draft.items[type].usedAmount ?? ''} oninput={event => draft.items[type].usedAmount = numberInput(event)} /></label>
                {/if}
                {#if operation === 'maintenance' && type === 'bond_investment'}
                  <label><span>二级买卖净余额（亿元）</span><Input type="number" step="0.000001" value={draft.items[type].secondaryUsedAmount ?? ''} oninput={event => draft.items[type].secondaryUsedAmount = numberInput(event)} /></label>
                {/if}
                <label><span>说明</span><Input bind:value={draft.items[type].details} /></label>
              {/if}
            </fieldset>
          {/each}
        </div>
      {/if}

      {#if operation === 'new' || operation === 'maintenance'}
        <div class="tr-credit-notes-grid">
          <label><span>授信额度描述</span><Textarea rows={2} bind:value={draft.detail} /></label>
          <label><span>债券投资偏好</span><Textarea rows={2} bind:value={draft.bondPreference} /></label>
          {#if operation === 'new'}
            <label><span>银行经办机构</span><Input bind:value={draft.bankOffice} /></label>
            <label><span>我司申请部门</span><Input bind:value={draft.applyingDepartment} /></label>
            <label><span>我司经办人</span><Input bind:value={draft.handler} /></label>
          {/if}
        </div>
      {/if}
      <label class="tr-credit-application-notes"><span>备注</span><Textarea rows={2} bind:value={draft.notes} /></label>
      {#if errorText}<p class="tr-credit-application-error" role="alert">{errorText}</p>{/if}
      <div class="dialog-actions">
        <Button type="button" variant="outline" disabled={submitting} onclick={() => dialog.close()}>取消</Button>
        <Button type="submit" disabled={submitting}>{submitting ? '提交中' : `提交${labels[operation]}`}</Button>
      </div>
    </form>
  </div>
</Modal>
