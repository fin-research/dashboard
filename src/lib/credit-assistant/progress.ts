import type { CreditActivity, CreditSession, CreditStage } from "./types.ts";

// Activities are an ordered log, not milestones: retrieval and review may recur.
export function appendCreditActivity(state: CreditSession, message: string, stage: CreditStage, now = Date.now()): CreditActivity[] {
  const activities = state.activities ?? [];
  const last = activities.at(-1);
  if (last?.stage === stage && last.message === message) return activities;
  return [...activities, { id: (last?.id ?? 0) + 1, stage, message, startedAt: now }].slice(-64);
}

export function creditActivityLabel(activity: CreditActivity, activities: CreditActivity[]): string {
  const labels: Record<CreditStage, string> = { scope: "问题判断", retrieval: "检索材料", analysis: "分析证据",
    read: "阅读原文", calculate: "核算数据", answer: "整理答复", review: "复核答复" };
  const count = activities.filter(item => item.id <= activity.id && item.stage === activity.stage).length;
  return `${labels[activity.stage]}${count > 1 && ["retrieval", "read", "calculate", "review"].includes(activity.stage) ? ` · 第 ${count} 轮` : ""}`;
}
