import { getContext, setContext } from "svelte";
import { readSse } from "./sse.ts";

const AI_CLIENT_CONTEXT = Symbol("ai-client");
const MAX_AI_CLIENT_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_AI_TASK_HISTORY = 50;

export type AiTaskStatus = "running" | "completed" | "failed" | "cancelled" | "disconnected";

export interface AiTaskRecord {
  id: string;
  title: string;
  status: AiTaskStatus;
  cancellable: boolean;
  startedAt: number;
  finishedAt?: number;
  progress: string[];
  error?: string;
}

export interface AiRequest<T> {
  title: string;
  url: string;
  init?: RequestInit;
  parse: (value: unknown) => T;
  signal?: AbortSignal;
  maxBytes?: number;
  cancellable?: boolean;
}

export interface AiClient {
  readonly open: boolean;
  readonly tasks: AiTaskRecord[];
  readonly activeTasks: AiTaskRecord[];
  readonly activeTask: AiTaskRecord | undefined;
  setOpen(value: boolean): void;
  clearHistory(): void;
  reset(): void;
  cancel(taskId: string): void;
  run<T>(request: AiRequest<T>): Promise<T>;
}

export function createAiClient(fetcher: typeof fetch = fetch): AiClient {
  let open = $state(false);
  let tasks = $state<AiTaskRecord[]>([]);
  const controllers = new Map<string, AbortController>();

  function update(id: string, change: (task: AiTaskRecord) => AiTaskRecord) {
    tasks = trimTaskHistory(tasks.map((task) => (task.id === id ? change(task) : task)));
  }

  function complete(id: string, status: Exclude<AiTaskStatus, "running">, error?: string) {
    controllers.delete(id);
    update(id, (task) => ({ ...task, status, finishedAt: Date.now(), ...(error ? { error } : {}) }));
  }

  const client: AiClient = {
    get open() {
      return open;
    },
    get tasks() {
      return tasks;
    },
    get activeTasks() {
      return tasks.filter((task) => task.status === "running");
    },
    get activeTask() {
      return tasks.find((task) => task.status === "running");
    },
    setOpen(value) {
      open = value;
    },
    clearHistory() {
      tasks = tasks.filter((task) => task.status === "running");
    },
    reset() {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
      tasks = [];
      open = false;
    },
    cancel(taskId) {
      if (tasks.find((task) => task.id === taskId)?.cancellable) controllers.get(taskId)?.abort();
    },
    async run<T>({ title, url, init, parse, signal, maxBytes = MAX_AI_CLIENT_RESPONSE_BYTES, cancellable = true }: AiRequest<T>): Promise<T> {
      const id = crypto.randomUUID();
      const controller = new AbortController();
      controllers.set(id, controller);
      const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      const task: AiTaskRecord = {
        id,
        title,
        status: "running",
        cancellable,
        startedAt: Date.now(),
        progress: [],
      };
      tasks = trimTaskHistory([task, ...tasks]);
      open = true;
      try {
        const headers = new Headers(init?.headers);
        headers.set("Accept", "text/event-stream");
        const response = await fetcher(url, {
          ...init,
          headers,
          signal: requestSignal,
          credentials: init?.credentials ?? "same-origin",
        });
        if (!response.ok) {
          const value: unknown = await response.json().catch(() => null);
          throw new Error(publicError(value, `AI 请求失败（HTTP ${response.status}）`));
        }
        if (!response.headers.get("content-type")?.includes("text/event-stream") || !response.body) {
          throw new Error("AI 服务未返回流式响应");
        }
        let result: T | undefined;
        await readSse(
          response.body,
          ({ event, data }) => {
            requestSignal.throwIfAborted();
            if (event === "progress") {
              update(id, (task) => ({ ...task, progress: mergeProgress(task.progress, data) }));
              return;
            }
            if (event === "result") {
              result = parse(JSON.parse(data) as unknown);
              return;
            }
            if (event === "error") throw new Error(data || "AI 请求失败");
            throw new Error(`AI 服务返回未知事件：${event}`);
          },
          maxBytes,
          { signal: requestSignal, shouldStop: () => result !== undefined },
        );
        requestSignal.throwIfAborted();
        if (result === undefined) throw new Error("AI 连接中断，请重试");
        complete(id, "completed");
        return result;
      } catch (error) {
        if (requestSignal.aborted || isAiRequestCancelled(error)) complete(id, cancellable ? "cancelled" : "disconnected");
        else complete(id, "failed", error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
  };
  return client;
}

export function provideAiClient(client: AiClient = createAiClient()): AiClient {
  setContext(AI_CLIENT_CONTEXT, client);
  return client;
}

export function useAiClient(): AiClient {
  const client = getContext<AiClient | undefined>(AI_CLIENT_CONTEXT);
  if (!client) throw new Error("AI client is not available");
  return client;
}

function mergeProgress(items: string[], next: string): string[] {
  const text = next.trim();
  if (!text) return items;
  const previous = items.at(-1);
  if (previous === text) return items;
  if (previous && text.startsWith(previous)) return [...items.slice(0, -1), text];
  return [...items, text].slice(-20);
}

function publicError(value: unknown, fallback: string): string {
  return value && typeof value === "object" && "error" in value && typeof value.error === "string"
    ? value.error
    : fallback;
}

function trimTaskHistory(records: AiTaskRecord[]): AiTaskRecord[] {
  const running = records.filter((task) => task.status === "running");
  const finished = records.filter((task) => task.status !== "running").slice(0, MAX_AI_TASK_HISTORY);
  return [...running, ...finished];
}

export function isAiRequestCancelled(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
}
