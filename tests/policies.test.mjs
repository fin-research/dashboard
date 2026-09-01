import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  articleAssociationUpdateSchema,
  commentaryContentSchema,
  policyCategoryLabels,
} from "../src/lib/policies.ts";
import {
  loadPolicyTimeline,
  saveGeneratedCommentary,
} from "../src/lib/server/policy-repository.ts";

test("政策点评标准化字段通过运行时 Schema 校验", () => {
  const parsed = commentaryContentSchema.parse({
    eventName: "房地产信贷管理新政",
    sources: "中国人民银行、国家金融监督管理总局",
    eventPublishedAt: "2026-09-01",
    commentaryDate: "2026-09-01",
    eventSummary: "房地产信贷管理制度完成系统性调整，贷款品种、期限与开发融资规则同步更新。",
    commentary: "1. 信贷管理框架系统调整\n政策从个人住房贷款和开发贷款两端同步完善规则。",
    recommendation: "建议结合政策落地和地产信用利差变化，动态评估相关主体融资窗口。",
  });

  assert.equal(parsed.eventPublishedAt, "2026-09-01");
  assert.throws(
    () => commentaryContentSchema.parse({ ...parsed, commentary: "太短" }),
    /too small/i,
  );
  assert.deepEqual(articleAssociationUpdateSchema.parse({ articleIds: ["A1", "A2"] }), {
    articleIds: ["A1", "A2"],
  });
  assert.equal(policyCategoryLabels.real_estate, "房地产");
});

test("政策时间轴一次装配政策资讯、自动研报关系与一对一点评", async () => {
  const database = fakePolicyDatabase();
  const policies = await loadPolicyTimeline(database);

  assert.equal(policies.length, 1);
  assert.deepEqual(policies[0].departments, ["中国人民银行", "国家金融监督管理总局"]);
  assert.equal(policies[0].news.length, 2);
  assert.equal(policies[0].articles[0].associationMethod, "ai");
  assert.equal(policies[0].articles[0].confidence, "high");
  assert.equal(policies[0].commentary.type, "policy_tracking");
});

test("政策页面只手动生成点评，政策与研报聚合由后台 Workflow 提供", async () => {
  const [page, migration] = await Promise.all([
    readFile(new URL("../src/routes/policy-tracking/+page.svelte", import.meta.url), "utf8"),
    readFile(new URL("../migrations/1004_create_policy_tracking.sql", import.meta.url), "utf8"),
  ]);

  assert.match(page, /AI 生成点评初版/);
  assert.match(page, />调整关联</);
  assert.doesNotMatch(page, /\/api\/policies\/aggregate/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS policy_event/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS policy_news/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS policy_article/);
  assert.match(migration, /association_method IN \('ai', 'manual'\)/);
  assert.match(migration, /policy_id TEXT UNIQUE/);
});

test("AI 点评保存时模型、Prompt 版本和生成时间绑定到正确列", async () => {
  let insertBindings = [];
  const content = commentaryContentSchema.parse({
    eventName: "房地产信贷管理新政",
    sources: "中国人民银行、国家金融监督管理总局",
    eventPublishedAt: "2026-09-01",
    commentaryDate: "2026-09-01",
    eventSummary: "房地产信贷管理制度完成系统性调整，贷款品种、期限与开发融资规则同步更新。",
    commentary: "1. 信贷管理框架系统调整\n政策从个人住房贷款和开发贷款两端同步完善规则。",
    recommendation: "建议结合政策落地和地产信用利差变化，动态评估相关主体融资窗口。",
  });
  const database = {
    prepare(sql) {
      return {
        bindings: [],
        bind(...values) {
          this.bindings = values;
          return this;
        },
        async first() {
          if (/FROM policy_event/.test(sql)) {
            return {
              id: "P1", title: content.eventName, summary: "摘要", category: "real_estate",
              departments_json: "[]", policy_date: "2026-09-01",
              first_news_at: "2026-09-01T19:00:00+08:00",
              last_news_at: "2026-09-01T19:10:00+08:00", updated_at: "2026-09-01T12:00:00Z",
            };
          }
          if (/SELECT id, created_at/.test(sql)) return null;
          if (/FROM research_commentary/.test(sql)) {
            return {
              id: "C1", policy_id: "P1", commentary_type: "policy_tracking",
              event_name: content.eventName, sources: content.sources,
              event_published_at: content.eventPublishedAt,
              commentary_date: content.commentaryDate,
              event_summary: content.eventSummary, commentary: content.commentary,
              recommendation: content.recommendation, model: "gpt-5.6-luna",
              prompt_version: "policy-commentary-v1", generated_at: "2026-09-01T12:00:00Z",
              edited: 0, updated_at: "2026-09-01T12:00:00Z",
            };
          }
          throw new Error(`unexpected first SQL: ${sql}`);
        },
        async run() {
          insertBindings = this.bindings;
        },
      };
    },
  };

  await saveGeneratedCommentary(database, "P1", content, {
    model: "gpt-5.6-luna",
    promptVersion: "policy-commentary-v1",
    generatedAt: "2026-09-01T12:00:00Z",
  });

  assert.equal(insertBindings.length, 14);
  assert.equal(insertBindings[9], "gpt-5.6-luna");
  assert.equal(insertBindings[10], "policy-commentary-v1");
  assert.equal(insertBindings[11], "2026-09-01T12:00:00Z");
});

function fakePolicyDatabase() {
  return {
    prepare(sql) {
      return {
        bind() {
          return this;
        },
        async all() {
          if (/FROM policy_event/.test(sql)) {
            return { results: [{
              id: "P1",
              title: "房地产信贷管理新政",
              summary: "政策摘要",
              category: "real_estate",
              departments_json: JSON.stringify(["中国人民银行", "国家金融监督管理总局"]),
              policy_date: "2026-09-01",
              first_news_at: "2026-09-01T19:00:00+08:00",
              last_news_at: "2026-09-01T19:25:00+08:00",
              updated_at: "2026-09-01T11:30:00Z",
            }] };
          }
          if (/FROM policy_news/.test(sql)) {
            return { results: [
              { sentiment_id: "N1", policy_id: "P1", news_id: null, title: "新政发布", published_at: "2026-09-01T19:00:00+08:00", link: null },
              { sentiment_id: "N2", policy_id: "P1", news_id: null, title: "答记者问", published_at: "2026-09-01T19:25:00+08:00", link: null },
            ] };
          }
          if (/FROM policy_article/.test(sql)) {
            return { results: [{
              policy_id: "P1",
              id: "A1",
              title: "房地产新政点评",
              author: "东财证券",
              summary: "研报摘要",
              published_at: "2026-09-01T20:00:00+08:00",
              link: null,
              association_method: "ai",
              confidence: "high",
              rationale: "标题明确解读该政策",
            }] };
          }
          if (/FROM research_commentary/.test(sql)) {
            return { results: [{
              id: "C1",
              policy_id: "P1",
              commentary_type: "policy_tracking",
              event_name: "房地产信贷管理新政",
              sources: "中国人民银行、国家金融监督管理总局",
              event_published_at: "2026-09-01",
              commentary_date: "2026-09-01",
              event_summary: "事件摘要",
              commentary: "政策点评",
              recommendation: "应对建议",
              model: "gpt-5.6-luna",
              prompt_version: "policy-commentary-v1",
              generated_at: "2026-09-01T12:00:00Z",
              edited: 0,
              updated_at: "2026-09-01T12:00:00Z",
            }] };
          }
          throw new Error(`unexpected SQL: ${sql}`);
        },
      };
    },
  };
}
