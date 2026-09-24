import type { IssuanceSnapshot } from './issuance-model';

export type IssuanceDecisionLabel = '尽快发行' | '等待' | '暂缓发行';

/** Labels are presentation of the published decision, not a second model. */
export function issuanceDecisionLabel(action: string): IssuanceDecisionLabel | null {
  if (action === '可按资金计划发行' || action === '尽快发行') return '尽快发行';
  if (action === '可择机等待' || action === '等待') return '等待';
  if (action === '暂缓发行') return '暂缓发行';
  return null;
}

/** Keep automatic conclusion copy aligned with the three published actions.
 * Human-edited conclusion text is never passed through this function. */
export function issuanceDecisionNarrative(action: string): string | null {
  const label = issuanceDecisionLabel(action);
  if (label === '尽快发行') return '未来窗口没有明显更低的预测票面，建议尽快发行。';
  if (label === '等待') return '预计更低成本的发行日尚未到来，建议等待并持续跟踪发行窗口。';
  if (label === '暂缓发行') return '当前发行条件不利，建议暂缓发行并重新评估融资安排。';
  return null;
}

export type ShapGroup = { display_name: string; absolute_bp: number; net_bp: number };
const groups = [
  '利率与期限', '信用债', '资金面', '宏观经济', '一级发行', '二级成交', '日历', '其他',
] as const;

function shapGroup(feature: string): typeof groups[number] {
  if (feature.startsWith('macro_')) return '宏观经济';
  if (/^(supply_|issue_count_|weighted_cost|net_financing|maturity_wall|redemption_pressure)/.test(feature)) return '一级发行';
  if (/^(bond_volume_|credit_bond_volume_ratio|credit_volume_chg_|rate_credit_volume_ratio)/.test(feature)) return '二级成交';
  if (/^(funding_|dr007|r007|shibor|omo)/.test(feature)) return '资金面';
  if (/cdb|policy_bond|gov|term_spread|curve_curvature|short_term_spread/.test(feature)) return '利率与期限';
  if (/aaa|credit/.test(feature)) return '信用债';
  if (/weekday|day_of_week|month|quarter|year|calendar/.test(feature)) return '日历';
  return '其他';
}

/** Aggregate every actual tree SHAP contribution; the bar chart shows the top individual features. */
export function groupIssuanceShap(features: NonNullable<IssuanceSnapshot['explanation']>['features']): ShapGroup[] {
  const totals = new Map<string, ShapGroup>();
  for (const feature of features) {
    if (!Number.isFinite(feature.shap_bp) || feature.shap_bp === 0) continue;
    const name = shapGroup(feature.feature);
    const group = totals.get(name) ?? { display_name: name, absolute_bp: 0, net_bp: 0 };
    group.absolute_bp += Math.abs(feature.shap_bp);
    group.net_bp += feature.shap_bp;
    totals.set(name, group);
  }
  return groups.flatMap(name => totals.has(name) ? [totals.get(name)!] : []);
}

/** Keep real macro, issuance and trading contributors visible beside the top bars. */
export function selectIssuanceShapDrivers(features: NonNullable<IssuanceSnapshot['explanation']>['features']) {
  const ranked = features.filter(row => Number.isFinite(row.shap_bp) && row.shap_bp !== 0)
    .sort((left, right) => Math.abs(right.shap_bp) - Math.abs(left.shap_bp));
  const selected = new Map(ranked.slice(0, 8).map(row => [row.feature, row]));
  for (const group of ['宏观经济', '一级发行', '二级成交']) {
    const representative = ranked.find(row => shapGroup(row.feature) === group);
    if (representative) selected.set(representative.feature, representative);
  }
  return [...selected.values()].sort((left, right) => Math.abs(right.shap_bp) - Math.abs(left.shap_bp));
}
