import { z } from "zod";

const nullableNumber = z.number().finite().nullable();

export const financingModelSnapshotSchema = z
  .object({
    schema_version: z.number().int().positive(),
    run_id: z.string().uuid(),
    model_name: z.string().min(1),
    generated_at: z.string().min(1),
    as_of_date: z.string().date(),
    market_data_date: z.string().date(),
    issue_terms: z
      .object({
        issue_size_billion_yuan: z.number().positive(),
        tenor_years: z.number().positive(),
        rating: z.string().min(1),
        bond_type: z.string().min(1),
      })
      .strict(),
    prediction: z
      .object({
        deviation_bp: z.number().finite(),
        peer_spread_median_bp: z.number().finite(),
        historical_percentile: z.number().min(0).max(100),
        recommendation: z.enum(["strong_buy", "neutral", "wait"]),
        recommendation_label: z.string().min(1),
        decision: z.string().min(1),
      })
      .strict(),
    company_metrics: z
      .object({
        date: z.string().date(),
        ef_lcr_pctile_60d: nullableNumber,
        ef_nsfr_pctile_60d: nullableNumber,
        ef_funding_gap: nullableNumber,
        ef_margin_zscore_60d: nullableNumber,
        ef_funding_pressure: nullableNumber,
        ef_subject_spread_bp: nullableNumber,
        ef_subject_spread_pctile: nullableNumber,
        ef_subject_spread_date: z.string().date().nullable(),
        composite_score: nullableNumber,
        readiness_label: z.string(),
        interpretation: z.string(),
      })
      .strict()
      .nullable(),
    market_drivers: z.array(
      z
        .object({
          feature: z.string().min(1),
          display_name: z.string().min(1),
          shap: z.number().finite(),
          value: z.number().finite(),
          direction: z.string().optional(),
          impact: z.enum(["推高成本", "降低成本"]),
        })
        .strict(),
    ),
    forecast_window: z.array(
      z
        .object({
          date: z.string().date(),
          weekday: z.string().min(1),
          percentile: z.number().min(0).max(100),
          label: z.string().min(1),
          pred_bp: z.number().finite(),
          savings_bp_vs_window_median: z.number().finite(),
          "savings_万元/年": z.number().finite(),
        })
        .strict(),
    ),
    validation: z
      .object({
        tscv: z
          .object({
            folds: z.number().int().positive(),
            validation_samples: z.number().int().nonnegative(),
            rmse: z.number().finite(),
            ic: z.number().finite(),
            best_iter_median: z.number().int().positive(),
            best_iters: z.array(z.number().int().positive()),
          })
          .strict(),
        timing_value: z
          .object({
            n_total: z.number().int().nonnegative(),
            n_recommended: z.number().int().nonnegative(),
            recommended_share: nullableNumber,
            cost_saving_bp: z.number().finite(),
            recommended_mean_bp: z.number().finite(),
            baseline_mean_bp: z.number().finite(),
            win_rate: z.number().min(0).max(1),
            ic: z.number().finite(),
            group_means: z.array(z.number().finite()),
            monotonic: z.boolean(),
          })
          .strict(),
      })
      .strict(),
    base_conclusion: z
      .object({
        verdict: z.string().min(1).max(120),
        preferred_window: z.string().max(160),
        narrative: z.string().min(1).max(4000),
        preferred_dates: z.array(z.string().date()),
      })
      .strict(),
    source_freshness: z
      .object({
        market_data_date: z.string().date(),
        company_metrics_date: z.string().date().nullable(),
        subject_spread_date: z.string().date().nullable(),
      })
      .strict(),
  })
  .strict();

export const conclusionSchema = z
  .object({
    verdict: z.string().trim().min(1).max(120),
    preferredWindow: z.string().trim().max(160),
    narrative: z.string().trim().min(1).max(4000),
    edited: z.boolean(),
    updatedAt: z.string().nullable(),
  })
  .strict();

export const conclusionUpdateSchema = z
  .object({
    runId: z.string().uuid(),
    verdict: z.string().trim().min(1).max(120),
    preferredWindow: z.string().trim().max(160),
    narrative: z.string().trim().min(1).max(4000),
  })
  .strict();

const sellSideViewSchema = z
  .object({
    institution: z.string().min(1).max(80),
    title: z.string().min(1).max(300),
    publishedAt: z.string().date(),
    stance: z.enum(["supports", "mixed", "challenges"]),
    summary: z.string().min(1).max(1200),
    implication: z.string().min(1).max(800),
    sourceKey: z.string().min(1).max(500),
  })
  .strict();

const sellSidePayloadSchemaV2 = z
  .object({
    generatedAt: z.string().min(1),
    periodStart: z.string().date(),
    periodEnd: z.string().date(),
    searchQuery: z.string().min(1),
    maxResults: z.literal(50),
    sourceDocuments: z.number().int().nonnegative(),
    modelName: z.string().min(1),
    logicSummary: z.string().trim().min(1).max(4000),
    edited: z.boolean().default(false),
    updatedAt: z.string().min(1).nullable().default(null),
    views: z.array(sellSideViewSchema).min(3).max(5),
  })
  .strict();

const legacySellSidePayloadSchema = z
  .object({
    generatedAt: z.string().min(1),
    periodStart: z.string().date(),
    periodEnd: z.string().date(),
    searchQuery: z.string().min(1),
    maxResults: z.literal(50),
    sourceDocuments: z.number().int().nonnegative(),
    modelName: z.string().min(1),
    crossValidation: z
      .object({
        alignment: z.enum(["supports", "mixed", "challenges"]),
        summary: z.string().min(1).max(1600),
        disagreements: z.array(z.string().min(1).max(500)).max(5),
      })
      .strict(),
    views: z.array(sellSideViewSchema).min(3).max(5),
  })
  .strict();

export const sellSidePayloadSchema = z
  .union([sellSidePayloadSchemaV2, legacySellSidePayloadSchema])
  .transform((payload) => {
    if ("logicSummary" in payload) return payload;
    return sellSidePayloadSchemaV2.parse({
      generatedAt: payload.generatedAt,
      periodStart: payload.periodStart,
      periodEnd: payload.periodEnd,
      searchQuery: payload.searchQuery,
      maxResults: payload.maxResults,
      sourceDocuments: payload.sourceDocuments,
      modelName: payload.modelName,
      logicSummary: mergeLegacySellSideSummary(
        payload.crossValidation.summary,
        payload.crossValidation.disagreements,
      ),
      edited: false,
      updatedAt: null,
      views: payload.views,
    });
  });

export const sellSideSummaryUpdateSchema = z
  .object({
    runId: z.string().uuid(),
    logicSummary: z.string().trim().min(1).max(4000),
  })
  .strict();

export const financingModelReportSchema = z
  .object({
    snapshot: financingModelSnapshotSchema,
    conclusion: conclusionSchema,
    sellSide: sellSidePayloadSchema.nullable(),
  })
  .strict();

export type FinancingModelSnapshot = z.infer<
  typeof financingModelSnapshotSchema
>;
export type FinancingModelConclusion = z.infer<typeof conclusionSchema>;
export type FinancingModelConclusionUpdate = z.infer<
  typeof conclusionUpdateSchema
>;
export type SellSidePayload = z.infer<typeof sellSidePayloadSchema>;
export type SellSideSummaryUpdate = z.infer<
  typeof sellSideSummaryUpdateSchema
>;
export type FinancingModelReport = z.infer<typeof financingModelReportSchema>;

export function parseFinancingModelReport(value: unknown): FinancingModelReport {
  return financingModelReportSchema.parse(value);
}

function mergeLegacySellSideSummary(
  summary: string,
  disagreements: string[],
): string {
  const fragments = [summary, ...disagreements]
    .map((fragment) =>
      fragment.trim().replace(/^[\s\-•]+/, "").replace(/[。；;]+$/, ""),
    )
    .filter(
      (fragment, index, values) =>
        fragment && values.indexOf(fragment) === index,
    );
  return `${fragments.join("；")}。`.slice(0, 4000);
}
