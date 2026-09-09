import { creditItemTypes, type ParsedCreditInstitution } from './types.ts';
import type { CreditInstitutionUpdateInput } from './update.ts';

export const institutionDiffFields = {
  institutionType: 'institution_type', confidentialityStatus: 'confidentiality_status', status: 'status',
  totalLimit: 'total', effectiveDate: 'effective_date', expiryDate: 'expiry_date',
  bankOffice: 'bank_office', applyingDepartment: 'applying_department', handler: 'handler',
  detail: 'detail', bondPreference: 'bond_preference', notes: 'notes',
} as const;

export function toCreditDiffPatch(changes: CreditInstitutionUpdateInput['changes']): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes.institution ?? {})) {
    const column = institutionDiffFields[key as keyof typeof institutionDiffFields];
    if (column) patch[column] = value;
  }
  for (const item of changes.items ?? []) {
    if ('limitAmount' in item) patch[`${item.type}_limit`] = item.limitAmount;
    if ('details' in item) patch[`${item.type}_detail`] = item.details;
    if ('usedAmount' in item && item.type !== 'yield_certificate' && item.type !== 'interbank_lending') {
      patch[`${item.type}_used`] = item.usedAmount;
    }
  }
  return patch;
}

export function toCreditImportPatch(institution: ParsedCreditInstitution): Record<string, unknown> {
  return toCreditDiffPatch({
    institution: Object.fromEntries(Object.keys(institutionDiffFields).map(key =>
      [key, institution[key as keyof ParsedCreditInstitution] ?? null])),
    items: creditItemTypes.map(type => {
      const item = institution.items.find(item => item.type === type);
      return { type, limitAmount: item?.limitAmount ?? null, details: item?.details ?? null,
        ...(type === 'yield_certificate' || type === 'interbank_lending' ? {} : { usedAmount: item?.usedAmount ?? null }) };
    }),
  });
}
