import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { installDom, loadComponent } from './svelte-dom.mjs';
const window = installDom();
Object.defineProperty(globalThis, 'localStorage', { value: window.localStorage, configurable: true });
Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
let lockTail = Promise.resolve();
Object.defineProperty(navigator, 'locks', { value: { request(_name, run) { const next = lockTail.then(run); lockTail = next.catch(() => {}); return next; } }, configurable: true });
const nativeDate = Date;
const fixed = new nativeDate('2026-09-15T11:00:00+08:00').getTime();
class Clock extends nativeDate { constructor(...args) { super(...(args.length ? args : [fixed])); } static now() { return fixed; } }
globalThis.Date = Clock;
const notices = [];
class Notification { static permission = 'default'; static async requestPermission() { this.permission = 'granted'; return this.permission; } constructor(title, options) { notices.push({title,...options}); } close() {} }
globalThis.Notification = window.Notification = Notification;
if (!window.HTMLDialogElement.prototype.showModal) window.HTMLDialogElement.prototype.showModal = function() { this.open = true; };
const { mount, unmount, flushSync } = await import('svelte');
const { globalMessages } = await import('../../src/lib/global-messages.ts');
const { dayKey, emptyDay } = await import('../../src/lib/trading-workflow/model.ts');
const db = new DatabaseSync(':memory:');
db.exec(await readFile(new URL('../../migrations/1015_trading_workflow_config.sql',import.meta.url),'utf8'));
let config = { version: 1, nodes: JSON.parse(db.prepare('SELECT nodes FROM trading_workflow_config').get().nodes) };
const requests = [];
let conflict = false;
globalThis.fetch = async (url, options = {}) => {
  requests.push({ url, ...options });
  if (options.method === 'PUT') {
    if (conflict) return Response.json({error:'节点配置已被更新，请重新载入后修改'},{status:409});
    const body = JSON.parse(options.body);
    assert.deepEqual(Object.keys(body).sort(), ['expectedVersion','nodes']);
    config = {version: config.version+1, nodes:body.nodes};
    return Response.json(config);
  }
  return Response.json({...config, actorKey:'test-actor',canEdit:true});
};
const View = await loadComponent('src/lib/trading-research/WorkflowView.svelte');
const app = mount(View,{target:document.body});
async function settle() { for(let i=0;i<12;i++){await new Promise(resolve=>setTimeout(resolve,0));flushSync();} }
await settle();
const button = text => [...document.querySelectorAll('button')].find(node=>node.textContent.trim() === text);
assert.equal(document.querySelectorAll('.lane-enable input').length,3);
assert.deepEqual([...document.querySelectorAll('.lane-enable input')].map(node=>node.checked),[true,true,false]);
assert.equal(document.querySelector('[data-workflow-node="reverse-position"]'),null);
button('未激活 +');
flushSync(()=>document.querySelector('[data-workflow-node="reverse-change"] button').click());await settle();
assert.ok(document.querySelector('[data-workflow-node="reverse-position"]'));
const completion = document.querySelector('[data-workflow-node="loan-deal"] input');
const quote = document.querySelector('[data-workflow-node="reverse-quote"] input');
flushSync(()=>{completion.click();quote.click();});await settle();
const local = JSON.parse(localStorage.getItem(dayKey('test-actor','2026-09-15')));
assert.equal(local.completed['loan-deal'],true);assert.equal(local.completed['reverse-quote'],true);
assert.equal(requests.length,1,'local interactions must never call backend');
flushSync(()=>button('开启浏览器提醒').click());await settle();
assert.ok(notices.length>0);
assert.ok(notices.every(item=>item.tag.startsWith('test-actor:2026-09-15:')));
const noticeCount=notices.length;window.dispatchEvent(new window.Event('focus'));await settle();assert.equal(notices.length,noticeCount);
flushSync(()=>button('编辑节点').click());await settle();
assert.ok(document.querySelector('dialog[open]'));
const name=document.querySelector('.editor-fields input');
flushSync(()=>{name.value='修改后的协同节点';name.dispatchEvent(new window.Event('input',{bubbles:true}));});
conflict=true;
flushSync(()=>document.querySelector('dialog form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));await settle();
assert.ok(document.querySelector('dialog[open]'));assert.equal(name.value,'修改后的协同节点');
conflict=false;
flushSync(()=>document.querySelector('dialog form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));await settle();
assert.equal(document.querySelector('dialog'),null);assert.equal(config.nodes[0].title,'修改后的协同节点');
// A corrupted record in another tab must not erase this tab's existing completed work.
localStorage.setItem(dayKey('test-actor','2026-09-15'),'{broken');
window.dispatchEvent(new window.StorageEvent('storage',{key:dayKey('test-actor','2026-09-15')}));await settle();
assert.equal(document.querySelector('[data-workflow-node="loan-deal"] input').checked,true);
await unmount(app);globalMessages.clear();
localStorage.setItem(dayKey('test-actor','2026-09-15'),JSON.stringify(local));
const reloaded=mount(View,{target:document.body});await settle();
assert.equal(document.querySelector('[data-workflow-node="loan-deal"] input').checked,true);
await unmount(reloaded);globalMessages.clear();

// Real route handlers, no authentication bypass or network calls.
const { GET, PUT } = await import('../../src/routes/api/trading-workflow/config/+server.ts');
const adapter={prepare(sql){let values=[];return{bind(...args){values=args;return this;},async first(){return db.prepare(sql).get(...values)??null;}};}};
const event=(permissions,body,origin='https://eastmoney.hasbai.xyz')=>({locals:{user:permissions?{id:'test-actor',authorization:{permissions}}:null},platform:{env:{DB:adapter}},request:new Request('https://eastmoney.hasbai.xyz/api/trading-workflow/config',{method:'PUT',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)})});
assert.equal((await GET(event(null))).status,401);
assert.equal((await GET(event([]))).status,403);
assert.equal((await GET(event(['research.workspace:read']))).status,200);
const valid={expectedVersion:1,nodes:config.nodes};
assert.equal((await PUT(event(['research.workspace:read'],valid))).status,403);
assert.equal((await PUT(event(['research.workflow:update'],valid,'https://evil.invalid'))).status,403);
assert.equal((await PUT(event(['research.workflow:update'],{...valid,progress:emptyDay('2026-09-15')}))).status,400);
assert.equal((await PUT(event(['research.workflow:update'],valid))).status,200);
const stale=await PUT(event(['research.workflow:update'],valid));assert.equal(stale.status,409);assert.equal((await stale.json()).code,'WORKFLOW_CONFIG_CONFLICT');
db.exec("UPDATE trading_workflow_config SET nodes='[]',version=2");
assert.equal((await GET(event(['research.workspace:read']))).status,200);
db.close();globalThis.Date=nativeDate;await window.happyDOM.abort();
console.log('Trading workflow DOM and API checks passed');
