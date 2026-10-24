-- Permit the explicitly declared three-horizon prediction contract without
-- deriving an issuance action from a manually selected forecast minimum.
-- Existing archived contracts retain their original publication validation.
DO $migration$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('financing_model.publish_online_result(jsonb,text)'::regprocedure)
    INTO definition;
  IF strpos(definition, $$IF jsonb_array_length(payload->'forecast')>0 THEN$$)=0 THEN
    RAISE EXCEPTION 'Unexpected coupon decision validator; inspect prior migrations';
  END IF;
  definition := replace(definition,
    $$IF jsonb_array_length(payload->'forecast')>0 THEN$$,
    $replacement$IF payload #>> '{validation,release_policy}' = 'short_coupon_prediction' THEN
    IF payload #> '{validation,forecast_horizons}' IS DISTINCT FROM '[1,14,30]'::jsonb
      OR jsonb_array_length(payload->'forecast') <> 3
      OR (payload->>'window_days')::integer NOT BETWEEN 1 AND 30
      OR (SELECT jsonb_agg(f->'lead_days' ORDER BY n)
          FROM jsonb_array_elements(payload->'forecast') WITH ORDINALITY e(f,n))
         IS DISTINCT FROM '[1,14,30]'::jsonb
      OR action IS DISTINCT FROM '仅预测票面'
      OR payload #>> '{decision,reason}' IS DISTINCT FROM 'coupon_prediction_only'
      OR payload #>> '{decision,first_issuance_date}' IS NOT NULL
      OR payload #>> '{decision,lowest_expected_cost_date}' IS NOT NULL
      OR payload #> '{decision,low_rate_dates}' IS DISTINCT FROM '[]'::jsonb
      OR payload #> '{decision,low_rate_windows}' IS DISTINCT FROM '[]'::jsonb
      OR EXISTS (
        SELECT 1 FROM jsonb_each(payload->'decision') e(key,value)
        WHERE e.key IN ('expected_net_saving_bp','annual_saving_wan','saving_probability',
                      'saving_p10_bp','joint_error_pairs') AND e.value <> 'null'::jsonb)
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(payload->'forecast') f
        WHERE f->'waiting_cost_bp' IS DISTINCT FROM '0'::jsonb)
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(payload->'forecast') f,
          LATERAL jsonb_each(f) e(key,value)
        WHERE e.key IN ('expected_saving_bp','net_saving_bp','annual_saving_wan',
                      'saving_probability','saving_p10_bp','pair_samples') AND e.value <> 'null'::jsonb)
    THEN RAISE EXCEPTION 'Invalid short coupon prediction publication'; END IF;
  ELSIF jsonb_array_length(payload->'forecast')>0 THEN$replacement$);
  EXECUTE definition;
END;
$migration$;
