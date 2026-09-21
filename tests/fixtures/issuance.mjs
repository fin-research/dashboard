export function issuanceSnapshot() {
  const asOf='2026-08-24', add=d=>new Date(Date.parse(asOf)+d*86400000).toISOString().slice(0,10);
  const terms={issuer:'测试证券股份有限公司',rating:'AAA',tenor:3,bond_type:'证券公司债'};
  const forecast=[0,1,2,3,4,7,8,9,10].map(h=>({date:add(h),as_of:asOf,...terms,lead_days:h,forecast_origin:asOf,effective_horizon:h,
    market_change_bp:-h*.3,market_level_percent:1.75-h*.003,market_volatility_bp:1.2,market_source_date:'2026-08-21',market_train_label_end:'2026-08-20',market_training_samples:1000,
    issuer_premium_bp:10,coupon_percent:1.85-h*.003,own_observations:9,peer_observations:80,primary_history_latest_date:'2026-08-20',status:'estimated',
    coupon_low_percent:1.7-h*.004,coupon_high_percent:2-h*.002,interval_samples:80,calibration_latest_label:'2026-08-20',
    expected_saving_bp:h*.3,waiting_cost_bp:0,net_saving_bp:h*.3,annual_saving_wan:h*9,saving_probability:h?.7:null,saving_p10_bp:h?-8:null,pair_samples:h?23:0}));
  return {schema_version:'issuance-forecast-v1',run_id:'78c6fba5-e7b0-4d0f-bc18-2c8968b8e447',generated_at:'2026-08-24T02:00:00Z',as_of_date:asOf,market_source_date:'2026-08-21',deadline:add(10),window_days:10,market_model:'lgb_anchor_drift',terms,issue_size_yi:30,waiting_cost_bp_day:0,
    decision:{action:'可按资金计划发行',reason:'no_reliable_waiting_advantage',first_issuance_date:asOf,lowest_expected_cost_date:add(10),expected_net_saving_bp:3,annual_saving_wan:90,saving_probability:.7,saving_p10_bp:-8,joint_error_pairs:23,scope:'funding-cost comparison',validation_status:'2026 previously observed research reference'},
    forecast,market_forecast:Array.from({length:11},(_,h)=>({date:add(h),market_level_percent:1.75-h*.003,quote_day:![5,6].includes(h),issuance_day:![5,6].includes(h),value_date:add(h),status:'forecast'})),
    explanation:{method:'tree_path_dependent',unit:'bp',base_coupon_bp:184.8,prediction_coupon_bp:185,market_anchor_bp:175,issuer_premium_bp:10,horizon_drift_bp:0,tree_expected_change_bp:-.2,
      features:[{feature:'dr007',value:1.7,shap_bp:-.3},{feature:'credit_spread',value:.3,shap_bp:.5}]},
    validation:{sample_count:1000,prediction_start:'2022-01-04',prediction_end:'2026-08-20',metrics:[0,30].map(h=>({lead_days:h,year:2026,samples:80,mae_bp:h?7:5.6,rmse_bp:8,flat_market_mae_bp:8.2,mae_skill_vs_flat_market:.1}))},
    calendar_audit:{calendar:{year:2026,issuance_source:'https://www.sse.com.cn/'}},
    base_conclusion:{verdict:'可按资金计划发行',preferred_window:add(10),narrative:'预期节约有限，按资金计划发行。'}};
}
