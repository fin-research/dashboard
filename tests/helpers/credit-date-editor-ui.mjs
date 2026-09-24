import assert from 'node:assert/strict';
import {installDom,loadComponent} from './svelte-dom.mjs';
const window=installDom();
const {mount,unmount,flushSync,tick}=await import('svelte');
const {PERMISSION_CODES}=await import('../../src/lib/permissions.ts');
const {createClientSession}=await import('../../src/lib/client-session.ts');
const session=createClientSession({user:{id:'auth0|test',email:'test@18.cn'},account:{name:'测试人员',department:'资金管理部'},roles:[{id:'rol_TestAdmin',name:'admin'}],permissions:[...PERMISSION_CODES],expiresAt:Date.now()/1000+3600});
const context=new Map([['site-session',session]]);

document.body.innerHTML='<div id="tr-topbar-actions"></div><div id="host"></div>';
const summary={reportDate:'2026-09-11',institutionCount:1,approvedCount:1,totalLimit:8,totalUsed:1,totalAvailable:7,utilization:12.5,expiringWithin30Days:0};
let institution={reportDate:summary.reportDate,institutionName:'上海农商行（金市）',institutionType:'农商行',status:'approved',confidentialityStatus:false,totalLimit:8,totalUsed:1,totalRemaining:7,availableAmount:7,utilization:12.5,effectiveDate:'2025-08-31',expiryDate:'2026-08-31',items:[],clients:[],notes:null};
const report=()=>({availableDates:['2026-08-21'],previousDate:null,summary,previousSummary:null,weeklySummary:{...summary,addedInstitutionCount:0,expiredInstitutionCount:0},previousWeeklySummary:null,institutions:[institution],weeklyNews:[],recentApprovals:[],limitChanges:[],usageChanges:[],calendarEvents:[]});
const writes=[];
globalThis.fetch=async(url,options={})=>{
  if(options.method && options.method!=='GET') {writes.push({url,options});return Response.json({error:'授信一览表只读'},{status:405});}
  return Response.json(report());
};
async function settle(){for(let i=0;i<5;i++){await new Promise(r=>setImmediate(r));flushSync();await tick();}}
const View=await loadComponent('src/lib/trading-research/CreditView.svelte');
const app=mount(View,{context,target:document.querySelector('#host'),props:{tab:'overview'}});await settle();
flushSync(()=>document.querySelector('.tr-credit-table tbody tr button').click());await settle();
const detail=document.querySelector('.tr-credit-detail');
assert.ok(detail);
for(const input of detail.querySelectorAll('input')) assert.equal(input.readOnly,true);
assert.equal(detail.querySelectorAll('select,textarea').length,0);
const date=[...detail.querySelectorAll('label')].find(label=>label.textContent.trim()==='到期日').querySelector('input');
date.value='2027-08-31';date.dispatchEvent(new window.Event('input',{bubbles:true}));
date.dispatchEvent(new window.Event('change',{bubbles:true}));await settle();
assert.equal(writes.length,0);
assert.match(document.body.textContent,/授信申请/);
await unmount(app);await tick();await window.happyDOM.abort();console.log('Credit read-only detail checks passed');
