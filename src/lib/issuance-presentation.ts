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
export function issuanceDecisionNarrative(snapshot: IssuanceSnapshot): string | null {
  const label = issuanceDecisionLabel(snapshot.decision.action);
  const first = snapshot.forecast[0];
  const firstCost = first?.coupon_percent == null ? '' : `首个可发行日预计票面${first.coupon_percent.toFixed(2)}%`;
  if (label === '尽快发行') {
    const saving = snapshot.decision.expected_net_saving_bp;
    return `${firstCost ? `${firstCost}，` : ''}${saving == null ? '未来窗口预期改善未达到择时门槛' : `未来窗口最大预计净节约${saving.toFixed(1)}bp，未达到等待门槛`}；建议按融资计划尽快发行。`;
  }
  if (label === '等待') {
    const best = snapshot.forecast.find(row => row.date === snapshot.decision.lowest_expected_cost_date);
    const saving = snapshot.decision.expected_net_saving_bp;
    if (firstCost && best?.coupon_percent != null && saving != null) {
      const [year,month,day] = best.date.split('-');
      return `${firstCost}，${year}年${Number(month)}月${Number(day)}日预计票面${best.coupon_percent.toFixed(2)}%，扣除等待成本后预计节约${saving.toFixed(1)}bp；建议结合资金需求在该窗口发行。`;
    }
    return '建议结合资金需求等待更优发行窗口。';
  }
  if (label === '暂缓发行') return snapshot.decision.reason === 'insufficient_primary_history'
    ? '同类发行历史不足，当前票面预测暂缺；建议暂缓决策并补充可比发行证据。'
    : snapshot.decision.reason === 'no_issuance_day'
      ? '未来窗口内没有可发行日，建议调整发行时点并重新评估融资安排。'
      : '当前发行窗口缺少可用的成本预测，建议暂缓发行并重新评估融资安排。';
  return null;
}

export type ShapGroup = { display_name: string; absolute_bp: number; net_bp: number };
const groups = [
  '利率', '信用', '资金', '宏观', '一级发行', '二级成交', '日历', '其他',
] as const;

function shapGroup(feature: string): typeof groups[number] {
  if (feature.startsWith('macro_')) return '宏观';
  if (/^(supply_|issue_count_|weighted_cost|net_financing|maturity_wall|redemption_pressure)/.test(feature)) return '一级发行';
  if (/^(bond_volume_|credit_bond_volume_ratio|credit_volume_chg_|rate_credit_volume_ratio)/.test(feature)) return '二级成交';
  if (/^(funding_|dr007|r007|shibor|omo)/.test(feature)) return '资金';
  if (/^(rate_|gov)|cdb|policy_bond|term_spread|curve_curvature|short_term_spread/.test(feature)) return '利率';
  if (/aaa|credit/.test(feature)) return '信用';
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
    group.net_bp += feature.shap_bp;
    totals.set(name, group);
  }
  return groups.flatMap(name => totals.has(name) ? [{...totals.get(name)!, absolute_bp:Math.abs(totals.get(name)!.net_bp)}] : []);
}

/** Keep real macro, issuance and trading contributors visible beside the top bars. */
export function selectIssuanceShapDrivers(features: NonNullable<IssuanceSnapshot['explanation']>['features']) {
  const ranked = features.filter(row => Number.isFinite(row.shap_bp) && row.shap_bp !== 0)
    .sort((left, right) => Math.abs(right.shap_bp) - Math.abs(left.shap_bp));
  const selected = new Map(ranked.slice(0, 8).map(row => [row.feature, row]));
  for (const group of ['宏观', '一级发行', '二级成交']) {
    const representative = ranked.find(row => shapGroup(row.feature) === group);
    if (representative) selected.set(representative.feature, representative);
  }
  return [...selected.values()].sort((left, right) => Math.abs(right.shap_bp) - Math.abs(left.shap_bp));
}
