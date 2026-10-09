import type { CreditInstitutionView } from './types.ts';
import type { CreditEffectiveStatus } from './validity.ts';

// Accept the existing workbook labels as aliases of the same business category.
const typeOrder: Record<string, number> = {
  '政策性银行': 0,
  '国有行': 1, '国有银行': 1,
  '股份行': 2,
  '城商行': 3,
  '农商行': 4,
  '民营银行': 5,
  '外资行': 6, '境外行及外资行': 6,
};
const typeCollator = new Intl.Collator('zh-CN');
const nameCollator = new Intl.Collator('zh-CN', { numeric: true });

export function compareCreditInstitutionTypes(left: string, right: string): number {
  if (left === right) return 0;
  return (typeOrder[left] ?? 7) - (typeOrder[right] ?? 7)
    || typeCollator.compare(left, right);
}

export function compareCreditInstitutionOrder(
  left: Pick<CreditInstitutionView, 'institutionType' | 'institutionName'>,
  right: Pick<CreditInstitutionView, 'institutionType' | 'institutionName'>,
): number {
  return compareCreditInstitutionTypes(left.institutionType, right.institutionType)
    || nameCollator.compare(left.institutionName, right.institutionName);
}

export function matchesCreditStatus(status: CreditEffectiveStatus, filter: CreditEffectiveStatus | 'active' | 'all' = 'active'): boolean {
  return filter === 'all' || (filter === 'active' ? status !== 'revoked' : status === filter);
}
