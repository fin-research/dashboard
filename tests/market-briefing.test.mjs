import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMarketBriefingPrompt,
  extractBriefingContent,
  filterMarketBriefingNews,
  generateMarketBriefing,
  MARKET_BRIEFING_SYSTEM,
} from "../src/lib/server/market-briefing.ts";

test("用户提示词与旧版后端 build_market_briefing_prompt 逐字一致", () => {
  const prompt = buildMarketBriefingPrompt("2026-08-10", "【1】正文");
  assert.equal(
    prompt,
    "请使用随附的 market-briefing skill，根据以下 2026-08-10 当天新闻撰写今日市场聚焦。" +
      "只使用给定材料，不额外搜索或补写无法验证的事实。" +
      "严格遵守 skill 的输出格式，最终只返回两条正文。\n\n【1】正文",
  );
});

test("过滤和截断今日聚焦新闻素材", () => {
  const filtered = filterMarketBriefingNews(
    [
      "【1】2026-08-18 08:00:00 DM债市要闻速览（8月18日）\n标签：债市\n正文：\n宏观事件\n\n地方债发行提速\n\n后续内容",
      "【2】2026-08-18 08:01:00 DM利率债午间速览\n标签：债市\n正文：\n资金面平稳\n\n现券方面，收益率下行\n\n后续内容",
      "【3】2026-08-18 08:02:00 A股早盘收盘\n标签：股市\n正文：\n不纳入",
      "【4】2026-08-18 08:03:00 DMI外币资金日评（8月17日）\n标签：其它\n正文：\n不纳入",
      "【5】2026-08-18 08:04:00 DMI离岸债日报0818\n标签：债市\n正文：\n不纳入",
      "【6】2026-08-18 08:05:00 保留新闻\n标签：宏观\n正文：\n保留正文",
    ].join("\n\n"),
  );

  assert.equal(
    filtered,
    [
      "【1】2026-08-18 08:00:00 DM债市要闻速览（8月18日）\n标签：债市\n正文：\n宏观事件",
      "【2】2026-08-18 08:01:00 DM利率债午间速览\n标签：债市\n正文：\n资金面平稳",
      "【3】2026-08-18 08:05:00 保留新闻\n标签：宏观\n正文：\n保留正文",
    ].join("\n\n"),
  );
});

test("系统提示完整包含 market-briefing skill 的输出规范", () => {
  assert.ok(
    MARKET_BRIEFING_SYSTEM.includes("固定输出 `1、[股市内容]` 和 `2、[债市内容]`"),
  );
  assert.match(MARKET_BRIEFING_SYSTEM, /每条以120—200字为宜/);
  assert.match(MARKET_BRIEFING_SYSTEM, /## 输出前自检/);
});

test("模型输出兼容 AI Gateway OpenAI 格式与 Workers AI 原生格式", () => {
  assert.equal(
    extractBriefingContent({
      choices: [{ message: { content: "1、股市结论。" } }],
    }),
    "1、股市结论。",
  );
  assert.equal(extractBriefingContent({ response: "2、债市结论。" }), "2、债市结论。");
  assert.equal(
    extractBriefingContent({
      choices: [{ message: { content: [{ type: "text", text: "分段结论" }] } }],
    }),
    "分段结论",
  );
  assert.equal(extractBriefingContent({ choices: [] }), "");
});

test("生成流程从后端取数并调用 dynamic/rag", async () => {
  const originalFetch = globalThis.fetch;
  const aiCalls = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://eastmoney.hasbai.xyz/data/market-briefing/news?date=2026-08-10");
    assert.equal(init?.method, "POST");
    return new Response(
      JSON.stringify({
        report_date: "2026-08-10",
        news_count: 2,
        news_text: "【1】股市收盘正文",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const env = {
    AI: {
      run: async (model, args, options) => {
        aiCalls.push({ model, args, options });
        return { choices: [{ message: { content: "1、股市结论。\n2、债市结论。" } }] };
      },
    },
    AI_GATEWAY_ID: "default",
    DATA_API_BASE_URL: "https://eastmoney.hasbai.xyz/data",
  };
  try {
    const result = await generateMarketBriefing(env, "2026-08-10");
    assert.deepEqual(result, {
      report_date: "2026-08-10",
      content: "1、股市结论。\n2、债市结论。",
      news_count: 2,
    });
    assert.equal(aiCalls[0].model, "dynamic/rag");
    assert.equal(aiCalls[0].args.reasoning_effort, "high");
    assert.equal(aiCalls[0].args.chat_template_kwargs.enable_thinking, true);
    assert.equal("max_completion_tokens" in aiCalls[0].args, false);
    assert.equal(aiCalls[0].options.gateway.id, "default");
    assert.equal(aiCalls[0].options.gateway.skipCache, true);
    assert.equal(aiCalls[0].options.gateway.requestTimeoutMs, 120_000);
    assert.match(aiCalls[0].args.messages[0].content, /^---\nname: market-briefing/);
    assert.match(
      aiCalls[0].args.messages[1].content,
      /根据以下 2026-08-10 当天新闻撰写今日市场聚焦/,
    );
    assert.match(aiCalls[0].args.messages[1].content, /【1】股市收盘正文/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
