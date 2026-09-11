import type { CreditInstitutionView, CreditStatus } from './types.ts';

export type CreditEffectiveStatus = CreditStatus | 'expired' | 'pending';
type CreditPeriod = Pick<CreditInstitutionView, 'status' | 'effectiveDate' | 'expiryDate' | 'reportDate' | 'previousPeriod'>;

/** Approval is a recorded fact; validity is evaluated for the requested business day. */
export function creditEffectiveStatus(institution: CreditPeriod): CreditEffectiveStatus {
  if (institution.status !== 'approved') return institution.status;
  if (institution.expiryDate && institution.expiryDate < institution.reportDate) return 'expired';
  if (institution.effectiveDate && institution.effectiveDate > institution.reportDate) {
    const prior = institution.previousPeriod;
    if (prior && prior.effectiveDate <= institution.reportDate && prior.expiryDate >= institution.reportDate) return 'approved';
    return 'pending';
  }
  return 'approved';
}

export function isCreditEffective(institution: CreditPeriod): boolean {
  return creditEffectiveStatus(institution) === 'approved';
}
