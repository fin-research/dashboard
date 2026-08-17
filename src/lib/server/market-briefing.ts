import type { MarketBriefing } from "../../types";

const BRIEFING_MODEL = "dynamic/rag" as const;
const PROMPT_VERSION = "market-briefing-v2";
const DATA_TIMEOUT_MS = 60_000;

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
 * 用户提示词，与旧版后端 build_market_briefing_prompt 逐字一致。
 */
export function buildMarketBriefingPrompt(
  reportDate: string,
  newsText: string,
): string {
  return (
    `请使用随附的 market-briefing skill，根据以下 ${reportDate} ` +
    "当天新闻撰写今日市场聚焦。只使用给定材料，不额外搜索或补写无法验证的事实。" +
    "严格遵守 skill 的输出格式，最终只返回两条正文。\n\n" +
    newsText
  );
}

/**
 * 兼容 AI Gateway 的 OpenAI 格式与 Workers AI 原生格式。
 */
export function extractBriefingContent(output: unknown): string {
  if (typeof output !== "object" || output === null) return "";
  const record = output as {
    choices?: Array<{ message?: { content?: unknown } }>;
    response?: unknown;
  };
  const choiceContent = record.choices?.[0]?.message?.content;
  if (typeof choiceContent === "string" && choiceContent.trim()) {
    return choiceContent;
  }
  if (Array.isArray(choiceContent)) {
    const text = choiceContent
      .filter(
        (part): part is { text?: unknown } =>
          typeof part === "object" && part !== null,
      )
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim();
    if (text) return text;
  }
  if (typeof record.response === "string") return record.response;
  return "";
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
  const gatewayResponse = await env.AI.gateway(env.AI_GATEWAY_ID || "default").run(
    {
      provider: "compat",
      endpoint: "chat/completions",
      headers: {},
      query: {
        model: BRIEFING_MODEL,
        reasoning_effort: "max",
        messages: [
          { role: "system", content: MARKET_BRIEFING_SYSTEM },
          {
            role: "user",
            content: buildMarketBriefingPrompt(reportDate, news.news_text),
          },
        ],
      },
    },
    {
      gateway: {
        id: env.AI_GATEWAY_ID || "default",
        skipCache: true,
        collectLog: true,
        requestTimeoutMs: 120_000,
        metadata: { report_date: reportDate, prompt_version: PROMPT_VERSION },
      },
    },
  );
  const output = await gatewayResponse.json();
  const content = extractBriefingContent(output).trim();
  if (!content) {
    throw new MarketBriefingError(502, "模型未返回市场聚焦内容");
  }
  return { report_date: reportDate, content, news_count: news.news_count };
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
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/market-briefing/news?${query}`, {
      method: "POST",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(DATA_TIMEOUT_MS),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new MarketBriefingError(504, "新闻数据读取超时，请稍后重试");
    }
    throw new MarketBriefingError(503, "新闻数据读取失败，请稍后重试");
  }
  if (!response.ok) {
    throw new MarketBriefingError(503, "新闻数据读取失败，请稍后重试");
  }
  const payload = (await response.json()) as {
    report_date?: string;
    news_count?: number;
    news_text?: string;
  };
  if (typeof payload.news_text !== "string" || !payload.news_text) {
    throw new MarketBriefingError(503, "新闻数据为空，请稍后重试");
  }
  return { news_count: payload.news_count ?? 0, news_text: payload.news_text };
}
