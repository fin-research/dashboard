import type { IssuanceSnapshot } from './issuance-model';

export type IssuanceDecisionLabel = '尽快发行' | '等待' | '暂缓发行';

/** Labels are presentation of the published decision, not a second model. */
export function issuanceDecisionLabel(action: string): IssuanceDecisionLabel | null {
  if (action === '可按资金计划发行' || action === '尽快发行') return '尽快发行';
  if (action === '可择机等待' || action === '等待') return '等待';
  if (action === '暂缓发行') return '暂缓发行';
  return null;
}

/** Display the published coupon window; preserve separately edited human text. */
export function issuanceDecisionNarrative(snapshot: IssuanceSnapshot): string | null {
  if(!['尽快发行','等待'].includes(snapshot.decision.action))return null;
  const first=snapshot.forecast[0];
  if(first?.coupon_percent==null)return '当前没有可用的发行利率预测。';
  const windows=snapshot.decision.low_rate_windows.map(row=>row.start===row.end?row.start:`${row.start}至${row.end}`).join('、');
  const best=snapshot.forecast.find(row=>row.date===snapshot.decision.lowest_expected_cost_date);
  return `首个可发行日预计票面${first.coupon_percent.toFixed(2)}%；预测较低区间为${windows}。${best?.coupon_percent==null?'':`最低日${best.date}预计票面${best.coupon_percent.toFixed(2)}%。`}${snapshot.decision.action==='尽快发行'?'当前已处于较低区间，可按资金计划发行。':'可结合资金需求等待较低区间。'}`;
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
