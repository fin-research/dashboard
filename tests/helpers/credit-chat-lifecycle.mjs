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
  export function changeView(next) { view = next; }
</script>
<div class="tr-workbench">
  <header><div id="tr-topbar-actions"></div></header>
  <section class="tr-workspace"><main>
    {#if view === "assistant"}<CreditAssistantView />{:else}<section data-view={view}>其他标签页</section>{/if}
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
await window.happyDOM.abort();
console.log("Credit chat mount/switch/unmount and late responses passed");
