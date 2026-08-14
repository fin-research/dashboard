import assert from "node:assert/strict";
import test from "node:test";

import { parseHotspotAnalysis } from "../src/lib/hotspots.ts";

function hotspot(overrides = {}) {
  return {
    keyword: "OMO零投放",
    aliases: ["逆回购零操作"],
    explanation: "央行公开市场操作变化影响短端资金预期，并通过收益率曲线传导至利率债；后续操作量恢复将成为验证条件。",
    drivers: ["公开市场操作"],
    conflicts: [],
    scoreComponents: {
      marketImpact: 95,
      freshness: 90,
      evidenceCredibility: 80,
      crossAssetRelevance: 70,
    },
    assetImpacts: {
      fixedIncome: "短端收益率存在上行压力",
      equities: "证据不足",
    },
    evidence: [{ articleId: "A001", evidence: "央行当日未开展逆回购投放。" }],
    confidence: "high",
    ...overrides,
  };
}

test("单篇证据热点按评分公式计算并强制封顶热度与置信度", () => {
  const result = parseHotspotAnalysis(
    JSON.stringify({
      date: "2026-08-14",
      marketSummary: "当日资金操作成为主要定价线索。",
      hotspots: Array.from({ length: 8 }, (_, index) =>
        hotspot({
          keyword: `热点${index + 1}`,
          scoreComponents: {
            marketImpact: 100 - index,
            freshness: 100 - index,
            evidenceCredibility: 100 - index,
            crossAssetRelevance: 100 - index,
          },
        }),
      ),
      relationships: [],
      watchItems: ["后续逆回购操作量"],
      coverage: { analyzedArticleIds: ["wrong"], articleCount: 99 },
    }),
    { date: "2026-08-14", articleIds: ["A001"] },
  );

  assert.equal(result.hotspots[0].heat, 60);
  assert.equal(result.hotspots[0].confidence, "medium");
  assert.equal(result.hotspots[0].sourceLabel, "单一来源");
  assert.equal(result.hotspots[0].score.sourceCoverage, 100);
  assert.equal(result.hotspots[0].score.total, 100);
  assert.deepEqual(result.coverage, {
    analyzedArticleIds: ["A001"],
    articleCount: 1,
  });
});

test("证据去重且只保留最终关键词之间的关系", () => {
  const result = parseHotspotAnalysis(
    JSON.stringify({
      date: "2026-08-14",
      marketSummary: "资金与汇率共同影响跨资产定价。",
      hotspots: [
        hotspot({
          evidence: [
            { articleId: "A001", evidence: "证据一" },
            { articleId: "A001", evidence: "重复证据" },
            { articleId: "A002", evidence: "证据二" },
          ],
        }),
        hotspot({
          keyword: "美元兑日元",
          scoreComponents: {
            marketImpact: 70,
            freshness: 75,
            evidenceCredibility: 65,
            crossAssetRelevance: 90,
          },
          evidence: [{ articleId: "A002", evidence: "美元兑日元下行。" }],
        }),
        ...Array.from({ length: 6 }, (_, index) =>
          hotspot({
            keyword: `补充热点${index + 1}`,
            scoreComponents: {
              marketImpact: 50 - index,
              freshness: 50 - index,
              evidenceCredibility: 50 - index,
              crossAssetRelevance: 50 - index,
            },
          }),
        ),
      ],
      relationships: [
        { source: "OMO零投放", target: "美元兑日元", explanation: "跨资产传导" },
        { source: "OMO零投放", target: "不存在", explanation: "无效端点" },
      ],
      watchItems: [],
      coverage: { analyzedArticleIds: [], articleCount: 0 },
    }),
    { date: "2026-08-14", articleIds: ["A001", "A002"] },
  );

  assert.equal(result.hotspots[0].evidence.length, 2);
  assert.equal(result.hotspots[0].sourceLabel, "多来源");
  assert.equal(result.relationships.length, 1);
  assert.equal(result.relationships[0].target, "美元兑日元");
});

test("热点得分使用固定权重且最多保留十五条", () => {
  const result = parseHotspotAnalysis(
    JSON.stringify({
      marketSummary: "评分由来源覆盖、市场影响、新鲜度、证据可信度和跨资产关联度共同决定。",
      hotspots: Array.from({ length: 16 }, (_, index) =>
        hotspot({
          keyword: `评分热点${index + 1}`,
          evidence: [
            { articleId: "A001", evidence: "证据一" },
            { articleId: "A002", evidence: "证据二" },
          ],
          scoreComponents: {
            marketImpact: 80 - index,
            freshness: 70,
            evidenceCredibility: 60,
            crossAssetRelevance: 50,
          },
        }),
      ),
      relationships: [],
      watchItems: [],
    }),
    { date: "2026-08-14", articleIds: ["A001", "A002", "A003", "A004"] },
  );

  assert.equal(result.hotspots.length, 15);
  assert.deepEqual(result.hotspots[0].score, {
    sourceCoverage: 50,
    marketImpact: 80,
    freshness: 70,
    evidenceCredibility: 60,
    crossAssetRelevance: 50,
    total: 63,
  });
  assert.equal(result.hotspots[0].heat, 63);
});

test("缓存中的派生 score 可重新校验并计算", () => {
  const context = { date: "2026-08-14", articleIds: ["A001"] };
  const first = parseHotspotAnalysis(
    JSON.stringify({
      marketSummary: "缓存复用仍须经过同一运行时校验。",
      hotspots: Array.from({ length: 8 }, (_, index) =>
        hotspot({ keyword: `缓存热点${index + 1}` }),
      ),
      relationships: [],
      watchItems: [],
    }),
    context,
  );
  const cached = parseHotspotAnalysis(JSON.stringify(first), context);

  assert.deepEqual(cached, first);
});
