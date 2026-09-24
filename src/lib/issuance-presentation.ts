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
  if (label === '尽快发行') return '当前没有可信的等待优势，建议尽快发行。';
  if (label === '等待') return '当前存在符合模型门槛的等待机会，建议等待并持续跟踪发行窗口。';
  if (label === '暂缓发行') return '当前发行条件不利，建议暂缓发行并重新评估融资安排。';
  return null;
}

export type ShapGroup = { display_name: string; absolute_bp: number; net_bp: number };
const groups = [
  '国债与期限', '政策金融债', '信用债', '资金面', '日历', '其他',
] as const;

function shapGroup(feature: string): typeof groups[number] {
  if (/cdb|policy_bond/.test(feature)) return '政策金融债';
  if (/aaa|credit/.test(feature)) return '信用债';
  if (/dr007|r007|shibor|omo|funding|policy_rate|vs_policy/.test(feature)) return '资金面';
  if (/gov|term_spread|curve_curvature|short_term_spread/.test(feature)) return '国债与期限';
  if (/weekday|day_of_week|month|quarter|year|calendar/.test(feature)) return '日历';
  return '其他';
}

/** Aggregate every actual tree SHAP contribution; the bar chart shows the top individual features. */
export function groupIssuanceShap(features: NonNullable<IssuanceSnapshot['explanation']>['features']): ShapGroup[] {
  const totals = new Map<string, ShapGroup>(groups.map(display_name => [display_name, { display_name, absolute_bp: 0, net_bp: 0 }]));
  for (const feature of features) {
    const group = totals.get(shapGroup(feature.feature))!;
    group.absolute_bp += Math.abs(feature.shap_bp);
    group.net_bp += feature.shap_bp;
  }
  return [...totals.values()];
}
