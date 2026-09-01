import { z } from "zod";

import type { CommentaryContent, ResearchCommentary } from "$lib/policies";
import {
  AI_GATEWAY_MODEL,
  generateAiGatewayObject,
} from "./ai-gateway";
import {
  loadCommentaryGenerationContext,
  saveGeneratedCommentary,
} from "./policy-repository";

export const POLICY_COMMENTARY_PROMPT_VERSION = "policy-commentary-v1";
const MAX_DATA_RESPONSE_BYTES = 5 * 1024 * 1024;
const ARTICLE_DETAIL_CONCURRENCY = 5;

const generatedCommentarySchema = z.object({
  eventSummary: z.string().min(20).max(4_000),
  commentary: z.string().min(20).max(16_000),
  recommendation: z.string().min(20).max(6_000),
}).strict();

const COMMENTARY_INSTRUCTIONS = `你是东方财富证券资金管理部的专业研究员。请根据输入的政策原始资讯和已经确认关联的卖方研报，生成“政策跟踪”点评初版。

必须只使用输入材料，不搜索、不补写无法验证的数字或事实。政策资讯用于确认政策事实，研报用于吸收分析框架和分歧；不得把研报观点写成官方表述。若材料之间存在分歧，应明确保留。

eventSummary 写一段结论先行的事件摘要，突出政策动作、直接变化和最重要的市场含义。commentary 写 2—5 条编号分析，每条格式为“1. 小标题”另起一行写正文，覆盖政策变化、传导机制、资产或融资影响和后续验证条件。recommendation 写对资金管理、负债融资或投资交易可执行的应对建议，不写泛泛表态。

语言专业、克制，数字只在支持判断时保留。严格按 JSON Schema 输出，不输出 Markdown 标记、思考过程或额外字段。`;

interface ArticleDetail {
  id: string;
  title: string;
  author: string | null;
  publishedAt: string;
  content: string;
}

const articleDetailSchema = z.object({
  content: z.string().min(1),
}).passthrough();

export async function generatePolicyCommentary(
  env: Env,
  policyId: string,
): Promise<ResearchCommentary> {
  const context = await loadCommentaryGenerationContext(env.DB, policyId);
  const articles = await mapWithConcurrency(
    context.articles,
    ARTICLE_DETAIL_CONCURRENCY,
    async (article): Promise<ArticleDetail> => ({
      ...article,
      content: await fetchArticleContent(env, article.id),
    }),
  );
  const output = await generateAiGatewayObject(
    {
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      gatewayId: env.AI_GATEWAY_ID || "default",
      token: env.CF_AIG_TOKEN,
    },
    [
      { role: "system", content: COMMENTARY_INSTRUCTIONS },
      {
        role: "user",
        content: JSON.stringify({
          policy: context.policy,
          policyNews: context.news,
          researchReports: articles,
        }),
      },
    ],
    generatedCommentarySchema,
    "policy_commentary",
    {
      promptCacheKey: `policy-tracking:${POLICY_COMMENTARY_PROMPT_VERSION}`,
      requestTimeoutMs: 300_000,
      taskType: "analysis",
      metadata: {
        policy_id: policyId,
        policy_date: context.policy.policyDate,
        article_count: articles.length,
        prompt_version: POLICY_COMMENTARY_PROMPT_VERSION,
        tags: "policy-tracking,commentary,manual-generation",
      },
    },
  );
  const generatedAt = new Date().toISOString();
  const content: CommentaryContent = {
    eventName: context.policy.title,
    sources: context.policy.departments.join("、"),
    eventPublishedAt: context.policy.policyDate,
    commentaryDate: shanghaiToday(),
    eventSummary: output.eventSummary.trim(),
    commentary: output.commentary.trim(),
    recommendation: output.recommendation.trim(),
  };
  return await saveGeneratedCommentary(env.DB, policyId, content, {
    model: AI_GATEWAY_MODEL,
    promptVersion: POLICY_COMMENTARY_PROMPT_VERSION,
    generatedAt,
  });
}

async function fetchArticleContent(env: Env, articleId: string): Promise<string> {
  const baseUrl = env.DATA_API_BASE_URL || "https://eastmoney.hasbai.xyz/data";
  const url = `${baseUrl}/news/${encodeURIComponent(articleId)}?fields=content`;
  const request = new Request(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  let response: Response;
  try {
    response = env.DATA ? await env.DATA.fetch(request) : await fetch(request);
  } catch (error) {
    throw new PolicyCommentaryError(
      503,
      `关联研报正文读取失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    throw new PolicyCommentaryError(503, `关联研报正文读取失败（HTTP ${response.status}）`);
  }
  const text = await readTextBounded(response, MAX_DATA_RESPONSE_BYTES);
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new PolicyCommentaryError(503, "关联研报正文返回的不是有效 JSON");
  }
  const parsed = articleDetailSchema.safeParse(payload);
  if (!parsed.success) {
    throw new PolicyCommentaryError(503, "关联研报正文不符合接口 Schema");
  }
  return parsed.data.content;
}

async function readTextBounded(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length") || "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new PolicyCommentaryError(503, "关联研报正文响应过大");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel("response too large");
      throw new PolicyCommentaryError(503, "关联研报正文响应过大");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
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
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function shanghaiToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export class PolicyCommentaryError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "PolicyCommentaryError";
    this.status = status;
  }
}
