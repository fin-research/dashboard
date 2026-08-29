import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  companyBusinessNarrative,
  parseFinancingModelReport,
  sellSideSummaryBody,
} from "../src/lib/financing-model.ts";
import { resolveInstitutionLogo } from "../src/lib/sell-side-institutions.ts";
import {
  loadFinancingModelReport,
  saveFinancingModelConclusion,
  saveSellSideSnapshot,
  saveSellSideSummaryRevision,
} from "../src/lib/server/financing-model-repository.ts";
import {
  aiSearchPeriod,
  buildAiSearchToolCall,
  parseAiSearchResponse,
} from "../src/lib/server/financing-model-research.ts";

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
      recommendation_label: "尚可",
      decision: "推荐发行",
    },
    company_metrics: {
      date: "2026-08-21",
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
        rmse: 8.4,
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

test("融资择时报告契约接受模型、人工结论和卖方观点", () => {
  const report = parseFinancingModelReport({
    snapshot: snapshot(),
    conclusion: {
      verdict: "抓住窗口发行",
      preferredWindow: "8月24日前后",
      narrative: "人工修订结论",
      edited: true,
      updatedAt: "2026-08-24T03:10:00.000Z",
    },
    sellSide: sellSidePayload(),
  });

  assert.equal(report.snapshot.prediction.deviation_bp, 1.71);
  assert.equal(report.conclusion.edited, true);
  assert.equal(report.sellSide.views.length, 4);
  assert.match(report.sellSide.logicSummary, /长端利率方向/);
});

test("公司业务指标结论包含三个状态分句和发行节奏建议", () => {
  const narrative = companyBusinessNarrative(snapshot().company_metrics);

  assert.equal(
    narrative,
    "流动性整体宽裕；资金缺口较大；主体利差处于相对低位；公司融资需求较为迫切，建议尽快完成发行。",
  );
  assert.doesNotMatch(narrative, /\d/);

  const unhurried = companyBusinessNarrative({
    ...snapshot().company_metrics,
    ef_funding_gap: 60,
  });
  assert.match(unhurried, /资金缺口较小/);
  assert.match(unhurried, /公司融资需求暂不迫切，建议等待成本较优窗口择机完成发行/);

  const moderate = companyBusinessNarrative({
    ...snapshot().company_metrics,
    readiness_label: "适中",
    ef_funding_gap: -50,
  });
  assert.match(moderate, /资金缺口适中/);
  assert.match(moderate, /公司融资需求总体适中，建议结合市场窗口择机完成发行/);
});

test("卖方观点正文移除机构研报和发布日期引导句", () => {
  const summary =
    "德邦资管固收在《德邦资管固收投资周报0817-0821： 债市大概率以震荡整固为主， 警惕税期和政府债缴款对于资金面扰动和长端利率风险》（2026-08-24）指出。资金面均衡偏松格局未变。";

  assert.equal(
    sellSideSummaryBody(summary, "德邦资管固收"),
    "资金面均衡偏松格局未变。",
  );
  assert.equal(
    sellSideSummaryBody("资金面保持平稳。", "兴业固收"),
    "资金面保持平稳。",
  );
});

test("券商研究所 Logo 库按别名匹配官网图片且不伪造回退标识", () => {
  assert.equal(
    resolveInstitutionLogo("德邦资管固收")?.src,
    "/institution-logos/tebon.png",
  );
  assert.equal(
    resolveInstitutionLogo("国联民生证券")?.src,
    "/institution-logos/glms.png",
  );
  assert.equal(resolveInstitutionLogo("示例研究所"), null);
});

test("当前卖方机构 Logo 均为本地 PNG 图片", async () => {
  const files = ["tebon.png", "cms.png", "glms.png", "swhy.png", "xyzq.png"];
  for (const file of files) {
    const asset = await readFile(
      new URL(`../static/institution-logos/${file}`, import.meta.url),
    );
    assert.ok(asset.length > 1_000, `${file} 应包含实际图片数据`);
    assert.equal(asset.subarray(1, 4).toString("ascii"), "PNG");
  }
});

test("历史卖方交叉验证快照读取时整合为单段逻辑汇总", () => {
  const legacy = sellSidePayload();
  delete legacy.logicSummary;
  delete legacy.edited;
  delete legacy.updatedAt;
  legacy.views = legacy.views.slice(0, 3);
  legacy.crossValidation = {
    alignment: "mixed",
    summary: "资金面总体偏松。",
    disagreements: ["信用债一级成本仍在上行。"],
  };

  const report = parseFinancingModelReport({
    snapshot: snapshot(),
    conclusion: {
      verdict: "推荐发行",
      preferredWindow: "8月24日",
      narrative: "基础结论",
      edited: false,
      updatedAt: null,
    },
    sellSide: legacy,
  });

  assert.equal(
    report.sellSide.logicSummary,
    "资金面总体偏松；信用债一级成本仍在上行。",
  );
  assert.equal(report.sellSide.edited, false);
});

test("读取时使用 model_run 当前结论并保留基础结论", async () => {
  const client = {
    async query(sql, parameters) {
      assert.match(sql, /financing_model\.model_run/);
      assert.deepEqual(parameters, [null]);
      return {
        rows: [
          {
            snapshot: snapshot(),
            verdict: "推荐发行",
            preferred_window: "8月24日",
            narrative: "基础结论",
            conclusion_updated_at: null,
            sell_side_payload: null,
          },
        ],
      };
    },
  };

  const report = await loadFinancingModelReport(client);

  assert.equal(report.conclusion.verdict, "推荐发行");
  assert.equal(report.conclusion.edited, false);
  assert.equal(report.sellSide, null);
});

test("整体结论 PATCH 增量更新 model_run 当前结论", async () => {
  const calls = [];
  const client = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      return {
        rows: [
          {
            verdict: "等待",
            preferred_window: "8月末",
            narrative: "等待更优窗口。",
            updated_at: "2026-08-24T04:00:00.000Z",
          },
        ],
      };
    },
  };

  const result = await saveFinancingModelConclusion(client, {
    runId: snapshot().run_id,
    verdict: "等待",
    preferredWindow: "8月末",
    narrative: "等待更优窗口。",
  });

  assert.match(calls[0].sql, /UPDATE financing_model\.model_run/);
  assert.match(calls[0].sql, /conclusion_updated_at = now\(\)/);
  assert.doesNotMatch(calls[0].sql, /conclusion_revision|INSERT INTO/);
  assert.equal(calls[0].parameters[0], snapshot().run_id);
  assert.equal(result.edited, true);
});

test("model_run migration 完整拆分 payload 并合并整体结论", async () => {
  const migration = await readFile(
    new URL(
      "../financing-model-migrations/0002_structure_model_run.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /CREATE TABLE financing_model\.model_run_market_driver/);
  assert.match(migration, /CREATE TABLE financing_model\.model_run_forecast_window/);
  assert.match(migration, /base_conclusion_preferred_dates date\[\]/);
  assert.match(migration, /timing_group_means numeric\(20, 10\)\[\]/);
  assert.match(migration, /DROP TABLE financing_model\.conclusion_revision/);
  assert.match(migration, /DROP COLUMN payload/);
});

test("卖方观点快照保存搜索口径和完整 payload", async () => {
  const calls = [];
  const client = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      return { rows: [] };
    },
  };

  await saveSellSideSnapshot(client, snapshot(), sellSidePayload());

  assert.match(calls[0].sql, /sell_side_snapshot/);
  assert.equal(calls[0].parameters[1], snapshot().run_id);
  assert.match(calls[0].parameters[6], /"maxResults":50/);
});

test("卖方逻辑汇总编辑采用追加快照并保留检索证据", async () => {
  const calls = [];
  const client = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      return { rows: [] };
    },
  };
  const updatedAt = "2026-08-24T04:30:00.000Z";

  const revised = await saveSellSideSummaryRevision(
    client,
    snapshot(),
    sellSidePayload(),
    {
      runId: snapshot().run_id,
      logicSummary: "资金面偏松有利于发行，但信用一级成本仍有刚性。",
    },
    updatedAt,
  );

  assert.match(calls[0].sql, /sell_side_snapshot/);
  assert.equal(calls[0].parameters[7], updatedAt);
  assert.match(calls[0].parameters[6], /资金面偏松有利于发行/);
  assert.match(calls[0].parameters[6], /兴业固收/);
  assert.equal(revised.edited, true);
  assert.equal(revised.updatedAt, updatedAt);
});

test("融资模型页面只列示市场驱动 Top 5 并收敛结论与卖方模块", async () => {
  const [page, research] = await Promise.all([
    readFile(
      new URL("../src/lib/pages/FinancingModelPage.svelte", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/lib/server/financing-model-research.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(page, /market_drivers\.slice\(0, 5\)/);
  assert.match(page, /aria-label="市场驱动因子 Top 5"/);
  assert.match(page, /aria-label="编辑整体结论"/);
  assert.match(page, /aria-label="编辑卖方逻辑汇总"/);
  assert.match(page, /report\.sellSide\.logicSummary/);
  assert.match(page, /class=\{`sell-side-grid sell-side-grid--\$\{/);
  assert.match(page, /report\.sellSide\.views as view/);
  assert.match(page, /companyBusinessNarrative\(company\)/);
  assert.match(page, /<ol class="market-driver-list" aria-label="公司业务指标">/);
  assert.match(page, /LCR六十日分位/);
  assert.match(page, /NSFR六十日分位/);
  assert.match(page, /company\.ef_funding_gap/);
  assert.match(page, /company\.ef_subject_spread_bp/);
  assert.match(
    page,
    /\.sell-side-grid\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:/,
  );
  assert.match(page, /grid-template-rows:\s*subgrid/);
  assert.match(page, /\.implication\s*\{[\s\S]*?align-content:\s*start;/);
  assert.doesNotMatch(page, /max-width:\s*1100px|margin-top:\s*auto/);
  assert.match(page, /sellSideSummaryBody\(view\.summary, view\.institution\)/);
  assert.doesNotMatch(page, /近30日可比债中位利差|发行方案/);
  assert.doesNotMatch(page, /相对更优窗口|class="recommendation-band"/);
  assert.doesNotMatch(page, /id="driver-title"|交叉验证/);
  assert.doesNotMatch(page, /<h3>卖方逻辑汇总<\/h3>/);
  assert.doesNotMatch(page, /<h3>\{view\.title\}<\/h3>/);
  assert.doesNotMatch(page, /<time datetime=\{view\.publishedAt\}>/);
  assert.doesNotMatch(page, /class="research-meta"|class="source-footer"/);
  assert.doesNotMatch(page, /company\.interpretation|指标日期|<dt>公司流动性/);
  assert.doesNotMatch(page, /stanceLabel|sell-side-card--/);
  assert.match(page, /<InstitutionLogo institution=\{view\.institution\}/);
  assert.doesNotMatch(page, />人工修订</);
  assert.match(research, /PROMPT_CACHE_KEY = "financing-model-sell-side:v6"/);
  assert.match(research, /\.min\(4\)/);
  assert.match(research, /views\.length < 4/);
  assert.match(research, /筛选4至5家/);
  assert.match(research, /不得重复机构名、研报标题、发布日期/);
  assert.match(research, /必须完全删除/);
  assert.doesNotMatch(research, /每家机构的 stance/);
});

test("AI Search 固定检索最近七个上海自然日且最多返回50条", () => {
  const period = aiSearchPeriod("2026-08-24");
  const call = buildAiSearchToolCall("债券市场", period);
  const retrieval = call.params.arguments.ai_search_options.retrieval;

  assert.equal(period.startDate, "2026-08-18");
  assert.equal(period.endDate, "2026-08-24");
  assert.equal(period.startMs, Date.parse("2026-08-18T00:00:00+08:00"));
  assert.equal(period.endMs, Date.parse("2026-08-24T23:59:59.999+08:00"));
  assert.equal(retrieval.max_num_results, 50);
  assert.deepEqual(retrieval.filters.published_at, {
    $gte: period.startMs,
    $lte: period.endMs,
  });
});

test("AI Search MCP SSE 响应按文章去重并保留机构元数据", () => {
  const chunks = [
    chunk("兴业固收", "兴业周报", "第一段"),
    chunk("兴业固收", "兴业周报", "第二段"),
    chunk("天风固收", "天风周报", "第三段"),
  ];
  const nested = JSON.stringify({ success: true, result: { chunks } });
  const envelope = JSON.stringify({
    result: { content: [{ type: "text", text: nested }] },
  });
  const documents = parseAiSearchResponse(`event: message\ndata: ${envelope}\n\n`);

  assert.equal(documents.length, 2);
  assert.equal(documents[0].institution, "兴业固收");
  assert.equal(documents[0].publishedAt, "2026-08-24");
  assert.match(documents[0].text, /第一段/);
  assert.match(documents[0].text, /第二段/);
});

function chunk(source, title, text) {
  return {
    text: `# ${title}\n\n${text}`,
    item: {
      key: `2026-08-24/${title}.md`,
      metadata: {
        source,
        published_at: Date.parse("2026-08-24T10:00:00+08:00"),
      },
    },
  };
}
