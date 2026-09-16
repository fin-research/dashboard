function snapshot() {
  return {
    schema_version: 1,
    run_id: "78c6fba5-e7b0-4d0f-bc18-2c8968b8e447",
    model_name: "bond_financing_timing_lgbm",
    generated_at: "2026-08-24T02:00:00+00:00",
    as_of_date: "2026-08-24",
    market_data_date: "2026-08-21",
    issue_terms: {
      issue_size_billion_yuan: 30,
      tenor_years: 3,
      rating: "AAA",
      bond_type: "证券公司债",
    },
    prediction: {
      deviation_bp: 1.71,
      peer_spread_median_bp: 41.18,
      historical_percentile: 51,
      recommendation: "neutral",
      recommendation_label: "择机发行",
      window_zone: "中枢",
      decision: "推荐发行",
    },
    company_metrics: {
      date: "2026-08-21",
      ef_lcr: 5.832,
      ef_nsfr: 2.2347,
      ef_lcr_pctile_60d: 0.39,
      ef_nsfr_pctile_60d: 0.847,
      ef_funding_gap: -232.1,
      ef_margin_zscore_60d: 0,
      ef_funding_pressure: 1,
      ef_subject_spread_bp: 17.86,
      ef_subject_spread_pctile: 0.22,
      ef_subject_spread_date: "2026-08-21",
      composite_score: 0.6185,
      readiness_label: "宽裕",
      interpretation: "流动性充裕",
    },
    market_drivers: [
      {
        feature: "weighted_cost",
        display_name: "一级加权成本",
        shap: -0.3,
        value: 1.491,
        direction: "降低成本",
        impact: "降低成本",
      },
    ],
    driver_structure: [
      {
        category: "funding",
        display_name: "资金面",
        support_score: 62,
        support_bp: 0.3,
        importance_weight: 1,
      },
    ],
    product_recommendation: {
      recommended_product: "3Y 次级债",
      recommended_tenor_years: 3,
      recommended_bond_type: "证券公司次级债",
      scenarios: [
        ["3Y 公募债", 3, "证券公司债", 1.71, 2, false],
        ["5Y 公募债", 5, "证券公司债", 2.2, 4, false],
        ["3Y 次级债", 3, "证券公司次级债", -0.5, 1, true],
        ["5Y 次级债", 5, "证券公司次级债", 1.9, 3, false],
      ].map(([display_name, tenor_years, bond_type, pred_bp, rank, is_recommended]) => ({
        display_name,
        tenor_years,
        bond_type,
        pred_bp,
        peer_spread_median_bp: 41.18,
        historical_percentile: 51,
        recommendation: rank === 1 ? "strong_buy" : "neutral",
        recommendation_label: rank === 1 ? "建议发行" : "择机发行",
        rank,
        cost_vs_best_bp: pred_bp + 0.5,
        is_recommended,
      })),
    },
    forecast_window: [
      {
        date: "2026-08-24",
        weekday: "周一",
        percentile: 51,
        label: "尚可",
        pred_bp: 1.71,
        savings_bp_vs_window_median: -1.12,
        "savings_万元/年": -33.6,
      },
    ],
    validation: {
      tscv: {
        folds: 10,
        validation_samples: 100,
        sample_count: 2023,
        sample_start_date: "2022-01-01",
        sample_end_date: "2026-06-30",
        rmse: 8.4,
        mae: 6.2,
        ic: 0.22,
        best_iter_median: 80,
        best_iters: [80],
      },
      timing_value: {
        n_total: 100,
        n_recommended: 25,
        recommended_share: 0.25,
        cost_saving_bp: 2.1,
        recommended_mean_bp: -1,
        baseline_mean_bp: 1.1,
        win_rate: 0.6,
        ic: 0.22,
        group_means: [-1, 0, 1, 2],
        monotonic: true,
      },
    },
    base_conclusion: {
      verdict: "推荐发行",
      preferred_window: "8月24日",
      narrative: "基础结论",
      preferred_dates: ["2026-08-24"],
    },
    source_freshness: {
      market_data_date: "2026-08-21",
      company_metrics_date: "2026-08-21",
      subject_spread_date: "2026-08-21",
    },
  };
}

function sellSidePayload() {
  return {
    generatedAt: "2026-08-24T03:00:00.000Z",
    periodStart: "2026-08-18",
    periodEnd: "2026-08-24",
    searchQuery: "债券市场",
    maxResults: 50,
    sourceDocuments: 8,
    modelName: "gpt-5.6-luna",
    logicSummary: "资金面判断总体一致，但长端利率方向仍存在分歧。",
    edited: false,
    updatedAt: null,
    views: ["兴业固收", "天风固收", "华源固收", "中信固收"].map((institution, index) => ({
      institution,
      title: `${institution}周报`,
      publishedAt: "2026-08-24",
      stance: index === 2 ? "challenges" : "supports",
      summary: "资金面保持平稳。",
      implication: "发行窗口仍可关注。",
      sourceKey: `2026-08-24/${institution}.md`,
    })),
  };
}

function versions() {
  return [
    {
      runId: snapshot().run_id,
      asOfDate: snapshot().as_of_date,
      generatedAt: snapshot().generated_at,
    },
  ];
}

export const financingModel = { snapshot: snapshot(), sellSide: sellSidePayload(), versions: versions(), conclusion: {verdict:'推荐发行', preferredWindow:'8月24日', narrative:'基础结论', edited:false, updatedAt:null} };
