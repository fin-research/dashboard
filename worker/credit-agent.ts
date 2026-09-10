import { Agent, isDurableObjectCodeUpdateReset, isPlatformTransientError } from "agents";
import { answerCreditQuestion, recoverQueuedCreditAnswers } from "../src/lib/server/credit-assistant.ts";
import { loadCreditCorpus } from "../src/lib/server/credit-evidence.ts";
import { AiGatewayResponseError } from "../src/lib/server/ai-gateway.ts";
import { creditCustomerSelectionSchema, creditQuestionSchema, type CreditCustomer, type CreditSession, type CreditStage, type CreditCorpus } from "../src/lib/credit-assistant/types.ts";
import { findCreditCustomers } from "../src/lib/server/credit-repository.ts";
import { withPostgres } from "../src/lib/server/postgres.ts";
import { creditAnswerForTurn, discloseCreditSession, CREDIT_CUSTOMER_REQUIRED, CREDIT_NDA_REQUIRED } from "../src/lib/server/credit-confidentiality.ts";
import { CreditEventHub } from "../src/lib/server/credit-events.ts";
import { appendCreditActivity } from "../src/lib/credit-assistant/progress.ts";
import { CreditExecutionError, creditFailure } from "../src/lib/server/credit-errors.ts";
import { creditCacheParts, type CreditRunCache } from "../src/lib/server/credit-checkpoint.ts";

export class CreditAgent extends Agent<Cloudflare.Env, CreditSession> {
  initialState: CreditSession = { turns: [], running: false, progress: "", error: null, startedAt: 0, pendingQuestion: "", customer: null };
  private events = new CreditEventHub();
  private draftText = "";
  private lastDraftPush = 0;
  private activeCorpus: CreditCorpus | undefined;

  private runCache(runId: string): CreditRunCache {
    this.sql`CREATE TABLE IF NOT EXISTS credit_run_cache (run_id TEXT NOT NULL, cache_key TEXT NOT NULL, part INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY (run_id, cache_key, part))`;
    return {
      get: key => {
        const rows = this.sql<{ value: string }>`SELECT value FROM credit_run_cache WHERE run_id = ${runId} AND cache_key = ${key} ORDER BY part`;
        return rows.length ? rows.map(row => row.value).join("") : undefined;
      },
      put: (key, value) => this.ctx.storage.transactionSync(() => {
        this.sql`DELETE FROM credit_run_cache WHERE run_id = ${runId} AND cache_key = ${key}`;
        creditCacheParts(value).forEach((part, index) => {
          this.sql`INSERT INTO credit_run_cache (run_id, cache_key, part, value) VALUES (${runId}, ${key}, ${index}, ${part})`;
        });
      }),
    };
  }

  private clearRunCache() {
    if (!this.state.questionId) return;
    this.runCache(this.state.questionId);
    this.sql`DELETE FROM credit_run_cache WHERE run_id = ${this.state.questionId}`;
  }

  private save(state: CreditSession) {
    this.setState(state);
    // Apply the already-loaded submission scope to old turns too. Broadcasting
    // raw persisted state would re-expose history hidden in the initial GET.
    const visible = this.activeCorpus && state.customer ? discloseCreditSession(state, this.activeCorpus, state.customer)
      : { ...state, turns: [] };
    this.events.send("session", { ...visible, draftText: this.draftText });
    if (!state.running) this.events.finish();
  }

  private progress(progress: string, stage?: CreditStage) {
    const currentStage = stage ?? this.state.stage ?? "analysis";
    this.save({ ...this.state, progress, stage: currentStage,
      activities: appendCreditActivity(this.state, progress, currentStage) });
  }

  private draft(text: string) {
    this.draftText = text;
    // Send at most ten snapshots a second without a SQLite write per token.
    if (!text || Date.now() - this.lastDraftPush >= 100) {
      this.lastDraftPush = Date.now();
      this.events.send("draft", { text, questionId: this.state.questionId });
    }
  }

  private async customer(name: string): Promise<CreditCustomer | null> {
    return withPostgres(this.env.HYPERDRIVE.connectionString, "credit-disclosure",
      async client => (await findCreditCustomers(client, name, true))[0] ?? null);
  }

  private async visibleState(verifiedCustomer?: CreditCustomer): Promise<CreditSession> {
    if (!this.state.customer) return { ...this.initialState, turns: [],
      error: this.state.turns.length || this.state.pendingQuestion ? "旧对话尚未绑定客户，请新建对话并选择机构。" : null };
    // Empty, idle sessions contain no material to disclose. Selection is local;
    // only content access and generation need a fresh business authorization.
    if (!this.state.turns.length && !this.state.running) return this.state;
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
    if (request.method === "GET") {
      const state = await this.visibleState();
      if (new URL(request.url).pathname.endsWith("/events") && state.running
        && this.state.customer?.confidentialityStatus === true && state.customer?.confidentialityStatus !== true) {
        return Response.json({ error: CREDIT_NDA_REQUIRED }, { status: 403 });
      }
      return new URL(request.url).pathname.endsWith("/events")
        ? this.events.response({ ...state, draftText: this.draftText }, () => { this.sql`SELECT 1`; }) : Response.json(state);
    }
    if (request.method === "DELETE") {
      if (this.state.running) return Response.json({ error: "当前问答仍在处理中" }, { status: 409 });
      this.clearRunCache();
      this.draftText = "";
      this.save({ ...this.initialState, turns: [], customer: this.state.customer, conversationId: crypto.randomUUID() });
      return Response.json(this.state);
    }
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (this.state.running && new URL(request.url).pathname.endsWith("/institution")) {
      return Response.json(await this.visibleState());
    }
    if (this.state.running) return Response.json({ error: "请等待当前答复完成" }, { status: 409 });
    const selection = new URL(request.url).pathname.endsWith("/institution");
    const newSession = new URL(request.url).pathname.endsWith("/new");
    if (!selection && !newSession && (this.state.turns.length >= 30 || new TextEncoder().encode(JSON.stringify(this.state)).byteLength > 1_000_000)) {
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
    if (newSession) {
      if (this.state.turns.length || this.state.pendingQuestion) {
        this.sql`CREATE TABLE IF NOT EXISTS credit_conversation_archive (id TEXT PRIMARY KEY, state TEXT NOT NULL)`;
        this.sql`INSERT INTO credit_conversation_archive (id, state) VALUES (${this.state.conversationId ?? crypto.randomUUID()}, ${JSON.stringify(this.state)})`;
      }
      this.clearRunCache();
      this.draftText = "";
      this.save({ ...this.initialState, turns: [], customer, conversationId: crypto.randomUUID() });
      return Response.json(this.state);
    }
    if (selection) {
      this.save({ ...this.state, customer, conversationId: this.state.conversationId ?? crypto.randomUUID() });
      return Response.json(await this.visibleState(customer));
    }
    const parsed = creditQuestionSchema.safeParse(input);
    if (!parsed.success) return Response.json({ error: "请输入问题，并选择客户机构。" }, { status: 400 });
    const id = crypto.randomUUID();
    this.runCache(id); // Initialise before dropping only the previous run's temporary checkpoints.
    this.clearRunCache();
    this.draftText = "";
    this.activeCorpus = undefined;
    const progress = "正在判断问题范围";
    this.save({ ...this.state, customer, conversationId: this.state.conversationId ?? crypto.randomUUID(), running: true, progress, stage: "scope",
      activities: appendCreditActivity({ ...this.state, activities: [] }, progress, "scope"),
      questionId: id, error: null, startedAt: Date.now(), pendingQuestion: parsed.data.question });
    try {
      await this.schedule(1, "answerQuestion", { question: parsed.data.question, id }, { idempotent: true });
    } catch {
      this.save({ ...this.state, running: false, progress: "", error: "问答任务创建失败，请重试" });
      return Response.json({ error: this.state.error }, { status: 503 });
    }
    return Response.json(await this.visibleState(customer), { status: 202 });
  }

  async answerQuestion(payload: { question: string; id: string }): Promise<void> {
    if (this.state.turns.some(t => t.id === payload.id)) return;
    if (!this.state.running || (this.state.questionId && this.state.questionId !== payload.id) || this.state.pendingQuestion !== payload.question || !this.state.customer) return;
    const started = Date.now();
    let modelCalls = 0, searchCalls = 0;
    try {
      if (Date.now() - this.state.startedAt >= 12 * 60_000) throw new CreditExecutionError("deadline", "本次核对已达到总时限");
      // Submission verified this customer. The running turn uses that snapshot.
      const customer = this.state.customer;
      const corpus = await loadCreditCorpus(this.env.CREDIT).catch(() => { throw new CreditExecutionError("materials", "材料目录加载失败"); });
      this.activeCorpus = corpus;
      console.log(JSON.stringify({ event: "credit_materials_loaded", run_id: payload.id, elapsed_ms: Date.now() - started }));
      const generated = await answerCreditQuestion({ question: payload.question, corpus, customer, history: this.state.turns,
        credentials: { accountId: this.env.CLOUDFLARE_ACCOUNT_ID, gatewayId: this.env.AI_GATEWAY_ID, token: this.env.CF_AIG_TOKEN },
        progress: (progress, stage) => this.progress(progress, stage),
        draft: text => this.draft(text),
        runId: payload.id,
        cache: this.runCache(payload.id), startedAt: this.state.startedAt,
        operation: operation => {
          if (operation.operation === "search") searchCalls += operation.outcome === "cache" ? 0 : 1;
          else modelCalls += operation.outcome === "cache" ? 0 : 1;
          console.log(JSON.stringify({ event: "credit_operation", run_id: payload.id, ...operation }));
        },
        semanticSearch: async query => {
          const result = await this.env.CREDIT_SEARCH.search({ query, ai_search_options: {
            retrieval: { retrieval_type: "hybrid", max_num_results: 50 },
            query_rewrite: { enabled: false }, cache: { enabled: false },
          } });
          return result.chunks.map(c => ({ id: c.id, key: c.item.key, text: c.text }));
        },
      });
      const answer = creditAnswerForTurn(generated, payload.id);
      console.log(JSON.stringify({ event: "credit_answer_completed", run_id: payload.id, elapsed_ms: Date.now() - started,
        model_calls: modelCalls, search_calls: searchCalls, answer_status: answer.status }));
      this.draftText = "";
      this.save({ ...this.state, turns: [...this.state.turns, { id: payload.id, question: payload.question, answer, createdAt: answer.createdAt }],
        running: false, progress: "", error: null, pendingQuestion: "" });
    } catch (error) {
      // The SDK preserves one-shot schedules across platform resets. Do not
      // turn a deploy interruption into a failed user answer or write to a dead isolate.
      if (!(error instanceof AiGatewayResponseError) && isPlatformTransientError(error)) {
        console.warn(JSON.stringify({ event: "credit_answer_recovering", run_id: payload.id,
          reason: isDurableObjectCodeUpdateReset(error) ? "code_updated" : "platform_reset" }));
        this.events.finish();
        throw error;
      }
      const failure = creditFailure(error);
      console.error(JSON.stringify({ event: "credit_answer_failed", run_id: payload.id, code: failure.code,
        stage: this.state.stage, elapsed_ms: Date.now() - started, model_calls: modelCalls, search_calls: searchCalls,
        error_type: error instanceof Error ? error.name : "unknown",
        ...(error instanceof AiGatewayResponseError ? { provider: error.provider, status: error.status, gateway_log_id: error.gatewayLogId,
        } : {}),
      }));
      const message = `${failure.message}（错误编号：${payload.id}）`;
      this.draftText = "";
      this.save({ ...this.state, running: false, progress: "", error: message });
    }
  }
}
