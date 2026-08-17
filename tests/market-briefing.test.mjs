import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMarketBriefingPrompt,
  extractBriefingContent,
  generateMarketBriefing,
  limitBriefingNews,
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

test("系统提示完整包含 market-briefing skill 的输出规范", () => {
  assert.ok(
    MARKET_BRIEFING_SYSTEM.includes("固定输出 `1、[股市内容]` 和 `2、[债市内容]`"),
  );
  assert.match(MARKET_BRIEFING_SYSTEM, /每条以120—200字为宜/);
  assert.match(MARKET_BRIEFING_SYSTEM, /## 输出前自检/);
});

test("过长新闻按完整文章块限制在动态路由可处理的输入范围内", () => {
  const news = `【1】第一篇\n${"正文一".repeat(5_300)}\n【2】第二篇\n${"正文二".repeat(100)}\n`;
  const limited = limitBriefingNews(news);
  assert.ok(limited.length <= 16_000);
  assert.match(limited, /^【1】/);
  assert.doesNotMatch(limited, /【2】/);
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

test("生成流程从后端取数并经 Workers AI binding 调用 Gemma 4", async () => {
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
      aiGatewayLogId: null,
      run: async (model, input, options) => {
        aiCalls.push({ model, input, options });
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
    assert.equal(aiCalls[0].model, "@cf/google/gemma-4-26b-a4b-it");
    assert.equal(aiCalls[0].input.temperature, 0.1);
    assert.equal(aiCalls[0].input.max_completion_tokens, 1_200);
    assert.deepEqual(aiCalls[0].input.chat_template_kwargs, { enable_thinking: false });
    assert.deepEqual(aiCalls[0].options, {
      gateway: {
        id: "default",
        skipCache: true,
        collectLog: true,
        requestTimeoutMs: 120_000,
        metadata: {
          report_date: "2026-08-10",
          prompt_version: "market-briefing-v5",
        },
      },
      tags: ["eastmoney", "market-briefing", "model:gemma4"],
    });
    assert.match(aiCalls[0].input.messages[0].content, /^---\nname: market-briefing/);
    assert.match(
      aiCalls[0].input.messages[1].content,
      /根据以下 2026-08-10 当天新闻撰写今日市场聚焦/,
    );
    assert.match(aiCalls[0].input.messages[1].content, /【1】股市收盘正文/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
