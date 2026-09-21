import { z } from 'zod';
import { conclusionSchema, financingModelVersionSchema, sellSidePayloadSchema } from './financing-model';
const number = z.number().finite();
const nullable = number.nullable();
export const issuanceForecastSchema = z.object({
  date:z.string().date(), lead_days:z.number().int().min(0).max(30), coupon_percent:nullable,
  coupon_low_percent:nullable, coupon_high_percent:nullable, market_level_percent:number,
  net_saving_bp:nullable, expected_saving_bp:nullable, waiting_cost_bp:nullable, annual_saving_wan:nullable,
  saving_probability:number.min(0).max(1).nullable(), saving_p10_bp:nullable, pair_samples:z.number().int().nullable(), interval_samples:z.number().int(),
  own_observations:z.number().int(), peer_observations:z.number().int(), issuer_premium_bp:nullable,
});
export const issuanceSnapshotSchema = z.object({
  schema_version:z.literal('issuance-forecast-v1'),run_id:z.string().uuid(),generated_at:z.string(),as_of_date:z.string().date(),
  market_source_date:z.string().date(),deadline:z.string().date(),window_days:z.number().int().min(1).max(30),market_model:z.literal('lgb_anchor_drift'),
  terms:z.object({issuer:z.string(),rating:z.string(),tenor:number.positive(),bond_type:z.string()}),issue_size_yi:number.positive(),waiting_cost_bp_day:number.nonnegative(),
  decision:z.object({action:z.string(),reason:z.string(),first_issuance_date:z.string().date().nullable(),lowest_expected_cost_date:z.string().date().nullable(),
    expected_net_saving_bp:nullable,annual_saving_wan:nullable,saving_probability:number.min(0).max(1).nullable(),saving_p10_bp:nullable,joint_error_pairs:z.number().int().nullable()}),
  forecast:z.array(issuanceForecastSchema),market_forecast:z.array(z.object({date:z.string().date(),market_level_percent:number,quote_day:z.boolean(),issuance_day:z.boolean(),value_date:z.string().date(),status:z.string()})),
  explanation:z.object({method:z.literal('tree_path_dependent'),unit:z.literal('bp'),base_coupon_bp:number,prediction_coupon_bp:number,market_anchor_bp:number,issuer_premium_bp:number,horizon_drift_bp:number,tree_expected_change_bp:number,
    features:z.array(z.object({feature:z.string(),value:nullable,shap_bp:number}))}).nullable(),
  validation:z.object({sample_count:z.number().int(),prediction_start:z.string().date(),prediction_end:z.string().date(),
    metrics:z.array(z.object({lead_days:z.number().int(),year:z.number().int(),samples:z.number().int(),mae_bp:number,rmse_bp:number,flat_market_mae_bp:number}))}),
  base_conclusion:z.object({verdict:z.string(),preferred_window:z.string(),narrative:z.string()}),
});
export const issuanceReportSchema=z.object({snapshot:issuanceSnapshotSchema,conclusion:conclusionSchema,sellSide:sellSidePayloadSchema.nullable(),versions:z.array(financingModelVersionSchema)});
export type IssuanceSnapshot=z.infer<typeof issuanceSnapshotSchema>;
export type IssuanceReport=z.infer<typeof issuanceReportSchema>;
export const parseIssuanceReport=(value:unknown):IssuanceReport=>issuanceReportSchema.parse(value);
