import type { ResearchCommentary } from "$lib/policies";
import { shanghaiDate } from "../tracking-commentary.ts";
import { loadCommentaryGenerationContext } from "./policy-repository.ts";
import { createTrackingCommentary } from "./tracking-commentary-repository.ts";
import { generateTrackingCommentary, TRACKING_COMMENTARY_PROMPT_VERSION } from "./tracking-commentary-generation.ts";

// Compatibility entry point: all drafting now uses the tracking workbench pipeline.
export const POLICY_COMMENTARY_PROMPT_VERSION = TRACKING_COMMENTARY_PROMPT_VERSION;
export async function generatePolicyCommentary(env: Env, policyId: string): Promise<ResearchCommentary> {
  const context = await loadCommentaryGenerationContext(env.DB, policyId);
  const current = await createTrackingCommentary(env.DB, {
    policyId, type: "policy_tracking", eventName: context.policy.title,
    sources: context.policy.departments.join("、"), eventPublishedAt: context.policy.policyDate,
    commentaryDate: shanghaiDate(), eventSummary: context.policy.summary, commentary: "", recommendation: "",
  });
  const endDate = context.policy.policyDate;
  const startDate = new Date(Date.parse(`${endDate}T00:00:00Z`) - 6 * 86400000).toISOString().slice(0,10);
  return await generateTrackingCommentary(env, current.id, { startDate, endDate, updatedAt: current.updatedAt });
}
export class PolicyCommentaryError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; this.name = "PolicyCommentaryError"; }
}
