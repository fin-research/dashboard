import assert from "node:assert/strict";
import { installDom, loadComponent } from "./svelte-dom.mjs";

const window = installDom();
const { mount, unmount, flushSync, tick } = await import("svelte");
let reportRequests = 0;
globalThis.fetch = async url => {
  if (String(url) === "/auth/session") return Response.json({ user: null, account: null });
  if (String(url).startsWith("/api/credit-assistant/")) return Response.json({ turns: [], running: false, progress: "", error: null, startedAt: 0 });
  reportRequests++;
  return Response.json({ error: "尚未装载报表" }, { status: 503 });
};
const Host = await loadComponent("tests/helpers/CreditWorkspaceHost.svelte", `<script>
  import CreditWorkbenchPage from "../../src/lib/credit-workbench/CreditWorkbenchPage.svelte";
  import WorkbenchShell from "../../src/lib/workbench/WorkbenchShell.svelte";
  let view = $state("assistant");
  let workspace = $state("credit");
  export function navigate(next) { view = next; }
  export function openWorkspace(next) { workspace = next; }
</script>
{#if workspace === "credit"}<CreditWorkbenchPage viewId={view} />
{:else}<WorkbenchShell title="交易研究工作台" homeHref="/trading-research" activeViewId="overview"
  views={[{id:"overview",label:"总览",icon:"overview",href:"/trading-research"}]}><p>交易研究内容</p></WorkbenchShell>{/if}`);
const app = mount(Host, { target: document.body });
flushSync();
assert.equal(document.querySelector(".tr-breadcrumb a").textContent, "授信工作台");
assert.deepEqual([...document.querySelectorAll(".tr-drawer__nav a")].map(a => [a.textContent.trim(), a.getAttribute("href")]), [
  ["授信一览表", "/credit-workbench"], ["授信日历", "/credit-workbench/calendar"],
  ["授信周报", "/credit-workbench/weekly"], ["授信问答", "/credit-workbench/assistant"],
]);
assert.equal(document.querySelector("h1").textContent, "授信问答");
assert.equal(document.querySelector("main").classList.contains("tr-chat-page"), true);
flushSync(() => app.navigate("calendar"));
const reportView = document.querySelector(".tr-credit-view");
assert.ok(reportView);
assert.equal(document.querySelector(".credit-chat"), null);
assert.equal(document.querySelector(".chat-toolbar"), null);
assert.equal(document.querySelector("h1").textContent, "授信日历");
assert.equal(document.querySelector("main").classList.contains("tr-chat-page"), false);
assert.equal(document.querySelectorAll("#tr-topbar-actions .tr-credit-toolbar").length, 1);
for (const [view, label] of [["weekly", "授信周报"], ["overview", "授信一览表"]]) {
  flushSync(() => app.navigate(view));
  assert.equal(document.querySelector(".tr-credit-view"), reportView, "report tabs must preserve their loaded data and editor instance");
  assert.equal(document.querySelector("h1").textContent, label);
  assert.equal(document.querySelectorAll("#tr-topbar-actions .tr-credit-toolbar").length, 1);
}
await tick();
assert.equal(reportRequests, 1);
flushSync(() => app.navigate("assistant"));
assert.equal(document.querySelectorAll(".credit-chat").length, 1);
assert.equal(document.querySelector(".tr-credit-view"), null);
assert.equal(document.querySelectorAll("#tr-topbar-actions .chat-toolbar").length, 1);
assert.equal(document.querySelector(".tr-credit-toolbar"), null);
flushSync(() => app.openWorkspace("trading"));
assert.equal(document.querySelectorAll(".tr-workbench").length, 1);
assert.equal(document.querySelectorAll(".credit-chat, .chat-toolbar").length, 0);
flushSync(() => app.openWorkspace("credit"));
assert.equal(document.querySelectorAll("#tr-topbar-actions").length, 1);
assert.equal(document.querySelectorAll("#tr-topbar-actions .chat-toolbar").length, 1);
assert.equal(document.querySelectorAll(".credit-chat").length, 1);
await unmount(app);
await tick();
assert.equal(document.querySelectorAll(".tr-workbench, .chat-toolbar, .tr-credit-toolbar").length, 0);

globalThis.domNavigations = [];
window.location.href = "http://localhost/policy-tracking?category=monetary#policy-existing";
const Redirect = await loadComponent("src/lib/pages/LegacyWorkbenchRedirect.svelte");
const redirect = mount(Redirect, { target: document.body, props: { to: "/trading-research/policy-tracking" } });
flushSync();
assert.deepEqual(globalThis.domNavigations, [{ url: "/trading-research/policy-tracking?category=monetary#policy-existing", options: { replaceState: true } }]);
await unmount(redirect);

const { load: loadCredit } = await import("../../src/routes/credit-workbench/[[view]]/+page.ts");
const { load: loadTrading } = await import("../../src/routes/trading-research/[view]/+page.ts");
const { workbenchViews } = await import("../../src/lib/trading-research/demo-data.ts");
const { load: loadOldAssistant } = await import("../../src/routes/credit-assistant/+page.ts");
const url = new URL("http://localhost/trading-research/credit?date=2026-09-04");
for (const view of [undefined, "calendar", "weekly", "assistant"]) {
  assert.deepEqual(loadCredit({ params: { view }, url }), { view: view ?? "overview" });
}
for (const view of workbenchViews.filter(v => v.id !== "overview")) {
  assert.deepEqual(loadTrading({ params: { view: view.id }, url }), { view: view.id });
}
assert.throws(() => loadTrading({ params: { view: "credit" }, url }), error => error.status === 307 && error.location === "/credit-workbench?date=2026-09-04");
assert.throws(() => loadTrading({ params: { view: "credit-assistant" }, url }), error => error.status === 307 && error.location === "/credit-workbench/assistant?date=2026-09-04");
assert.throws(() => loadOldAssistant(), error => error.status === 307 && error.location === "/credit-workbench/assistant");
assert.throws(() => loadCredit({ params: { view: "missing" }, url }), error => error.status === 404);
assert.throws(() => loadTrading({ params: { view: "missing" }, url }), error => error.status === 404);
await window.happyDOM.abort();
console.log("Shared shell, credit route transitions, state preservation and legacy anchors passed");
