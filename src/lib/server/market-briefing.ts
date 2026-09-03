import { z } from "zod";

import { formatDataApiError } from "../../data-api-error.ts";
import type { MarketBriefing } from "../../types";
import { generateAiGatewayObject } from "./ai-gateway.ts";

const PROMPT_VERSION = "market-briefing-v5-web-search";
const DATA_TIMEOUT_MS = 60_000;
const marketBriefingOutputSchema = z
  .object({ content: z.string().min(1).describe("只包含两条市场聚焦正文") })
  .strict();
const briefingStockSchema = z.object({
  title: z.string(),
  time: z.string().nullable(),
  paragraphs: z.array(z.string()),
});
const briefingNewsSummarySchema = z.object({
  sentimentId: z.string(),
  title: z.string(),
  time: z.string(),
  tags: z.array(z.string()),
  important: z.boolean().optional(),
});
const briefingNewsListSchema = z.array(briefingNewsSummarySchema);
const briefingNewsResponseSchema = z
  .union([
    briefingNewsListSchema,
    z.object({ list: briefingNewsListSchema }),
  ])
  .transform((value) => Array.isArray(value) ? value : value.list);
const briefingNewsDetailSchema = briefingNewsSummarySchema.extend({
  content: z.string().default(""),
  link: z.string().url().optional(),
});
const MARKET_BRIEFING_TRANSPORT_INSTRUCTION =
  "结构化传输要求：先按上述规范写出两条正文，再将完整正文原样放入响应 JSON 的 content 字段；content 内不要使用 Markdown 代码围栏。";
const DISCARD_TITLE_PREFIXES = [
  "A股早盘收盘",
  "DMI外币资金日评",
  "DMI离岸债日报",
] as const;
const TRUNCATE_RULES = [
  { titlePrefix: "DM债市要闻速览", paragraphPrefix: "地方" },
  { titlePrefix: "DM利率债午间速览", paragraphPrefix: "现券方面" },
] as const;

/**
 * market-briefing skill 全文，与后端旧版 Codex 生成时挂载的 SKILL.md 逐字一致。
 */
export const MARKET_BRIEFING_SYSTEM = `---
name: market-briefing
description: 为专业金融从业者撰写或改写A股与债市的当日市场要闻聚焦。适用于市场日报、收盘点评、股债复盘及需要从行情异动深究驱动、传导机制与后续条件的任务；强调原因分析，禁止堆砌指数、点位和涨跌数据。
---

# 金融市场日报撰写技能

## 核心任务

基于当日新闻和市场证据，仅输出两条精炼观点：第1条聚焦股市，第2条聚焦债市。把篇幅用于解释“为什么”，不要把行情播报当作分析。

## 工作流程

### 1. 获取必要信息

- 用户提供的资讯足以判断时，直接分析，不额外搜索。
- 资讯不足时，只补充能解释核心行情的材料：政策或宏观事件、产业和公司催化、资金面、跨资产联动、拥挤度或止盈压力。
- 优先寻找与当日结构分化直接对应的证据。例如，科技独跌时核对产业链消息和财报；超长债弱于10Y时核对资金面、权益联动、供给和持仓拥挤。
- 不为追求“全面”搜集并罗列所有指数、板块、期限和合约数据。

### 2. 对行情逐项追问原因

对每一个准备写入正文的行情变化，至少追问一次“为什么”；对当天最重要的变化继续追问“该原因为什么会影响这个资产或板块”。在动笔前完成以下判断：

1. 找出主行情和最有解释价值的分化，不复述全部盘面。
2. 区分触发因素、放大因素和结果：新闻或政策通常是触发因素，估值、仓位、流动性和止盈压力可能放大波动，涨跌本身不是原因。
3. 说明传导机制。例如“财报不及预期 → 盈利预期下修 → 高估值硬件承压”，不能只写“受消息影响下跌”。
4. 选择一至两个主因，按解释力排序。不要把所有可能因素用“叠加”串成原因清单。
5. 用板块相对表现、跨资产走势或资金面作为验证。只有同时发生而无传导证据时，不要强行建立因果。
6. 原因不能确认时，使用“更可能”“反映出”“若……则……”并保留替代解释，禁止把猜测写成事实。

### 3. 写成结论

每条采用“行情结论 → 主因 → 传导机制或验证证据 → 条件式展望”的顺序。原因分析应占主要篇幅；展望必须由前述机制自然推出，并指出下一步需要观察的变量。

## 股市条要求

- 用一句话概括整体方向，只保留一个有分析价值的强弱分化或异常表现。
- 解释主导风格或行业变化的具体催化，以及该催化为何引发盈利预期、估值或风险偏好的变化。
- 写“资金轮动”时，说明资金从哪里转向哪里，以及轮动背后的估值、业绩、政策或避险原因。
- 写“风险偏好变化”时，说明造成不确定性上升或下降的事件；不要把“风险偏好”本身当作终点解释。
- 展望聚焦财报、政策细则、海外事件或筹码消化等可验证条件，不作无依据的方向喊话。

## 债市条要求

- 先判断全面走强、走弱还是期限分化，再解释主导力量。
- 优先说明政策预期、资金面、权益联动、供给压力和拥挤交易如何影响利率及曲线；不要机械覆盖所有因素。
- 只有期限差异本身有意义时才分别写10Y和30Y；只有盘中反转揭示驱动变化时才复述日内路径。
- 区分“宽松信号”和“已落地宽松”，区分流动性支持与中期利率方向。
- 展望给出方向约束和验证变量，例如资金价格、政府债供给、政策落地或权益风险偏好。

## 数据纪律

- 数字只用于证明判断，不用于充当正文骨架。每条原则上最多保留两个关键数字。
- 优先写方向、幅度区间或相对强弱；除非点位本身具有突破意义，否则删除精确点位。
- 禁止连续罗列多个指数涨跌幅、多个期限收益率、期货点位、成交额和上涨家数。
- 可以保留一个代表性指数或利率变化，再用结构性语言概括其余行情。
- 若删除数字不影响结论或因果链，就删除该数字。

## 输出规范

- 固定输出 \`1、[股市内容]\` 和 \`2、[债市内容]\`，不加标题、分段或 Markdown。
- 每条以120—200字为宜；事实较少时宁可更短，不用数据或套话凑字数。
- 使用专业、克制、结论先行的语言。
- 因果连接词只在确有逻辑关系时使用；不要反复用“叠加”掩盖主次不清。
- 禁止“行情表现如下”“市场情绪较为谨慎”等无信息量表述。

## 输出前自检

- [ ] 每一个写入正文的涨跌、分化或轮动是否都回答了“为什么”？
- [ ] 核心原因是否进一步解释了传导机制，而非停留在事件名称？
- [ ] 是否把触发因素、放大因素和行情结果混为一谈？
- [ ] 是否只保留一至两个主因，并用当日证据验证？
- [ ] 是否存在没有解释的“资金轮动”“风险偏好”“获利盘兑现”或“政策预期”？
- [ ] 每条数字是否不超过两个，且删除任一数字都会削弱判断？
- [ ] 展望是否来自前述逻辑，并给出可观察条件？
- [ ] 是否严格只输出两条、无小标题、每条不超过200字？

## 风格样例

以下样例只示范写法，不作为未来行情事实模板：

1、A股主要指数集体收跌。美联储维持利率不变但分歧显现，不确定性上升压制全球风险偏好；AI硬件普跌又反映前期拥挤交易对利空更敏感，资金因而转向消费、银行等防御方向。政策信号偏强但缺乏具体工具，若增量细则落地，指数有望修复；科技仍需等待估值与筹码消化。
2、债市全面走强。政策会议虽未明确降准降息，但宽松信号仍在，权益普跌与资金面均衡偏松进一步增强配置需求，推动现券收益率普遍下行。利率短期仍偏强，但下行空间受政府债供给与政策兑现节奏约束，关注后续宽松工具及财政发行节奏。

1、A股整体收涨，科创板逆势走弱。海外存储龙头财报不及预期引发盈利预期下修，半导体硬件承压；资金由高位科技转向消费医药、红利价值等低位板块。多数个股上涨说明赚钱效应仍在，但风格再平衡尚未结束，后续关注财报验证与美联储政策信号。
2、债市期限表现分化，超长端明显偏弱。央行操作呵护跨月流动性，本应利好债市，但权益回暖降低避险需求，前期超长债拥挤又放大止盈压力，因而抵消资金宽松的支撑。若流动性延续宽松，利率趋势仍有支撑，但超长端波动可能更大。
`;

/**
 * 用户提示词：以 Data Worker 材料为主，并允许模型联网补充核验。
 */
export function buildMarketBriefingPrompt(
  reportDate: string,
  newsText: string,
): string {
  return (
    `请使用随附的 market-briefing skill，根据以下 ${reportDate} ` +
    "当天新闻撰写今日市场聚焦。优先使用给定材料，并使用已启用的 Web Search 补充和核验关键行情与驱动；" +
    "不得补写未经给定材料或联网证据验证的事实。" +
    "严格遵守 skill 的输出格式，最终只返回两条正文。\n\n" +
    newsText
  );
}

/**
 * Remove low-value/duplicative briefing items and cut selected long articles
 * before they enter the thinking prompt. The source API contract remains
 * unchanged; this is a prompt-only transformation.
 */
export function filterMarketBriefingNews(newsText: string): string {
  const items = splitBriefingItems(newsText);
  if (items.length === 0) return newsText;

  const filtered = items
    .map((item) => {
      const title = briefingItemTitle(item);
      if (DISCARD_TITLE_PREFIXES.some((prefix) => title.startsWith(prefix))) {
        return "";
      }
      const rule = TRUNCATE_RULES.find((candidate) =>
        title.startsWith(candidate.titlePrefix),
      );
      return rule ? truncateBriefingItem(item, rule.paragraphPrefix) : item;
    })
    .filter(Boolean)
    .map((item, index) => renumberBriefingItem(item, index + 1));

  return filtered.join("\n\n");
}

function splitBriefingItems(newsText: string): string[] {
  return newsText
    .split(/(?=^【\d+】)/m)
    .map((item) => item.trim())
    .filter(Boolean);
}

function briefingItemTitle(item: string): string {
  const firstLine = item.split(/\r?\n/, 1)[0] ?? "";
  return firstLine
    .replace(/^【\d+】/, "")
    .replace(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\s+/, "")
    .trim();
}

function truncateBriefingItem(item: string, paragraphPrefix: string): string {
  const bodyMarker = /\n正文：\n?/;
  const match = bodyMarker.exec(item);
  if (!match || match.index < 0) return item;

  const bodyStart = match.index + match[0].length;
  const header = item.slice(0, bodyStart);
  const body = item.slice(bodyStart);
  const paragraphs = body.split(/\r?\n\s*\r?\n/);
  const cutoff = paragraphs.findIndex((paragraph) =>
    paragraph.trimStart().startsWith(paragraphPrefix),
  );
  if (cutoff < 0) return item;

  const keptBody = paragraphs.slice(0, cutoff).join("\n\n").trimEnd();
  return `${header}${keptBody}`.trimEnd();
}

function renumberBriefingItem(item: string, index: number): string {
  return item.replace(/^【\d+】/, `【${index}】`);
}

export class MarketBriefingError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * 前端 Worker 生成今日聚焦：仅从后端取新闻素材，模型经 AI Gateway default 调用。
 */
export async function generateMarketBriefing(
  env: Env,
  reportDate: string,
): Promise<MarketBriefing> {
  const news = await fetchBriefingNews(env, reportDate);
  const output = await generateAiGatewayObject(
    {
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      gatewayId: env.AI_GATEWAY_ID || "default",
      token: env.CF_AIG_TOKEN,
    },
    [
      { role: "system", content: MARKET_BRIEFING_SYSTEM },
      { role: "system", content: MARKET_BRIEFING_TRANSPORT_INSTRUCTION },
      {
        role: "user",
        content: buildMarketBriefingPrompt(
          reportDate,
          filterMarketBriefingNews(news.news_text),
        ),
      },
    ],
    marketBriefingOutputSchema,
    "market_briefing",
    {
      promptCacheKey: `market-briefing:${PROMPT_VERSION}`,
      requestTimeoutMs: 300_000,
      taskType: "market_briefing",
      tools: [{ type: "web_search" }],
      metadata: {
        report_date: reportDate,
        prompt_version: PROMPT_VERSION,
        tags: "market-briefing,manual-generation,web-search",
      },
    },
  );
  const normalized = output.content.trim();
  if (!normalized) {
    throw new MarketBriefingError(502, "模型未返回市场聚焦内容");
  }
  return { report_date: reportDate, content: normalized, news_count: news.news_count };
}

interface BriefingNews {
  news_count: number;
  news_text: string;
}

async function fetchBriefingNews(
  env: Env,
  reportDate: string,
): Promise<BriefingNews> {
  const baseUrl =
    env.DATA_API_BASE_URL || "https://eastmoney.hasbai.xyz/data";
  const query = new URLSearchParams({ date: reportDate });
  const newsQuery = new URLSearchParams({
    date: reportDate,
    important: "true",
    pageSize: "40",
    fields: "sentimentId,title,time,tags,important",
  });
  const [stockPayload, newsPayload] = await Promise.all([
    fetchDataJson(
      env,
      `${baseUrl}/stock-summary?${query}&fields=title,time,paragraphs`,
      briefingStockSchema,
    ),
    fetchDataJson(env, `${baseUrl}/news?${newsQuery}`, briefingNewsResponseSchema),
  ]);
  const paragraphs = stockPayload.paragraphs.filter((item) => item.length > 0);
  if (paragraphs.length === 0) {
    throw new MarketBriefingError(503, "新闻数据为空，请稍后重试");
  }
  const details = await mapWithConcurrency(
    newsPayload,
    5,
    async (summary) => {
      const detailQuery = new URLSearchParams({
        fields: "sentimentId,title,time,tags,important,content,link",
      });
      const detail = await fetchDataJson(
        env,
        `${baseUrl}/news/${encodeURIComponent(summary.sentimentId)}?${detailQuery}`,
        briefingNewsDetailSchema,
      );
      return { ...summary, ...detail };
    },
  );
  const items: Array<Record<string, unknown>> = [
    {
      title: stockPayload.title,
      time: stockPayload.time,
      tags: ["股市", "行情"],
      content: paragraphs.join("\n"),
    },
    ...details,
  ];
  return {
    news_count: items.length,
    news_text: items
      .map((item, index) => formatBriefingItem(index + 1, item))
      .join("\n\n"),
  };
}

async function fetchDataJson<T>(
  env: Env,
  url: string,
  schema: z.ZodType<T>,
): Promise<T> {
  let response: Response;
  try {
    const request = new Request(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(DATA_TIMEOUT_MS),
    });
    response = env.DATA
      ? await env.DATA.fetch(request)
      : await fetch(request);
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const endpoint = new URL(url).pathname;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new MarketBriefingError(504, `${endpoint} 读取超时（${name}）`);
    }
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    throw new MarketBriefingError(503, `${endpoint} 读取失败：${detail}`);
  }
  if (!response.ok) {
    let errorPayload: unknown;
    try {
      errorPayload = await response.json();
    } catch {
      errorPayload = null;
    }
    throw new MarketBriefingError(
      response.status === 404 ? 404 : 503,
      formatDataApiError(url, response.status, errorPayload),
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new MarketBriefingError(
      503,
      `${new URL(url).pathname} 返回的不是有效 JSON`,
    );
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.code}`)
      .join("；");
    throw new MarketBriefingError(
      503,
      `${new URL(url).pathname} 返回数据不符合接口 Schema：${issues}`,
    );
  }
  return parsed.data;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item !== undefined) results[index] = await task(item);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  return results;
}

function formatBriefingItem(
  index: number,
  item: Record<string, unknown>,
): string {
  const timeText =
    typeof item.time === "string"
      ? item.time.replace("T", " ").slice(0, 19)
      : "--";
  const tags =
    Array.isArray(item.tags) && item.tags.length > 0
      ? item.tags.filter((tag): tag is string => typeof tag === "string").join("、")
      : "--";
  const content =
    typeof item.content === "string" && item.content ? item.content : "（无正文）";
  return [
    `【${index}】${timeText} ${String(item.title ?? "")}`,
    `标签：${tags}`,
    "正文：",
    content,
  ].join("\n");
}
