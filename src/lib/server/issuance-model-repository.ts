import { issuanceReportSchema, type IssuanceReport } from '../issuance-model';
import type { BondDatabaseClient } from './postgres';
import { FinancingModelDatabaseError } from './financing-model-repository';

export async function loadIssuanceModelReport(client:BondDatabaseClient,runId:string|null=null):Promise<IssuanceReport> {
  const result=await client.query<{report:unknown}>(`SELECT jsonb_build_object(
    'snapshot',jsonb_build_object(
      'schema_version','issuance-forecast-v1','run_id',r.id,'generated_at',r.generated_at,'as_of_date',r.as_of_date,
      'market_source_date',r.market_data_date,'deadline',i.deadline,'window_days',i.window_days,'market_model',i.market_model,
      'terms',jsonb_build_object('issuer',i.issuer,'rating',r.rating,'tenor',r.tenor_years,'bond_type',r.bond_type),
      'issue_size_yi',r.issue_size_billion_yuan,'waiting_cost_bp_day',i.waiting_cost_bp_day,
      'decision',jsonb_build_object('action',i.action,'reason',i.reason,'first_issuance_date',i.first_issuance_date,'lowest_expected_cost_date',i.lowest_expected_cost_date,
        'expected_net_saving_bp',i.expected_net_saving_bp,'annual_saving_wan',i.annual_saving_wan,'saving_probability',i.saving_probability,'saving_p10_bp',i.saving_p10_bp,'joint_error_pairs',i.joint_error_pairs),
      'forecast',COALESCE((SELECT jsonb_agg(to_jsonb(f)-'run_id'-'ordinal' ORDER BY ordinal) FROM financing_model.issuance_forecast f WHERE f.run_id=r.id),'[]'::jsonb),
      'market_forecast',COALESCE((SELECT jsonb_agg(to_jsonb(f)-'run_id'-'ordinal' ORDER BY ordinal) FROM financing_model.issuance_market_path f WHERE f.run_id=r.id),'[]'::jsonb),
      'explanation',CASE WHEN i.base_coupon_bp IS NULL THEN NULL ELSE jsonb_build_object('method','tree_path_dependent','unit','bp','base_coupon_bp',i.base_coupon_bp,'prediction_coupon_bp',i.prediction_coupon_bp,
        'market_anchor_bp',i.market_anchor_bp,'issuer_premium_bp',i.issuer_premium_bp,'horizon_drift_bp',i.horizon_drift_bp,'tree_expected_change_bp',i.tree_expected_change_bp,
        'features',COALESCE((SELECT jsonb_agg(to_jsonb(s)-'run_id'-'ordinal' ORDER BY ordinal) FROM financing_model.issuance_shap s WHERE s.run_id=r.id),'[]'::jsonb)) END,
      'validation',jsonb_build_object('sample_count',i.sample_count,'prediction_start',i.prediction_start,'prediction_end',i.prediction_end,
        'metrics',COALESCE((SELECT jsonb_agg(to_jsonb(v)-'run_id' ORDER BY lead_days,year) FROM financing_model.issuance_validation v WHERE v.run_id=r.id),'[]'::jsonb)),
      'base_conclusion',jsonb_build_object('verdict',r.base_conclusion_verdict,'preferred_window',r.base_conclusion_preferred_window,'narrative',r.base_conclusion_narrative)),
    'conclusion',jsonb_build_object('verdict',r.conclusion_verdict,'preferredWindow',r.conclusion_preferred_window,'narrative',r.conclusion_narrative,'edited',r.conclusion_updated_at IS NOT NULL,'updatedAt',r.conclusion_updated_at),
    'sellSide',(SELECT payload FROM financing_model.sell_side_snapshot s WHERE s.run_id=r.id ORDER BY generated_at DESC,id DESC LIMIT 1),
    'versions',(SELECT jsonb_agg(jsonb_build_object('runId',v.id,'asOfDate',v.as_of_date,'generatedAt',v.generated_at) ORDER BY v.as_of_date DESC) FROM
      (SELECT id,as_of_date,generated_at FROM financing_model.model_run WHERE schema_version=4 ORDER BY as_of_date DESC LIMIT 100) v)
    ) AS report FROM financing_model.model_run r JOIN financing_model.issuance_run i ON i.run_id=r.id
    WHERE r.schema_version=4 AND ($1::uuid IS NULL OR r.id=$1::uuid) ORDER BY r.as_of_date DESC LIMIT 1`,[runId]);
  if(!result.rows[0]) throw new FinancingModelDatabaseError(404,'尚无新版融资择时模型数据');
  return issuanceReportSchema.parse(result.rows[0].report);
}
