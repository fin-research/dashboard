<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { NativeSelect } from '$lib/components/ui/native-select/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';
  import { permissionVisibility } from '../permission-visibility.ts';
  import { globalMessages } from '../global-messages.ts';
  import { updateCreditInstitution } from '../credit/client.ts';
  import { creditMaintenanceAmounts, creditMaintenanceChanges, creditMaintenanceDraft, setCreditBondUsage, type CreditMaintenanceDraft } from '../credit/maintenance.ts';
  import { creditItemLabels, type CreditInstitutionView, type CreditInstitutionUpdateResponse, type CreditItemType } from '../credit/types.ts';

  let { institution, reportDate, calendarMonth, firstDate, previousDate, contextVersion, onapplied }: {
    institution: CreditInstitutionView;
    reportDate: string; calendarMonth: string; firstDate?: string; previousDate: string | null; contextVersion: number;
    onapplied: (result: CreditInstitutionUpdateResponse, contextVersion: number) => void;
  } = $props();
  const allowed = permissionVisibility();
  const canEdit = $derived($allowed('credit.institution:update'));
  const itemOrder: CreditItemType[] = ['bond_investment', 'yield_certificate', 'interbank_lending', 'legal_overdraft', 'other'];
  let draft = $state<CreditMaintenanceDraft>(null!);
  $effect.pre(() => {
    draft = creditMaintenanceDraft(institution);
  });
  let saving = $state(false);
  const amounts = $derived(creditMaintenanceAmounts(institution, draft));

  function numberInput(event: Event): number | null {
    const value = (event.currentTarget as HTMLInputElement).value;
    return value === '' ? null : Number(value);
  }
  function formatAmount(value: number | null | undefined): string {
    return value == null ? '—' : value.toFixed(2);
  }
  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!canEdit || saving) return;
    if (draft.effectiveDate && draft.expiryDate && draft.effectiveDate > draft.expiryDate) {
      globalMessages.error('授信到期日不能早于生效日');
      return;
    }
    const changes = creditMaintenanceChanges(institution, draft);
    if (!changes.institution && !changes.items) {
      globalMessages.info('没有需要保存的变更');
      return;
    }
    saving = true;
    const version = contextVersion;
    try {
      const result = await updateCreditInstitution({ operation: 'maintenance', reportDate, viewDate:reportDate, viewFirstDate:firstDate, viewPreviousDate:previousDate, calendarMonth,
        institutionName: institution.institutionName, changes }, fetch);
      onapplied(result,version);
      globalMessages.success('授信维护已保存');
    } catch (error) {
      globalMessages.error(error instanceof Error ? error.message : '授信维护保存失败');
    } finally {
      saving = false;
    }
  }
</script>

<form class="tr-credit-detail" onsubmit={save}>
  <div class="tr-credit-editor-head">
    <strong>{institution.institutionName}</strong>
    <Button permission="credit.institution:update" type="submit" disabled={saving}>{saving ? '保存中' : '保存'}</Button>
  </div>
  <div class="tr-credit-editor-grid">
    <label><span>机构性质</span><Input maxlength={100} bind:value={draft.institutionType} disabled={!canEdit || saving} /></label>
    <label><span>状态</span>
      {#if institution.status === 'applying'}
        <NativeSelect bind:value={draft.status} disabled={!canEdit || saving}><option value="applying">申请中</option><option value="approved">已获批</option></NativeSelect>
      {:else}
        <Input value={institution.status === 'approved' ? '已获批' : '已撤销'} disabled />
      {/if}
    </label>
    <label><span>保密协议</span><NativeSelect value={draft.confidentialityStatus ? 'true' : 'false'} disabled={!canEdit || saving}
      onchange={event => draft.confidentialityStatus = (event.currentTarget as HTMLSelectElement).value === 'true'}>
      <option value="true">已签署</option><option value="false">未签署</option>
    </NativeSelect></label>
    <label><span>授信总额（亿元）</span><Input type="number" min="0" step="0.000001" value={draft.totalLimit ?? ''} disabled={!canEdit || saving} oninput={event => draft.totalLimit = numberInput(event)} /></label>
    <label><span>已用额度（亿元）</span><Input value={formatAmount(amounts.totalUsed)} disabled /></label>
    <label><span>可用额度（亿元）</span><Input value={formatAmount(amounts.available)} disabled /></label>
    <label><span>生效日</span><Input type="date" bind:value={draft.effectiveDate} disabled={!canEdit || saving} /></label>
    <label><span>到期日</span><Input type="date" bind:value={draft.expiryDate} disabled={!canEdit || saving} /></label>
    <label><span>关联客户</span><Input value={institution.clients?.map(client => client.name).join('、') || '—'} disabled /></label>
    <label><span>银行经办机构</span><Input maxlength={500} bind:value={draft.bankOffice} disabled={!canEdit || saving} /></label>
    <label><span>我司申请部门</span><Input maxlength={500} bind:value={draft.applyingDepartment} disabled={!canEdit || saving} /></label>
    <label><span>我司经办人</span><Input maxlength={200} bind:value={draft.handler} disabled={!canEdit || saving} /></label>
  </div>
  <div class="tr-credit-item-grid">
    {#each itemOrder as type}
      {@const item = institution.items.find(value => value.type === type)}
      <fieldset class:tr-credit-item-other={type === 'other'} class:tr-credit-item-bond={type === 'bond_investment'}>
        <legend>{creditItemLabels[type]}</legend>
        {#if type !== 'other'}
          <label><span>额度（亿元）</span><Input type="number" min="0" step="0.000001" value={draft.items[type].limitAmount ?? ''} disabled={!canEdit || saving} oninput={event => draft.items[type].limitAmount = numberInput(event)} /></label>
        {/if}
        {#if type === 'bond_investment'}
          <label><span>已用（亿元）</span><Input type="number" step="0.000001" value={amounts.used[type] ?? ''} disabled={!canEdit || saving || item?.primaryUsedAmount == null} oninput={event => setCreditBondUsage(institution, draft, 'used', numberInput(event))} /></label>
        {:else if type === 'legal_overdraft' || type === 'other'}
          <label><span>已用（亿元）</span><Input type="number" step="0.000001" value={draft.items[type].usedAmount ?? ''} disabled={!canEdit || saving} oninput={event => draft.items[type].usedAmount = numberInput(event)} /></label>
        {:else}
          <label><span>已用（亿元）</span><Input value={formatAmount(amounts.used[type])} disabled /></label>
        {/if}
        {#if type === 'bond_investment'}
          <label><span>可用（亿元）</span><Input type="number" step="0.000001" value={amounts.remaining[type] ?? ''} disabled={!canEdit || saving || item?.primaryUsedAmount == null || draft.items[type].limitAmount == null} oninput={event => setCreditBondUsage(institution, draft, 'remaining', numberInput(event))} /></label>
          <div class="tr-credit-bond-components">
            <label><span>一级发行</span><Input aria-label="一级发行（亿元）" value={formatAmount(item?.primaryUsedAmount)} disabled /></label>
            <label><span>二级买卖</span><Input aria-label="二级买卖（亿元）" type="number" step="0.000001" value={draft.items[type].secondaryUsedAmount ?? ''} disabled={!canEdit || saving} oninput={event => draft.items[type].secondaryUsedAmount = numberInput(event)} /></label>
          </div>
        {:else if type !== 'other'}
          <label><span>可用（亿元）</span><Input value={formatAmount(amounts.remaining[type])} disabled /></label>
        {/if}
        {#if type === 'bond_investment' || type === 'other'}
          <label><span>说明</span><Textarea rows={1} maxlength={4000} bind:value={draft.items[type].details} disabled={!canEdit || saving} /></label>
        {/if}
      </fieldset>
    {/each}
  </div>
  <div class="tr-credit-notes-grid">
    <label><span>授信额度明细</span><Textarea rows={1} maxlength={4000} bind:value={draft.detail} disabled={!canEdit || saving} /></label>
    <label><span>债券投资偏好</span><Textarea rows={1} maxlength={4000} bind:value={draft.bondPreference} disabled={!canEdit || saving} /></label>
    <label><span>备注</span><Textarea rows={1} maxlength={8000} bind:value={draft.notes} disabled={!canEdit || saving} /></label>
  </div>
</form>
