import Decimal from 'decimal.js';
import { sumAmounts } from './amounts.ts';
import { creditInstitutionCategory, compareCreditInstitutionTypes } from './presentation.ts';
import { creditItemLabels, creditItemTypes, type CreditInstitutionView } from './types.ts';
import { isCreditEffective } from './validity.ts';

export type CreditChartDatum = { label: string; value: number | null };
const completeSum = (values: Array<number | null>): number | null => values.some(value => value == null) ? null : sumAmounts(values);
const ratio = (used: number | null, limit: number | null) => used == null || limit == null || limit === 0
  ? null : new Decimal(used).div(limit).times(100).toNumber();

export function buildCreditOverview(institutions: readonly CreditInstitutionView[], reportDate: string) {
  const visible = institutions.filter(row => row.status !== 'revoked');
  const effective = visible.filter(isCreditEffective);
  const categories = [...new Set(visible.map(row => creditInstitutionCategory(row.institutionType)))].sort(compareCreditInstitutionTypes);
  const groups = categories.map(label => ({ label, rows: effective.filter(row => creditInstitutionCategory(row.institutionType) === label) }));
  const bankLimits: CreditChartDatum[] = groups.map(({ label, rows }) => ({ label, value: rows.length ? completeSum(rows.map(row => row.totalLimit)) : null }));
  const bankCounts: CreditChartDatum[] = categories.map(label => ({ label, value: visible.filter(row => creditInstitutionCategory(row.institutionType) === label).length }));
  const bankUtilization: CreditChartDatum[] = groups.map(({ label, rows }) => ({ label, value: ratio(completeSum(rows.map(row => row.totalUsed)), completeSum(rows.map(row => row.totalLimit))) }));
  const products = creditItemTypes.map(type => ({ label: creditItemLabels[type],
    limit: completeSum(effective.map(row => row.items.find(item => item.type === type)?.limitAmount ?? null)),
    used: completeSum(effective.map(row => row.items.find(item => item.type === type)?.usedAmount ?? (type === 'legal_overdraft' || type === 'other' ? 0 : null))) }));
  const expiryLabels = ['30日内', '31–90日', '91–180日', '181–365日', '365日以上', '无到期日'];
  const expiryCounts = expiryLabels.map(label => ({ label, value: 0 }));
  for (const row of effective) {
    const days = row.expiryDate ? Math.round((Date.parse(`${row.expiryDate}T00:00:00Z`) - Date.parse(`${reportDate}T00:00:00Z`)) / 86400000) : null;
    const index = days == null ? 5 : days <= 30 ? 0 : days <= 90 ? 1 : days <= 180 ? 2 : days <= 365 ? 3 : 4;
    expiryCounts[index]!.value++;
  }
  return { bankLimits, bankCounts, bankUtilization,
    productLimits: products.filter(product => product.label !== creditItemLabels.other).map(product => ({ label: product.label, value: product.limit })),
    productUsage: products.map(product => ({ label: product.label, value: product.used })),
    statusCounts: [{ label: '已获批', value: effective.length }, { label: '申请中', value: visible.filter(row => !isCreditEffective(row)).length }],
    topLimits: [...effective].filter(row => row.totalLimit != null).sort((a, b) => b.totalLimit! - a.totalLimit!).slice(0, 10).map(row => ({ label: row.institutionName, value: row.totalLimit })),
    expiryCounts };
}
