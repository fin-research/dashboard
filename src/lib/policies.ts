import { z } from "zod";

export const policyCategorySchema = z.enum([
  "monetary",
  "fiscal",
  "real_estate",
  "capital_market",
  "industry",
  "trade",
  "social",
  "other",
]);

export const commentaryTypeSchema = z.enum([
  "current_affairs",
  "policy_tracking",
  "overseas_event",
]);

export const commentaryContentSchema = z.object({
  eventName: z.string().trim().min(4).max(240),
  sources: z.string().trim().min(2).max(500),
  eventPublishedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  commentaryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  eventSummary: z.string().trim().min(20).max(4_000),
  commentary: z.string().trim().min(20).max(16_000),
  recommendation: z.string().trim().min(20).max(6_000),
}).strict();

export const articleAssociationUpdateSchema = z.object({
  articleIds: z.array(z.string().min(1)).max(100),
}).strict();

export type PolicyCategory = z.infer<typeof policyCategorySchema>;
export type CommentaryType = z.infer<typeof commentaryTypeSchema>;
export type CommentaryContent = z.infer<typeof commentaryContentSchema>;

export interface PolicyNews {
  id: string;
  newsId: string | null;
  title: string;
  publishedAt: string;
  link: string | null;
}

export interface PolicyArticle {
  id: string;
  title: string;
  author: string | null;
  summary: string;
  publishedAt: string;
  link: string | null;
  associationMethod: "ai" | "manual";
}

export interface ResearchCommentary extends CommentaryContent {
  id: string;
  type: CommentaryType;
  model: string | null;
  promptVersion: string | null;
  generatedAt: string | null;
  edited: boolean;
  updatedAt: string;
}

export interface PolicyEvent {
  id: string;
  title: string;
  summary: string;
  category: PolicyCategory;
  departments: string[];
  policyDate: string;
  firstNewsAt: string;
  lastNewsAt: string;
  updatedAt: string;
  news: PolicyNews[];
  articles: PolicyArticle[];
  commentary: ResearchCommentary | null;
}

export interface PolicyTimelineResponse {
  policies: PolicyEvent[];
}

export interface ArticleSearchResult {
  id: string;
  title: string;
  author: string | null;
  summary: string;
  publishedAt: string;
  link: string | null;
}

export interface RelatedPolicySummary {
  id: string;
  title: string;
  summary: string;
  category: PolicyCategory;
  policyDate: string;
}

export interface PolicyNewsDetail extends PolicyNews {
  content: string;
  policy: RelatedPolicySummary;
}

export interface ResearchReportDetail extends ArticleSearchResult {
  content: string;
  policies: RelatedPolicySummary[];
}

export interface ResearchCommentaryDetail {
  commentary: ResearchCommentary;
  policy: RelatedPolicySummary;
}

export const policyCategoryLabels: Record<PolicyCategory, string> = {
  monetary: "货币政策",
  fiscal: "财政政策",
  real_estate: "房地产",
  capital_market: "资本市场",
  industry: "产业政策",
  trade: "贸易政策",
  social: "民生政策",
  other: "其他政策",
};
