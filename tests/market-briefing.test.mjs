import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMarketBriefingPrompt,
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

test("生成流程从后端取数并调用 dynamic/rag", async () => {
  const originalFetch = globalThis.fetch;
  const aiCalls = [];
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    if (target.includes("/data/market-briefing/news")) {
      assert.equal(
        target,
        "https://eastmoney.hasbai.xyz/data/market-briefing/news?date=2026-08-10",
      );
      assert.equal(init?.method, "POST");
      return new Response(
        JSON.stringify({
          report_date: "2026-08-10",
          news_count: 2,
          news_text: "【1】股市收盘正文",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    aiCalls.push({ target, init, query: JSON.parse(init.body) });
    return Response.json({
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 1,
      model: "gpt-5.6-luna",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "1、股市结论。\n2、债市结论。" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  };
  const env = {
    CLOUDFLARE_ACCOUNT_ID: "account-id",
    AI_GATEWAY_ID: "default",
    CF_AIG_TOKEN: "test-token",
    DATA_API_BASE_URL: "https://eastmoney.hasbai.xyz/data",
  };
  try {
    const result = await generateMarketBriefing(env, "2026-08-10");
    assert.deepEqual(result, {
      report_date: "2026-08-10",
      content: "1、股市结论。\n2、债市结论。",
      news_count: 2,
    });
    assert.equal(
      aiCalls[0].target,
      "https://gateway.ai.cloudflare.com/v1/account-id/default/compat/chat/completions",
    );
    assert.equal(aiCalls[0].query.model, "dynamic/rag");
    assert.equal(aiCalls[0].query.temperature, 0.1);
    assert.equal(aiCalls[0].query.reasoning_effort, "high");
    assert.equal(aiCalls[0].query.chat_template_kwargs.enable_thinking, true);
    assert.equal("response_format" in aiCalls[0].query, false);
    assert.equal("top_p" in aiCalls[0].query, false);
    assert.equal("top_k" in aiCalls[0].query, false);
    assert.equal("repetition_penalty" in aiCalls[0].query, false);
    assert.equal("seed" in aiCalls[0].query, false);
    assert.equal("max_completion_tokens" in aiCalls[0].query, false);
    const headers = new Headers(aiCalls[0].init.headers);
    assert.equal(headers.get("cf-aig-authorization"), "Bearer test-token");
    assert.equal(headers.get("cf-aig-skip-cache"), "true");
    assert.equal(headers.get("cf-aig-collect-log"), "true");
    assert.equal(headers.get("cf-aig-request-timeout"), "120000");
    assert.deepEqual(JSON.parse(headers.get("cf-aig-metadata")), {
      report_date: "2026-08-10",
      prompt_version: "market-briefing-v3-dynamic-rag-thinking-filtered",
    });
    assert.ok(aiCalls[0].init.signal instanceof AbortSignal);
    assert.match(aiCalls[0].query.messages[0].content, /^---\nname: market-briefing/);
    assert.match(
      aiCalls[0].query.messages[1].content,
      /根据以下 2026-08-10 当天新闻撰写今日市场聚焦/,
    );
    assert.match(aiCalls[0].query.messages[1].content, /【1】股市收盘正文/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
