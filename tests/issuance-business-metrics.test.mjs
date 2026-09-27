import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { balanceWeightedIssuerSpread, loadIssuanceBusinessMetrics } from '../src/lib/server/issuance-business-metrics.ts';
import { groupIssuanceShap, selectIssuanceShapDrivers, issuanceDecisionLabel, issuanceDecisionNarrative } from '../src/lib/issuance-presentation.ts';
import { issuanceSnapshot } from './fixtures/issuance.mjs';

test('published actions have one explicit business label', () => {
  assert.equal(issuanceDecisionLabel('可按资金计划发行'), '尽快发行');
  assert.equal(issuanceDecisionLabel('可择机等待'), '等待');
  assert.equal(issuanceDecisionLabel('尽快发行'), '尽快发行');
  assert.equal(issuanceDecisionLabel('等待'), '等待');
  assert.equal(issuanceDecisionLabel('暂缓发行'), '暂缓发行');
  assert.equal(issuanceDecisionLabel('unrecognized'), null);
  const snapshot = issuanceSnapshot();
  assert.match(issuanceDecisionNarrative(snapshot), /1\.85%.*最大预计净节约1\.0bp.*建议按融资计划尽快发行/);
  snapshot.decision.action='等待';
  assert.match(issuanceDecisionNarrative(snapshot), /2026年9月3日预计票面1\.82%.*预计节约1\.0bp/);
  snapshot.decision.action='暂缓发行';
  assert.match(issuanceDecisionNarrative(snapshot), /建议暂缓发行/);
  snapshot.decision.action='unrecognized';
  assert.equal(issuanceDecisionNarrative(snapshot), null);
});

test('radar groups all actual tree contributions while retaining signs', () => {
  const groups = groupIssuanceShap([
    { feature: 'rate_gov_10y_change_1', value: -0.4, shap_bp: -0.2 },
    { feature: 'rate_gov_10y_change_5', value: -0.6, shap_bp: -0.1 },
    { feature: 'credit_spread', value: 0.4, shap_bp: 0.05 },
  ]);
  assert.deepEqual(groups.find(row => row.display_name === '利率'), {
    display_name: '利率', absolute_bp: 0.30000000000000004, net_bp: -0.30000000000000004,
  });
  assert.equal(groups.find(row => row.display_name === '信用').absolute_bp, 0.05);
  assert.equal(groupIssuanceShap([{ feature: 'dr007_vs_policy', value: 0.1, shap_bp: 0.02 }])
    .find(row => row.display_name === '资金').absolute_bp, 0.02);
  assert.equal(groupIssuanceShap([
    {feature:'rate_gov_10y_change_1',value:1,shap_bp:1},
    {feature:'rate_gov_10y_change_5',value:1,shap_bp:-.8},
  ])[0].absolute_bp, 0.19999999999999996);
  const expanded = [
    ...Array.from({length: 8}, (_, index) => ({feature: `rate_gov_3y_change_${index}`, value: index, shap_bp: .2-index*.01})),
    {feature:'macro_PMI_change_1m',value:.6,shap_bp:-.006},
    {feature:'net_financing_zscore',value:1.2,shap_bp:.004},
    {feature:'credit_bond_volume_ratio',value:null,shap_bp:.002},
  ];
  assert.deepEqual(groupIssuanceShap(expanded).filter(row => ['宏观','一级发行','二级成交'].includes(row.display_name)).map(row=>row.display_name), ['宏观','一级发行','二级成交']);
  assert.deepEqual(selectIssuanceShapDrivers(expanded).filter(row => ['macro_PMI_change_1m','net_financing_zscore','credit_bond_volume_ratio'].includes(row.feature)).map(row=>row.feature), ['macro_PMI_change_1m','net_financing_zscore','credit_bond_volume_ratio']);
});

test('issuer spread requires every active bond valuation and matched tenor', () => {
  const curve = [{ tenor_years: 1, yield_pct: 1.5 }, { tenor_years: 3, yield_pct: 1.7 }, { tenor_years: 5, yield_pct: 2.0 }];
  const bonds = [
    { bond_code: 'A', outstanding_balance_cny: 100, chinabond_yield_pct: 1.7, remaining_term_years: 2 },
    { bond_code: 'B', outstanding_balance_cny: 300, chinabond_yield_pct: 2.0, remaining_term_years: 4 },
  ];
  assert.ok(Math.abs(balanceWeightedIssuerSpread(bonds, curve).spread_bp - 13.75) < 1e-9);
  assert.equal(balanceWeightedIssuerSpread([{ ...bonds[0], chinabond_yield_pct: null }, bonds[1]], curve).spread_bp, null);
  assert.equal(balanceWeightedIssuerSpread([{ ...bonds[0], outstanding_balance_cny: null }, bonds[1]], curve).spread_bp, null);
  assert.equal(balanceWeightedIssuerSpread([{ ...bonds[0], remaining_term_years: 0.5 }, bonds[1]], curve).spread_bp, null);
  assert.ok(Math.abs(balanceWeightedIssuerSpread([{ ...bonds[0], outstanding_balance_cny: 0 }, bonds[1]], curve).spread_bp - 15) < 1e-9);
});

test('business metrics use as-of local-workbook LCR and complete daily issuer spread', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE public.quant_input(dataset text,entity_key text,field text,observation_date date,numeric_value double precision,source text);
      CREATE TABLE public.bond_issuance(bond_code text,issuer_name text,issuer_rating text,bond_type text,interest_rate_type text,has_option boolean,original_tenor_years double precision,issue_date date);
      CREATE TABLE public.bond_history(bond_code text,valuation_date date,chinabond_yield_pct double precision,outstanding_balance_cny double precision,remaining_term_years double precision);
      CREATE TABLE public.bond_industry_curve(curve_code text,observation_date date,tenor_years double precision,yield_pct double precision);`);
    for (let day = 1; day <= 21; day += 1) {
      const date = `2026-08-${String(day).padStart(2, '0')}`;
      await db.query(`INSERT INTO public.quant_input VALUES
        ('company','','lcr',$1::date,$2,'local-workbook'),
        ('company','','nsfr',$1::date,$3,'local-workbook'),
        ('company_report','','static_gap_1m',$1::date,$4,'r2-fund-report')`, [date, 1 + day / 10, 1 + day / 100, day-30]);
      await db.query(`INSERT INTO public.bond_history VALUES
        ('A',$1::date,$2,1000000000,3),('B',$1::date,$2,1000000000,3)`, [date, 1.7 + day/100]);
      await db.query(`INSERT INTO public.bond_industry_curve VALUES
        ('5781a1ff7651967e0176978d957b7346',$1::date,1,1.5),
        ('5781a1ff7651967e0176978d957b7346',$1::date,3,1.7)`, [date]);
    }
    await db.query(`INSERT INTO public.bond_issuance VALUES
      ('A','测试证券股份有限公司','AAA','证券公司债','固息',false,3,'2025-01-01'),
      ('B','测试证券股份有限公司','AAA','证券公司债','固息',false,12,'2025-01-01');`);
    const result = await loadIssuanceBusinessMetrics(db, '测试证券股份有限公司', '2026-08-21');
    assert.equal(result.lcr.date, '2026-08-21');
    assert.equal(result.lcr.value_ratio, 3.1);
    assert.equal(result.lcr.historical_percentile, 100);
    assert.equal(result.nsfr.value_ratio, 1.21);
    assert.equal(result.funding_gap.value_yi,-9);
    assert.equal(result.funding_gap.historical_percentile,100);
    assert.ok(Math.abs(result.issuer_spread.spread_bp - 21) < 1e-9);
    assert.equal(result.issuer_spread.historical_percentile,100);
    assert.equal(result.issuer_spread.outstanding_bonds, 2);
    const earlier = await loadIssuanceBusinessMetrics(db, '测试证券股份有限公司', '2026-07-31');
    assert.equal(earlier.issuer_spread, null);
  } finally {
    await db.close();
  }
});
