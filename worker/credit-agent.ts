import { Agent } from "agents";
import { answerCreditQuestion, recoverQueuedCreditAnswers } from "../src/lib/server/credit-assistant.ts";
import { loadCreditCorpus } from "../src/lib/server/credit-evidence.ts";
import { AiGatewayResponseError } from "../src/lib/server/ai-gateway.ts";
import { creditCustomerSelectionSchema, creditQuestionSchema, type CreditCustomer, type CreditSession } from "../src/lib/credit-assistant/types.ts";
import { findCreditCustomers } from "../src/lib/server/credit-repository.ts";
import { withPostgres } from "../src/lib/server/postgres.ts";
import { canProvideCreditAnswer, creditAnswerForTurn, creditNdaRefusal, discloseCreditSession, CREDIT_CUSTOMER_REQUIRED } from "../src/lib/server/credit-confidentiality.ts";

export class CreditAgent extends Agent<Cloudflare.Env, CreditSession> {
  initialState: CreditSession = { turns: [], running: false, progress: "", error: null, startedAt: 0, pendingQuestion: "", customer: null };

  private async customer(name: string): Promise<CreditCustomer | null> {
    return withPostgres(this.env.HYPERDRIVE.connectionString, "credit-disclosure",
      async client => (await findCreditCustomers(client, name, true))[0] ?? null);
  }

  private async visibleState(verifiedCustomer?: CreditCustomer): Promise<CreditSession> {
    if (!this.state.customer) return { ...this.initialState, turns: [],
      error: this.state.turns.length || this.state.pendingQuestion ? "旧对话尚未绑定客户，请新建对话并选择机构。" : null };
    const customer = verifiedCustomer ?? await this.customer(this.state.customer.name)
      ?? { ...this.state.customer, confidentialityStatus: false as const };
    if (!this.state.turns.length) return { ...this.state, customer };
    const corpus = await loadCreditCorpus(this.env.CREDIT);
    return discloseCreditSession(this.state, corpus, customer);
  }

  async onStart(): Promise<void> {
    const question = this.state.pendingQuestion;
    if (!this.state.running || !question) return;
    if (!this.state.customer) {
      this.setState({ ...this.state, running: false, progress: "", pendingQuestion: "", error: CREDIT_CUSTOMER_REQUIRED });
      return;
    }
    await recoverQueuedCreditAnswers(this.getQueues("question", question),
      payload => this.schedule(1, "answerQuestion", payload, { idempotent: true }),
      id => this.dequeue(id));
  }

  async onRequest(request: Request): Promise<Response> {
    if (request.method === "GET") return Response.json(await this.visibleState());
    if (request.method === "DELETE") {
      if (this.state.running) return Response.json({ error: "当前问答仍在处理中" }, { status: 409 });
      this.setState({ ...this.initialState, turns: [] });
      return Response.json(this.state);
    }
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (this.state.running) return Response.json({ error: "请等待当前答复完成" }, { status: 409 });
    const selection = new URL(request.url).pathname.endsWith("/institution");
    if (!selection && (this.state.turns.length >= 30 || new TextEncoder().encode(JSON.stringify(this.state)).byteLength > 1_000_000)) {
      return Response.json({ error: "本会话已达容量上限，请新建会话" }, { status: 409 });
    }
    const input: unknown = await request.json();
    const selected = creditCustomerSelectionSchema.safeParse(selection ? input :
      input && typeof input === "object" && "institutionName" in input ? { institutionName: input.institutionName } : {});
    if (!selected.success) return Response.json({ error: CREDIT_CUSTOMER_REQUIRED }, { status: 400 });
    const customer = await this.customer(selected.data.institutionName);
    if (!customer) return Response.json({ error: "最新授信记录中未找到该机构，请重新搜索并选择。" }, { status: 404 });
    // The database lookup yields to other requests: recheck mutable state afterwards.
    if (this.state.running) return Response.json({ error: "请等待当前答复完成" }, { status: 409 });
    if ((this.state.customer && this.state.customer.name !== customer.name)
      || (!this.state.customer && (this.state.turns.length || this.state.pendingQuestion))) {
      return Response.json({ error: "切换客户需新建对话。" }, { status: 409 });
    }
    if (selection) {
      this.setState({ ...this.state, customer });
      return Response.json(await this.visibleState(customer));
    }
    const parsed = creditQuestionSchema.safeParse(input);
    if (!parsed.success) return Response.json({ error: "请输入1至3000字的问题，并选择客户机构。" }, { status: 400 });
    if (!this.state.customer) return Response.json({ error: CREDIT_CUSTOMER_REQUIRED }, { status: 400 });
    const id = crypto.randomUUID();
    this.setState({ ...this.state, customer, running: true, progress: "已收到问题，正在核对客户保密协议与材料", error: null, startedAt: Date.now(), pendingQuestion: parsed.data.question });
    try {
      await this.schedule(1, "answerQuestion", { question: parsed.data.question, id }, { idempotent: true });
    } catch {
      this.setState({ ...this.state, running: false, progress: "", error: "问答任务创建失败，请重试" });
      return Response.json({ error: this.state.error }, { status: 503 });
    }
    return Response.json(await this.visibleState(customer), { status: 202 });
  }

  async answerQuestion(payload: { question: string; id: string }): Promise<void> {
    if (this.state.turns.some(t => t.id === payload.id)) return;
    if (!this.state.running || this.state.pendingQuestion !== payload.question || !this.state.customer) return;
    try {
      const customer = await this.customer(this.state.customer.name);
      if (!customer) throw new Error("Credit customer no longer exists");
      const corpus = await loadCreditCorpus(this.env.CREDIT);
      const generated = await answerCreditQuestion({ question: payload.question, corpus, customer, history: this.state.turns,
        credentials: { accountId: this.env.CLOUDFLARE_ACCOUNT_ID, gatewayId: this.env.AI_GATEWAY_ID, token: this.env.CF_AIG_TOKEN },
        progress: progress => this.setState({ ...this.state, progress }),
        semanticSearch: async query => {
          const result = await this.env.CREDIT_SEARCH.search({ query, ai_search_options: {
            retrieval: { retrieval_type: "hybrid", max_num_results: 50 },
            query_rewrite: { enabled: false }, cache: { enabled: false },
          } });
          return result.chunks.map(c => ({ key: c.item.key, text: c.text }));
        },
      });
      // Re-read both sources of authority after the long model call, before saving.
      const latestCustomer = await this.customer(customer.name);
      const latestCorpus = await loadCreditCorpus(this.env.CREDIT);
      const answer = creditAnswerForTurn(canProvideCreditAnswer(generated, latestCorpus, latestCustomer)
        ? generated : creditNdaRefusal(latestCorpus, latestCustomer ?? { ...customer, confidentialityStatus: false }), payload.id);
      this.setState({ ...this.state, turns: [...this.state.turns, { id: payload.id, question: payload.question, answer, createdAt: answer.createdAt }],
        customer: latestCustomer ?? { ...customer, confidentialityStatus: false }, running: false, progress: "", error: null, pendingQuestion: "" });
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
