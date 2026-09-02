import { z } from "zod";

import type { CommentaryContent, ResearchCommentary } from "$lib/policies";
import { stripCommentarySourceLinks } from "$lib/policy-commentary-output";
import {
  AI_GATEWAY_MODEL,
  generateAiGatewayObject,
} from "./ai-gateway";
import { fetchDataNewsDetail } from "./data-news";
import {
  loadCommentaryGenerationContext,
  saveGeneratedCommentary,
} from "./policy-repository";

export const POLICY_COMMENTARY_PROMPT_VERSION = "policy-commentary-v3";
const ARTICLE_DETAIL_CONCURRENCY = 5;

const generatedCommentarySchema = z.object({
  eventSummary: z.string().min(20).max(120),
  commentary: z.string().min(20).max(4_000).regex(/^1\. /),
  recommendation: z.string().min(20).max(2_000).regex(/^融资发行方面，/),
}).strict();

const COMMENTARY_INSTRUCTIONS = `你是东方财富证券资金管理部的研究与资金运营支持人员。请站在券商资金部角度，根据输入的政策、宏观数据、市场事件、监管动态或海外经济金融信息，生成一篇可直接用于资金管理、融资安排、流动性管理、债券投资和二级池配置决策的简短时事快评。

事实与资料边界：
1. policyNews 是确认事件与政策事实的主要依据；researchReports（如有）用于吸收卖方分析框架和分歧；联网搜索只用于补充最新背景、市场反应和核验关键事实。
2. 必须区分官方政策、卖方观点与公开资料，不得把研报或搜索结果写成官方表述。不得脱离材料编造数据；使用数字时必须与来源一致。材料存在分歧时应保留不确定性，并优先采用权威、较新的事实。
3. 不做长篇新闻复述，不写空话套话。分析重点放在宏观、货币政策、资金面、债券市场、融资发行和资金配置的传导机制与决策含义。
4. 三个输出字段均不得包含 URL、Markdown 链接、来源脚注或来源列表；应用会另行展示事件名称、消息来源、发布时间和快评时间，不要在字段正文中重复这些元数据。

输出仍使用既有 JSON 结构，全文控制在一页纸以内：
- eventSummary：只写一段，120 字以内。结论先行，突出事件焦点、最重要的数据或政策变化，并直接给出资金部关注的核心结论。
- commentary：固定写 3 点编号分析。每点先写一行“1. 判断式标题”，下一行写正文；标题必须表达判断，不能只写主题词。第 1 点分析事件本身及边际变化，第 2 点分析固收、资金面或利率层面的传导，第 3 点分析对券商资金业务的影响，包括负债成本、融资窗口、杠杆、流动性、久期或二级池配置。每点均应说明原因、传导机制或后续验证条件。
- recommendation：必须以“融资发行方面，”开头，给出具体的融资发行建议及原因，例如发行节奏、期限、品种与需要避开的季末、税期、缴准或重要会议窗口；可继续补充二级池配置、流动性管理、久期策略、信用债配置、存单或回购安排。建议必须可执行，不写泛泛表态。

语言要求：简洁、凝练、专业、克制，使用券商资金部和固收研究常用表达。可参考“对债市冲击偏阶段性，不改变资金面稳中偏松主线”“融资发行可继续前置，优先把握中短久期窗口”“二级池配置宜维持中性偏防御”等判断式写法，但必须根据本次事实独立形成结论。

风格样例仅用于学习结构与密度，不得复制其中数据或结论：
{
  "eventSummary": "8月制造业PMI回升0.6个百分点至49.8%，生产、新订单重返扩张区间；1—7月工业利润同比增长17.6%。基本面边际修复但总量仍偏弱，债市利空出尽，关注9月增量政策落地。",
  "commentary": "1. 订单先行、生产回补，制造业低位修复\\n8月生产与新订单同步改善，且订单回升快于生产、产成品库存回落，制造业动能边际修复；但总量仍处荣枯线以下，结构分化尚未扭转。\\n\\n2. 工业利润维持较快增长，但改善斜率放缓\\n工业利润累计增速仍高，但单月与利润率边际回落，且盈利集中于少数行业，说明企业盈利并非全面扩张，基本面对利率的约束仍有限。\\n\\n3. 数据对债市偏利空但冲击有限，融资窗口宜前置把握\\n市场呈现利空出尽特征，短期利率或延续震荡；后续主要验证稳增长政策落地、政府债供给和季末资金扰动，资金部需兼顾负债成本与流动性安全。",
  "recommendation": "融资发行方面，若月初资金面稳定、信用利差维持低位，可优先把握中短期限融资窗口，避免集中至季末被动承受资金价格和利率波动，择机锁定低成本负债。二级池配置方面，宜维持中性偏防御，若长端利率受情绪扰动上行，可逢调整适度增配高流动性利率债。"
}

严格按 JSON Schema 输出，不输出标题、Markdown 标记、思考过程或额外字段。`;

interface ArticleDetail {
  id: string;
  title: string;
  author: string | null;
  publishedAt: string;
  content: string;
}

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
      content: (await fetchDataNewsDetail(env, article.id)).content,
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
      taskType: "policy_commentary",
      tools: [{ type: "web_search" }],
      metadata: {
        policy_id: policyId,
        policy_date: context.policy.policyDate,
        article_count: articles.length,
        prompt_version: POLICY_COMMENTARY_PROMPT_VERSION,
        tags: "policy-tracking,commentary,manual-generation,web-search",
      },
    },
  );
  const generatedAt = new Date().toISOString();
  const normalizedOutput = generatedCommentarySchema.parse({
    eventSummary: stripCommentarySourceLinks(output.eventSummary),
    commentary: stripCommentarySourceLinks(output.commentary),
    recommendation: stripCommentarySourceLinks(output.recommendation),
  });
  const content: CommentaryContent = {
    eventName: context.policy.title,
    sources: context.policy.departments.join("、"),
    eventPublishedAt: context.policy.policyDate,
    commentaryDate: shanghaiToday(),
    eventSummary: normalizedOutput.eventSummary,
    commentary: normalizedOutput.commentary,
    recommendation: normalizedOutput.recommendation,
  };
  return await saveGeneratedCommentary(env.DB, policyId, content, {
    model: AI_GATEWAY_MODEL,
    promptVersion: POLICY_COMMENTARY_PROMPT_VERSION,
    generatedAt,
  });
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
