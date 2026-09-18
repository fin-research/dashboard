import assert from "node:assert/strict";
import { installDom, loadComponent } from "./svelte-dom.mjs";

const window = installDom();
const { mount, unmount, flushSync } = await import("svelte");
const streams = [];
globalThis.fetch = async (_url, init) => {
  assert.equal(new Headers(init.headers).get("accept"), "text/event-stream");
  const stream = { cancelled: false };
  const body = new ReadableStream({
    start(controller) { stream.controller = controller; },
    cancel() { stream.cancelled = true; },
  });
  stream.emit = (event, value) => stream.controller.enqueue(new TextEncoder().encode(
    `event: ${event}\ndata: ${event === "result" ? JSON.stringify(value) : value}\n\n`,
  ));
  streams.push(stream);
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
};

const Host = await loadComponent("tests/helpers/AiPanelHost.svelte", `<script>
  import AiPanel from "../../src/lib/AiPanel.svelte";
  import { createAiClient, provideAiClient } from "../../src/lib/ai-client.svelte";
  const client = provideAiClient(createAiClient());
  export function run(title = "测试分析") { return client.run({ title, url: "/api/test-ai", parse: value => value }); }
</script>
<AiPanel {client} />`);

const app = mount(Host, { target: document.body });
flushSync();
assert.equal(document.querySelector("[aria-label='打开 AI 面板']").textContent.trim(), "AI");
const pending = app.run();
await new Promise(resolve => setImmediate(resolve));
flushSync();
assert.ok(document.querySelector("#global-ai-panel"));
assert.match(document.querySelector(".ai-current").textContent, /测试分析.*正在处理/s);
const secondPending = app.run("第二任务");
await new Promise(resolve => setImmediate(resolve));
flushSync();
assert.equal(document.querySelectorAll(".ai-current").length, 2, "all concurrent tasks remain visible");
streams[0].emit("progress", "正在核对材料");
streams[1].emit("progress", "正在比较结果");
await new Promise(resolve => setImmediate(resolve));
flushSync();
assert.match(document.querySelector(".ai-panel-body").textContent, /正在核对材料/);
assert.match(document.querySelector(".ai-panel-body").textContent, /正在比较结果/);
streams[0].emit("result", { ok: true });
assert.deepEqual(await pending, { ok: true });
streams[1].emit("result", { ok: "second" });
assert.deepEqual(await secondPending, { ok: "second" });
flushSync();
assert.equal(streams[0].cancelled, true);
assert.equal(streams[1].cancelled, true);
assert.equal(document.querySelector(".ai-current"), null);
const completedTrigger = document.querySelector("[aria-label='打开 AI 面板']");
assert.ok(completedTrigger, "the panel collapses after the last task completes");
completedTrigger.click();
await new Promise(resolve => setImmediate(resolve));
flushSync();
assert.match(document.querySelector(".ai-task-list").textContent, /测试分析.*已完成.*正在核对材料/s);
assert.match(document.querySelector(".ai-task-list").textContent, /第二任务.*已完成.*正在比较结果/s);
document.querySelector(".ai-panel-close").click();
await new Promise(resolve => setImmediate(resolve));
flushSync();
const trigger = document.querySelector("[aria-label='打开 AI 面板']");
assert.equal(document.activeElement, trigger);
trigger.click();
await new Promise(resolve => setImmediate(resolve));
flushSync();
document.querySelector(".ai-clear").click();
flushSync();
assert.match(document.querySelector(".ai-empty").textContent, /暂无调用记录/);
await unmount(app);
await window.happyDOM.abort();
console.log("Unified AI panel lifecycle and in-memory history passed");
