import {
  parseHotspotAnalysis,
  type HotspotAnalysis,
  type HotspotApiResponse,
  type HotspotScope,
} from "$lib/hotspots";

const HOTSPOT_MODEL = "dynamic/rag" as const;
const PROMPT_VERSION = "d1-hotspots-v6";
const HOTSPOT_GENERATION_CONFIG = {
  temperature: 1.0,
  reasoning_effort: "max",
} as const;

const HOTSPOT_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    marketSummary: { type: "string" },
    hotspots: {
      type: "array",
      minItems: 8,
      maxItems: 15,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          keyword: { type: "string" },
          aliases: { type: "array", items: { type: "string" }, maxItems: 8 },
          explanation: { type: "string" },
          drivers: { type: "array", items: { type: "string" }, maxItems: 8 },
          conflicts: { type: "array", items: { type: "string" }, maxItems: 6 },
          heat: { type: "number", minimum: 0, maximum: 100 },
          assetImpacts: {
            type: "object",
            additionalProperties: false,
            properties: {
              fixedIncome: { type: "string" },
              equities: { type: "string" },
            },
            required: ["fixedIncome", "equities"],
          },
          evidence: {
            type: "array",
            minItems: 1,
            maxItems: 5,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                articleId: { type: "string" },
                evidence: { type: "string" },
              },
              required: ["articleId", "evidence"],
            },
          },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: [
          "keyword",
          "aliases",
          "explanation",
          "drivers",
          "conflicts",
          "assetImpacts",
          "heat",
          "evidence",
          "confidence",
        ],
      },
    },
    relationships: {
      type: "array",
      maxItems: 24,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          source: { type: "string" },
          target: { type: "string" },
          explanation: { type: "string" },
        },
        required: ["source", "target", "explanation"],
      },
    },
    watchItems: {
      type: "array",
      items: { type: "string" },
      maxItems: 12,
    },
  },
  required: ["marketSummary", "hotspots", "relationships", "watchItems"],
} as const;

const HOTSPOT_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "market_hotspots",
    strict: true,
    schema: HOTSPOT_RESPONSE_SCHEMA,
  },
} as const;

interface ArticleRow {
  id: string;
  title: string;
  summary: string;
  importance: number;
  published_at: string;
  updated_at: string;
}

interface KeywordRow {
  article_id: string;
  ordinal: number;
  topic: string;
  fact: string;
  interpretation: string;
  impact: string;
}

interface EvidenceCard extends ArticleRow {
  keywords: Array<Omit<KeywordRow, "article_id">>;
}

interface CacheRow {
  input_fingerprint: string;
  generated_at: string;
  model: string;
  payload: string;
}

export type HotspotRequestScope =
  | { mode: "rolling"; rollingCount: number }
  | { mode: "range"; startDate: string; endDate: string };

const AGGREGATE_SYSTEM = `你是服务于专业投资者的中国股债市场首席研究员。输入是第一阶段产生的全部结构化证据卡片，不包含完整原文。请先按“同一驱动、政策操作、资产定价主题”聚类，再生成供词云与解释面板直接使用的热点。

先在内部完成事件归并、同义词统一、证据交叉验证、重要性排序和市场影响判断，不输出推理过程。最终只输出结果 JSON。

证据边界：
1. 只能使用输入的标题、summary、importance 和 keywords 证据，不得补充常识、旧闻或模型知识；明确区分文章观点与跨文档归纳。
2. 必须逐一阅读全部输入 articleId；coverage 由应用根据实际输入范围生成，无需在模型结果中输出。
3. 同一主题列出所有直接相关的 evidence，最多 5 篇；不得只挑一篇代表性文章后宣称跨文档共振。

热点聚类与排序：
4. 合并同义词、上下位概念和同源观点，不得把同一 articleId 的近义概念拆成多个热点。
5. 同一事件的不同表述必须合并；过宽词必须细化为具体事件。每条至少引用 1 个 evidence；单一来源观点必须按"单一来源"处理，不得写成跨文档共振；high 至少需要 2 个不同 articleId。
6. 输出 8-15 个热点，并为每个热点直接给出 0-100 的整数 heat。评分可参考以下权重公式自行判断，公式仅为提示：热点得分 ≈ 来源覆盖度 × 0.30 + 市场影响程度 × 0.25 + 信息新鲜度 × 0.20 + 证据可信度 × 0.15 + 跨资产关联度 × 0.10。单一来源观点应相应压低 heat。
7. keyword 使用 2-8 个汉字或常用市场缩写。禁止"市场、政策、经济、利率、债券、股票、风险"等无辨识度词，也禁止近义关键词重复。

解释质量：
8. explanation 用 80-180 个汉字的自然语言写成一段，不使用模板标签或箭头。说明事实或分歧、传导机制、受影响资产以及验证或失效条件。
9. assetImpacts 只输出一条 fixedIncome（固收）和一条 equities（权益）；无直接影响时写“证据不足”，不得机械填写“中性”。
10. relationships 的 source 和 target 必须与最终 keyword 完全一致，且只保留证据支持的传导关系。
11. evidence.articleId 必须去重。涉及汇率时必须写清货币对方向，避免"汇价走低"与"币值走低"混淆。
12. 事实冲突时在 conflicts 中逐条保留冲突，不自行选择；没有冲突时输出空数组。解析中不得出现证据卡片以外的新数据。
13. 最终输出必须是符合给定 JSON Schema 的单个 JSON 对象，不要输出其他正文、Markdown、代码围栏、注释或思考过程。`;

export async function getMarketHotspots(
  env: Env,
  requestScope: HotspotRequestScope,
  options: { refresh: boolean },
): Promise<HotspotApiResponse> {
  const cards = await loadEvidenceCards(env.DB, requestScope);
  if (cards.length === 0) {
    throw new HotspotError(404, "所选范围内尚无已完成特征抽取的文章");
  }
  const articleIds = cards.map((card) => card.id);
  const date = cards[0]!.published_at.slice(0, 10);
  const scope = resolvedScope(requestScope, cards);
  const scopeKey = cacheKey(requestScope);
  const fingerprint = await createFingerprint(cards);

  if (!options.refresh) {
    const cached = await env.DB.prepare(
      `SELECT input_fingerprint, generated_at, model, payload
       FROM hotspot_cache WHERE scope_key = ?`,
    )
      .bind(scopeKey)
      .first<CacheRow>();
    if (cached?.input_fingerprint === fingerprint) {
      const analysis = parseHotspotAnalysis(cached.payload, { date, articleIds });
      return withMetadata(analysis, cached.generated_at, cached.model, true, scope);
    }
  }

  const gatewayResponse = await env.AI.gateway(env.AI_GATEWAY_ID || "default").run(
    {
      provider: "compat",
      endpoint: "chat/completions",
      headers: {},
      query: {
        model: HOTSPOT_MODEL,
        messages: buildAggregateMessages(cards),
        ...HOTSPOT_GENERATION_CONFIG,
        response_format: HOTSPOT_RESPONSE_FORMAT,
      },
    },
    {
      gateway: {
        id: env.AI_GATEWAY_ID || "default",
        skipCache: true,
        collectLog: true,
        requestTimeoutMs: 120_000,
        metadata: { date, scope_key: scopeKey, prompt_version: PROMPT_VERSION },
      },
    },
  );
  const output = (await gatewayResponse.json()) as unknown;
  const content = extractHotspotContent(output);
  if (!gatewayResponse.ok || !content) {
    console.error(
      JSON.stringify({
        event: "market_hotspots_gateway_response",
        status: gatewayResponse.status,
        gateway_log_id: env.AI.aiGatewayLogId,
        output: summarizeGatewayOutput(output),
      }),
    );
    throw new HotspotError(502, "Workers AI 未返回可解析的热点结果");
  }
  const analysis = parseHotspotAnalysis(content, { date, articleIds });
  const generatedAt = new Date().toISOString();
  const payload = JSON.stringify(analysis);

  await env.DB.prepare(
    `INSERT INTO hotspot_cache (
       scope_key, input_fingerprint, generated_at, model, payload
     ) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(scope_key) DO UPDATE SET
       input_fingerprint = excluded.input_fingerprint,
       generated_at = excluded.generated_at,
       model = excluded.model,
       payload = excluded.payload`,
  )
    .bind(scopeKey, fingerprint, generatedAt, HOTSPOT_MODEL, payload)
    .run();

  return withMetadata(analysis, generatedAt, HOTSPOT_MODEL, false, scope);
}

function extractHotspotContent(output: unknown): string {
  if (!output || typeof output !== "object" || Array.isArray(output)) return "";
  const record = output as {
    choices?: Array<{ message?: { content?: unknown } }>;
    response?: unknown;
  };
  const choiceContent = record.choices?.[0]?.message?.content;
  if (typeof choiceContent === "string" && choiceContent.trim()) return choiceContent;
  if (Array.isArray(choiceContent)) {
    const text = choiceContent
      .filter((part): part is { text?: unknown } => typeof part === "object" && part !== null)
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim();
    if (text) return text;
  }
  return typeof record.response === "string" ? record.response : "";
}

function summarizeGatewayOutput(output: unknown): Record<string, unknown> {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return { type: typeof output };
  }
  const record = output as Record<string, unknown>;
  const error = record.error;
  const summary: Record<string, unknown> = {
    keys: Object.keys(record),
    error:
      typeof error === "string"
        ? error.slice(0, 300)
        : error && typeof error === "object"
          ? Object.keys(error as object)
          : undefined,
  };
  for (const key of ["name", "internalCode", "httpCode", "message", "description", "requestId"]) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number") summary[key] = value;
  }
  return summary;
}

async function loadEvidenceCards(
  database: Env["DB"],
  scope: HotspotRequestScope,
): Promise<EvidenceCard[]> {
  const articleStatement =
    scope.mode === "rolling"
      ? database
          .prepare(
            `SELECT a.id, a.title, a.summary, a.importance, a.published_at, a.updated_at
             FROM article a
             WHERE a.summary IS NOT NULL
               AND a.importance IS NOT NULL
               AND EXISTS (SELECT 1 FROM keyword k WHERE k.article_id = a.id)
             ORDER BY a.published_at DESC, a.id DESC
             LIMIT ?`,
          )
          .bind(scope.rollingCount)
      : database
          .prepare(
            `SELECT a.id, a.title, a.summary, a.importance, a.published_at, a.updated_at
             FROM article a
             WHERE substr(a.published_at, 1, 10) BETWEEN ? AND ?
               AND a.summary IS NOT NULL
               AND a.importance IS NOT NULL
               AND EXISTS (SELECT 1 FROM keyword k WHERE k.article_id = a.id)
             ORDER BY a.published_at DESC, a.id DESC
             LIMIT 100`,
          )
          .bind(scope.startDate, scope.endDate);
  const articlesResult = await articleStatement.all<ArticleRow>();
  const articles: ArticleRow[] = articlesResult.results ?? [];
  if (articles.length === 0) return [];
  const placeholders = articles.map(() => "?").join(", ");
  const keywordsResult = await database
    .prepare(
      `SELECT article_id, ordinal, topic, fact, interpretation, impact
       FROM keyword
       WHERE article_id IN (${placeholders})
       ORDER BY article_id ASC, ordinal ASC`,
    )
    .bind(...articles.map((article) => article.id))
    .all<KeywordRow>();
  const keywords: KeywordRow[] = keywordsResult.results ?? [];
  const keywordsByArticle = new Map<string, EvidenceCard["keywords"]>();
  for (const keyword of keywords) {
    const group = keywordsByArticle.get(keyword.article_id) ?? [];
    group.push({
      ordinal: keyword.ordinal,
      topic: keyword.topic,
      fact: keyword.fact,
      interpretation: keyword.interpretation,
      impact: keyword.impact,
    });
    keywordsByArticle.set(keyword.article_id, group);
  }
  return articles
    .map((article) => ({
      ...article,
      keywords: keywordsByArticle.get(article.id) ?? [],
    }))
    .filter((article) => article.keywords.length > 0);
}

function buildAggregateMessages(
  cards: EvidenceCard[],
): Array<{ role: "system" | "user"; content: string }> {
  const cardBlocks = cards.map((card, index) => {
    const keywordLines = card.keywords
      .map(
        (keyword) =>
          `- **主题**：${keyword.topic}\n  - 事实：${keyword.fact}\n  - 解读：${keyword.interpretation}\n  - 影响：${keyword.impact}`,
      )
      .join("\n");
    return [
      `## 证据卡 ${index + 1}`,
      `- **articleId**：${card.id}`,
      `- **标题**：${card.title}`,
      `- **发布时间**：${card.published_at}`,
      `- **importance**：${card.importance}`,
      `- **摘要**：${card.summary}`,
      `- **关键词**：`,
      keywordLines,
    ].join("\n");
  });
  return [
    { role: "system", content: AGGREGATE_SYSTEM },
    {
      role: "user",
      content: `${cardBlocks.join("\n\n")}\n\n请输出 8-15 个热点，禁止为了凑数拆分近义主题。严格按 JSON Schema 输出：marketSummary 为 120-220 字总览；每条 evidence 只引用上面的 articleId；heat 为 0-100 的整数，直接给出综合热度。`,
    },
  ];
}

async function createFingerprint(cards: EvidenceCard[]): Promise<string> {
  const source = JSON.stringify({ promptVersion: PROMPT_VERSION, cards });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(source),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function withMetadata(
  analysis: HotspotAnalysis,
  generatedAt: string,
  model: string,
  cached: boolean,
  scope: HotspotScope,
): HotspotApiResponse {
  return { ...analysis, generatedAt, model, cached, scope };
}

function resolvedScope(
  requestScope: HotspotRequestScope,
  cards: EvidenceCard[],
): HotspotScope {
  const published = cards.map((card) => card.published_at).sort();
  const common = {
    articleCount: cards.length,
    firstPublishedAt: published[0]!,
    lastPublishedAt: published.at(-1)!,
  };
  return requestScope.mode === "rolling"
    ? { ...common, mode: "rolling", rollingCount: requestScope.rollingCount }
    : { ...common, ...requestScope };
}

function cacheKey(scope: HotspotRequestScope): string {
  return scope.mode === "rolling"
    ? `rolling:${scope.rollingCount}`
    : `range:${scope.startDate}:${scope.endDate}`;
}

export class HotspotError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
