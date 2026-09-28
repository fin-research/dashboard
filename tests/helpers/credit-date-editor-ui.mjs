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
  if(options.method==='PATCH') {
    const body=JSON.parse(options.body);
    writes.push(body);
    institution={...institution,expiryDate:body.changes.institution.expiryDate};
    return Response.json({...report(),institution});
  }
  return Response.json(report());
};
async function settle(){for(let i=0;i<5;i++){await new Promise(r=>setImmediate(r));flushSync();await tick();}}
const View=await loadComponent('src/lib/trading-research/CreditView.svelte');
const app=mount(View,{context,target:document.querySelector('#host'),props:{tab:'overview'}});await settle();
flushSync(()=>document.querySelector('.tr-credit-table tbody tr button').click());await settle();
const detail=document.querySelector('.tr-credit-detail');
assert.ok(detail);
const date=[...detail.querySelectorAll('label')].find(label=>label.textContent.trim()==='到期日').querySelector('input');
assert.equal(date.disabled,false);
assert.equal([...detail.querySelectorAll('label')].find(label=>label.textContent.trim()==='可用额度（亿元）').querySelector('input').disabled,true);
date.value='2027-08-31';date.dispatchEvent(new window.Event('input',{bubbles:true}));
date.dispatchEvent(new window.Event('change',{bubbles:true}));await settle();
assert.equal(writes.length,0);
const save=[...detail.querySelectorAll('button')].find(button=>button.textContent.trim()==='保存');
assert.ok(save);detail.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await settle();
assert.equal(writes.length,1);
assert.equal(writes[0].operation,'maintenance');
assert.equal(writes[0].changes.institution.expiryDate,'2027-08-31');
assert.equal(institution.expiryDate,'2027-08-31');
assert.match(document.body.textContent,/授信申请/);
await unmount(app);await tick();
document.body.innerHTML='<div id="tr-topbar-actions"></div><div id="host"></div>';
const reader=createClientSession({user:{id:'auth0|reader',email:'reader@18.cn'},account:{name:'只读人员',department:'资金管理部'},roles:[{id:'rol_Reader',name:'authenticated'}],permissions:['credit.institution:read'],expiresAt:Date.now()/1000+3600});
const readonly=mount(View,{context:new Map([['site-session',reader]]),target:document.querySelector('#host'),props:{tab:'overview'}});await settle();
flushSync(()=>document.querySelector('.tr-credit-table tbody tr button').click());await settle();
const readonlyDetail=document.querySelector('.tr-credit-detail');
assert.ok([...readonlyDetail.querySelectorAll('input,select,textarea')].every(input=>input.disabled));
assert.equal([...readonlyDetail.querySelectorAll('button')].some(button=>button.textContent.trim()==='保存'),false);
await unmount(readonly);await tick();await window.happyDOM.abort();console.log('Credit editable detail and role checks passed');
