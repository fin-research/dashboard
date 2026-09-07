import { Agent } from "agents";
import { z } from "zod";
import { answerCreditQuestion } from "../src/lib/server/credit-assistant.ts";
import { loadCreditCorpus } from "../src/lib/server/credit-evidence.ts";
import { AiGatewayResponseError } from "../src/lib/server/ai-gateway.ts";
import type { CreditSession } from "../src/lib/credit-assistant/types.ts";

const questionSchema = z.object({ question: z.string().trim().min(1).max(3000) });

export class CreditAgent extends Agent<Cloudflare.Env, CreditSession> {
  initialState: CreditSession = { turns: [], running: false, progress: "", error: null, startedAt: 0, pendingQuestion: "" };

  async onRequest(request: Request): Promise<Response> {
    if (request.method === "GET") return Response.json(this.state);
    if (request.method === "DELETE") {
      if (this.state.running) return Response.json({ error: "当前问答仍在处理中" }, { status: 409 });
      this.setState({ ...this.initialState, turns: [] });
      return Response.json(this.state);
    }
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (this.state.running) return Response.json({ error: "请等待当前答复完成" }, { status: 409 });
    if (this.state.turns.length >= 30 || new TextEncoder().encode(JSON.stringify(this.state)).byteLength > 1_000_000) {
      return Response.json({ error: "本会话已达容量上限，请新建会话" }, { status: 409 });
    }
    const parsed = questionSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "请输入1至3000字的授信问题" }, { status: 400 });
    const id = crypto.randomUUID();
    this.setState({ ...this.state, running: true, progress: "已收到问题，正在读取材料", error: null, startedAt: Date.now(), pendingQuestion: parsed.data.question });
    try {
      await this.queue("answerQuestion", { question: parsed.data.question, id });
    } catch {
      this.setState({ ...this.state, running: false, progress: "", error: "问答任务创建失败，请重试" });
      return Response.json({ error: this.state.error }, { status: 503 });
    }
    return Response.json(this.state, { status: 202 });
  }

  async answerQuestion(payload: { question: string; id: string }): Promise<void> {
    if (this.state.turns.some(t => t.id === payload.id)) return;
    try {
      const corpus = await loadCreditCorpus(this.env.CREDIT);
      const answer = await answerCreditQuestion({ question: payload.question, corpus, history: this.state.turns,
        credentials: { accountId: this.env.CLOUDFLARE_ACCOUNT_ID, gatewayId: this.env.AI_GATEWAY_ID, token: this.env.CF_AIG_TOKEN },
        progress: progress => this.setState({ ...this.state, progress }),
        semanticSearch: async query => {
          const result = await this.env.CREDIT_SEARCH.search({ query, ai_search_options: {
            retrieval: { retrieval_type: "hybrid", max_num_results: 50 },
            query_rewrite: { enabled: false }, cache: { enabled: false },
          } });
          return result.chunks.map(c => c.item.key);
        },
      });
      this.setState({ ...this.state, turns: [...this.state.turns, { id: payload.id, question: payload.question, answer, createdAt: answer.createdAt }],
        running: false, progress: "", error: null, pendingQuestion: "" });
    } catch (error) {
      console.error(JSON.stringify({ event: "credit_answer_failed", error_type: error instanceof Error ? error.name : "unknown",
        ...(error instanceof AiGatewayResponseError ? { provider: error.provider, status: error.status, gateway_log_id: error.gatewayLogId,
          detail: (this.env.CF_AIG_TOKEN ? error.message.replaceAll(this.env.CF_AIG_TOKEN, "[secret]") : error.message).slice(0, 500) } : {}),
      }));
      const message = error instanceof AiGatewayResponseError && error.status === 429
        ? "指定模型服务暂时繁忙或额度受限，请稍后重试。管理员可检查 codex 上游的额度与凭证状态。"
        : "本次答复未完成，请重试。若持续失败，请检查材料索引和 AI Gateway 配置。";
      this.setState({ ...this.state, running: false, progress: "", error: message });
    }
  }
}
