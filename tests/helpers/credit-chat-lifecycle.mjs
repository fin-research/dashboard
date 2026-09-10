import assert from "node:assert/strict";
import { installDom, loadComponent } from "./svelte-dom.mjs";

const window = installDom();
const { mount, unmount, flushSync, tick } = await import("svelte");
const session = { turns: [], running: false, progress: "", error: null, startedAt: 0 };
const pending = [];
globalThis.fetch = async () => new Promise(resolve => pending.push(() => resolve(Response.json(session))));

const Host = await loadComponent("tests/helpers/ChatHost.svelte", `<script>
  import CreditAssistantView from "../../src/lib/credit-assistant/CreditAssistantView.svelte";
  let view = $state("assistant");
  let customers = [{ name: "测试银行", confidentialityStatus: false, reportDate: "2026-09-09" }];
  export function changeView(next) { view = next; }
</script>
<div class="tr-workbench">
  <header><div id="tr-topbar-actions"></div></header>
  <section class="tr-workspace"><main>
    {#if view === "assistant"}<CreditAssistantView customerOptions={customers} />{:else}<section data-view={view}>其他标签页</section>{/if}
  </main></section>
</div>`);
const app = mount(Host, { target: document.body });
flushSync();
for (const next of ["calendar", "weekly", "overview"]) {
  assert.equal(document.querySelectorAll(".credit-chat").length, 1);
  assert.equal(document.querySelectorAll("#tr-topbar-actions .chat-toolbar").length, 1);
  flushSync(() => app.changeView(next));
  assert.equal(document.querySelectorAll(".credit-chat, #credit-question, #credit-customer").length, 0, "previous chat must be removed");
  assert.equal(document.querySelectorAll("#tr-topbar-actions .chat-toolbar").length, 0);
  assert.equal(document.querySelector(`[data-view="${next}"]`)?.textContent, "其他标签页");
  pending.splice(0).forEach(resolve => resolve());
  await tick();
  assert.equal(document.querySelectorAll(".credit-chat").length, 0, "late network completion must not restore chat");
  flushSync(() => app.changeView("assistant"));
}
await unmount(app);
pending.splice(0).forEach(resolve => resolve());
await tick();
assert.equal(document.querySelectorAll(".credit-chat, .chat-toolbar, .tr-workbench").length, 0);

// Exercise the real component with a controllable SSE transport. No browser or
// authentication flow is involved in this DOM lifecycle regression.
globalThis.localStorage = window.localStorage;
localStorage.setItem("credit-assistant:institution", "测试银行");
const streams = [];
globalThis.EventSource = class {
  constructor(url) { this.url = url; this.listeners = new Map(); this.closed = false; streams.push(this); }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  close() { this.closed = true; }
  emit(name, value) { this.listeners.get(name)?.({ data: JSON.stringify(value) }); }
};
const customer = { name: "测试银行", confidentialityStatus: false, reportDate: "2026-09-09" };
const activities = [{ id: 1, stage: "retrieval", message: "正在检索材料", startedAt: Date.now() }];
const running = { ...session, running: true, questionId: "q-1", pendingQuestion: "公司资产是多少", customer, stage: "retrieval", progress: "正在检索材料", activities };
const requests = [];
globalThis.fetch = async (url, options) => { requests.push({ url, options }); return Response.json(running); };
const streamingApp = mount(Host, { target: document.body });
flushSync();
await new Promise(resolve => setImmediate(resolve));
flushSync();
assert.equal(streams.length, 1);
assert.match(streams[0].url, /session\/events\?institutionName=/);
assert.equal(document.querySelector(".credit-stages"), null);
assert.match(document.querySelector(".activity-summary").textContent, /检索材料/);
assert.equal(document.querySelector(".activity-details").open, false);
document.querySelector(".activity-details").open = true;
assert.equal(document.querySelector("#credit-question").hasAttribute("maxlength"), false);
streams[0].emit("draft", { questionId: "other-question", text: "迟到的旧内容" });
flushSync();
assert.equal(document.querySelector(".streaming-answer"), null);
streams[0].emit("draft", { questionId: "q-1", text: "公司资产100亿元。" });
flushSync();
assert.match(document.querySelector(".streaming-answer").textContent, /公司资产100亿元/);
activities.push({ id: 2, stage: "review", message: "正在复核", startedAt: Date.now() });
streams[0].emit("session", { ...running, stage: "review", progress: "正在复核", activities, draftText: "公司资产100亿元。" });
flushSync();
assert.match(document.querySelector(".activity-summary").textContent, /复核答复/);
activities.push({ id: 3, stage: "retrieval", message: "正在补充查证", startedAt: Date.now() });
streams[0].emit("session", { ...running, activities, draftText: "" });
flushSync();
assert.match(document.querySelector(".activity-summary").textContent, /检索材料 · 第 2 轮/);
assert.equal(document.querySelector(".activity-details").open, true, "SSE preserves disclosure state");
assert.deepEqual([...document.querySelectorAll(".activity-label")].map(node => node.textContent), ["检索材料", "复核答复", "检索材料 · 第 2 轮"]);
assert.equal(document.querySelector(".streaming-answer"), null, "rejected draft is cleared before further retrieval");
assert.equal(requests.length, 1, "SSE updates must not trigger polling");
flushSync(() => streamingApp.changeView("weekly"));
assert.equal(streams[0].closed, true);
streams[0].emit("draft", { questionId: "q-1", text: "迟到响应" });
flushSync();
assert.equal(document.querySelector(".streaming-answer"), null);
flushSync(() => streamingApp.changeView("assistant"));
await new Promise(resolve => setImmediate(resolve));
flushSync();
assert.equal(streams.length, 2, "remount resumes the same customer session");
streams[1].emit("session", { ...running, running: false, pendingQuestion: "", error: "模型暂不可用", draftText: "" });
flushSync();
assert.equal(streams[1].closed, true);
assert.match(document.querySelector(".answer-error").textContent, /模型暂不可用/);
await unmount(streamingApp);
await window.happyDOM.abort();
console.log("Credit chat lifecycle, SSE phases/drafts, reconnect and late responses passed");
