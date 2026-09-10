import assert from "node:assert/strict";
import { installDom, loadComponent } from "./svelte-dom.mjs";

const window = installDom();
globalThis.localStorage = window.localStorage;
const { mount, unmount, flushSync } = await import("svelte");
const Assistant = await loadComponent("src/lib/credit-assistant/CreditAssistantView.svelte");
const customers = [
  { name: "银行甲", confidentialityStatus: true, reportDate: "2026-09-09" },
  { name: "银行乙", confidentialityStatus: false, reportDate: "2026-09-09" },
  ...Array.from({ length: 35 }, (_, i) => ({ name: `测试机构${i}`, confidentialityStatus: false, reportDate: "2026-09-09" })),
];
const empty = { turns: [], running: false, progress: "", error: null, startedAt: 0 };
const requests = [];
globalThis.fetch = (url, options) => new Promise(resolve => requests.push({ url: String(url), options, resolve }));
const settle = async () => { await new Promise(resolve => setImmediate(resolve)); flushSync(); };
function input(selector, value) {
  const element = document.querySelector(selector);
  flushSync(() => { element.value = value; element.dispatchEvent(new Event("input", { bubbles: true })); });
}
function choose(name) {
  input("#credit-customer", name);
  flushSync(() => document.querySelector("#credit-customer").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  flushSync(() => document.querySelector("#credit-customer").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
}

const app = mount(Assistant, { target: document.body, props: { customerOptions: customers } });
flushSync();
assert.equal(requests.length, 0, "a loaded institution list and no selection require no request");
for (const query of ["银", "银行", "测试机构34"]) input("#credit-customer", query);
assert.equal(document.querySelectorAll("[role=option]").length, 1);
assert.match(document.querySelector("[role=option]").textContent, /测试机构34/);
assert.equal(requests.length, 0, "typing must never query the backend, including a name beyond the first 20");
input("#credit-question", "保留我的草稿");
choose("银行甲");
assert.equal(requests.length, 1);
assert.match(requests[0].url, /\/session\?institutionName=/);
assert.equal(requests[0].options.method, undefined, "selection does not POST or check NDA separately");
assert.match(document.querySelector(".customer-status").textContent, /^已签署/);
assert.equal(document.querySelector("#credit-question").disabled, false);
assert.equal(document.querySelector(".chat-button--send").disabled, false, "history loading must not block sending");
choose("银行乙");
assert.match(document.querySelector(".customer-status").textContent, /^未签署/);
assert.equal(document.querySelector("#credit-question").value, "保留我的草稿");
assert.equal(requests[0].options.signal.aborted, true);
requests[0].resolve(Response.json({ ...empty, customer: customers[0], error: "旧客户内容不得出现" }));
await settle();
assert.equal(document.querySelector("#credit-customer").value, "银行乙");
assert.equal(document.body.textContent.includes("旧客户内容不得出现"), false);
flushSync(() => document.querySelector(".chat-composer").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
assert.equal(requests.length, 3);
assert.deepEqual(JSON.parse(requests[2].options.body), { question: "保留我的草稿", institutionName: "银行乙" });
assert.equal(requests[1].options.signal.aborted, true);
requests[2].resolve(Response.json({ ...empty, customer: customers[1], error: "测试任务结束" }));
requests[1].resolve(Response.json({ ...empty, customer: customers[1], error: "迟到历史不得覆盖答复" }));
await settle();
assert.match(document.querySelector(".answer-error").textContent, /测试任务结束/);
assert.equal(document.body.textContent.includes("迟到历史不得覆盖答复"), false);
await unmount(app);

// Cold entry loads one minimal list; subsequent keystrokes remain local.
localStorage.clear(); requests.length = 0;
const cold = mount(Assistant, { target: document.body }); flushSync();
assert.equal(requests.length, 1); assert.match(requests[0].url, /\/institutions$/);
requests[0].resolve(Response.json({ institutions: customers })); await settle();
input("#credit-customer", "测试机构34");
assert.equal(requests.length, 1);
assert.equal(document.querySelectorAll("[role=option]").length, 1);
await unmount(cold);

// Exercise the actual parent/child data sharing, not just an injected picker prop.
localStorage.clear();
const workbenchRequests = [];
const summary = { reportDate: "2026-09-09", institutionCount: 1, approvedCount: 0, totalLimit: 0, totalUsed: 0,
  totalAvailable: 0, utilization: 0, expiringWithin30Days: 0 };
globalThis.fetch = async url => {
  workbenchRequests.push(String(url));
  if (String(url) === "/auth/session") return Response.json({ user: null, account: null });
  assert.equal(String(url), "/api/credit", "switching to assistant must reuse the already-loaded report");
  return Response.json({ availableDates: ["2026-09-09"], previousDate: null, summary, previousSummary: null,
    weeklySummary: { ...summary, addedInstitutionCount: 0, expiredInstitutionCount: 0 }, previousWeeklySummary: null,
    institutions: [{ institutionName: "已加载机构", confidentialityStatus: true, institutionType: "股份行", status: "applying", items: [] }],
    weeklyNews: [], recentApprovals: [], limitChanges: [], usageChanges: [], calendarEvents: [] });
};
const Host = await loadComponent("tests/helpers/CreditCustomerHost.svelte", `<script>
  import CreditWorkbenchPage from "../../src/lib/credit-workbench/CreditWorkbenchPage.svelte";
  let view = $state("calendar");
  export function navigate(next) { view = next; }
</script><CreditWorkbenchPage viewId={view} />`);
const workbench = mount(Host, { target: document.body }); flushSync(); await settle();
assert.equal(workbenchRequests.filter(url => url === "/api/credit").length, 1);
flushSync(() => workbench.navigate("assistant")); await settle();
input("#credit-customer", "已加载");
assert.match(document.querySelector("[role=option]").textContent, /已加载机构.*已签署保密协议/);
assert.equal(workbenchRequests.some(url => url.includes("credit-assistant")), false);
await unmount(workbench);
await window.happyDOM.abort();
console.log("Local institution search, immediate selection, first submit and stale-response isolation passed");
