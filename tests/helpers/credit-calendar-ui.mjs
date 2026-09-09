import assert from 'node:assert/strict';
import {installDom,loadComponent} from './svelte-dom.mjs';
import {creditItemTypes,creditItemLabels} from '../../src/lib/credit/types.ts';
const window=installDom();
const {mount,unmount,flushSync,tick}=await import('svelte');
document.body.innerHTML='<div id="tr-topbar-actions"></div><div id="calendar-host"></div>';
const summary={reportDate:'2026-09-09',institutionCount:0,approvedCount:0,totalLimit:0,totalUsed:0,totalAvailable:0,utilization:0,expiringWithin30Days:0};
const makeEvents=month=>[
  ...['new','expiry','renewal','increase','revoked'].map(kind=>({id:kind,type:kind==='expiry'||kind==='revoked'?'expiry':'added',kind,institutionName:kind,label:kind})),
  ...creditItemTypes.map(itemType=>({id:itemType,type:'usage',kind:'usage',itemType,institutionName:itemType,label:`${creditItemLabels[itemType]} · 增加1亿元`}))
].map(event=>({...event,date:`${month}-04`,status:'completed',statusLabel:'已生效'}));
const requests=[];
globalThis.fetch=async url=>{
  requests.push(String(url));
  const month=new URL(url,'http://localhost').searchParams.get('month')??'2026-09';
  return Response.json({availableDates:['2026-08-21'],previousDate:null,summary,previousSummary:null,
    weeklySummary:{...summary,addedInstitutionCount:0,expiredInstitutionCount:0},previousWeeklySummary:null,
    institutions:[],weeklyNews:[],recentApprovals:[],limitChanges:[],usageChanges:[],calendarEvents:makeEvents(month)});
};
const View=await loadComponent('src/lib/trading-research/CreditView.svelte');
const app=mount(View,{target:document.querySelector('#calendar-host'),props:{tab:'calendar'}});
async function settle(){for(let i=0;i<5;i++){await new Promise(r=>setImmediate(r));flushSync();await tick();}}
await settle();
const groups=[...document.querySelectorAll('.tr-credit-calendar-filter .multi-filter')];
assert.deepEqual(groups.map(group=>group.querySelector('.filter-label').textContent),['额度','已用']);
assert.ok(groups.every(group=>group.querySelector('summary').textContent.includes('全部')));
const visible=()=>[...document.querySelectorAll('.tr-credit-calendar-event strong')].map(node=>node.textContent).sort();
const toggle=(group,label)=>{
  group.querySelector('details').open=true;
  const control=[...group.querySelectorAll('label')].find(node=>node.textContent.trim()===label)?.querySelector('input');
  assert.ok(control,label);flushSync(()=>control.click());
};
const all=group=>flushSync(()=>group.querySelector('.filter-popover button').click());
assert.equal(visible().length,11);
toggle(groups[0],'新增');assert.equal(visible().length,7);
toggle(groups[0],'到期');assert.equal(visible().length,8);
toggle(groups[1],'债券投资');assert.deepEqual(visible(),['bond_investment','expiry','new']);
toggle(groups[1],'收益凭证');assert.deepEqual(visible(),['bond_investment','expiry','new','yield_certificate']);
flushSync(()=>document.querySelector('[aria-label="下一个月"]').click());
await settle();
assert.ok(requests.at(-1).includes('month=2026-10'));
assert.deepEqual(visible(),['bond_investment','expiry','new','yield_certificate']);
const currentGroups=[...document.querySelectorAll('.tr-credit-calendar-filter .multi-filter')];
all(currentGroups[1]);assert.equal(visible().length,8);
all(currentGroups[0]);assert.equal(visible().length,11);
toggle(currentGroups[0],'续作/扩额');assert.equal(visible().length,8);
assert.ok(visible().includes('renewal')&&visible().includes('increase'));
assert.equal(visible().includes('new'),false);
await unmount(app);await tick();await window.happyDOM.abort();
console.log('Credit calendar multi-select checks passed');
