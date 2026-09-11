import assert from 'node:assert/strict';
import {installDom,loadComponent} from './svelte-dom.mjs';
import {creditInstitutionUpdateSchema} from '../../src/lib/credit/update.ts';
const window=installDom();
const {mount,unmount,flushSync,tick}=await import('svelte');
document.body.innerHTML='<div id="tr-topbar-actions"></div><div id="host"></div>';
const summary={reportDate:'2026-09-11',institutionCount:1,approvedCount:1,totalLimit:8,totalUsed:1,totalAvailable:7,utilization:12.5,expiringWithin30Days:0};
let institution={reportDate:summary.reportDate,institutionName:'上海农商行（金市）',institutionType:'农商行',status:'approved',confidentialityStatus:false,totalLimit:8,totalUsed:1,totalRemaining:7,availableAmount:7,utilization:12.5,effectiveDate:'2025-08-31',expiryDate:'2026-08-31',items:[],clients:[],notes:null};
const report=()=>({availableDates:['2026-08-21'],previousDate:null,summary,previousSummary:null,weeklySummary:{...summary,addedInstitutionCount:0,expiredInstitutionCount:0},previousWeeklySummary:null,institutions:[institution],weeklyNews:[],recentApprovals:[],limitChanges:[],usageChanges:[],calendarEvents:[]});
const writes=[];
globalThis.fetch=async(url,options={})=>{
  if(options.method==='PATCH'){
    const input=JSON.parse(options.body);writes.push(input);
    const parsed=creditInstitutionUpdateSchema.safeParse(input);
    if(!parsed.success)return Response.json({error:'授信数据格式无效'},{status:400});
    institution={...institution,...input.changes.institution};
    return Response.json({...report(),institution});
  }
  return Response.json(report());
};
async function settle(ms=0){if(ms)await new Promise(r=>setTimeout(r,ms));for(let i=0;i<5;i++){await new Promise(r=>setImmediate(r));flushSync();await tick();}}
const View=await loadComponent('src/lib/trading-research/CreditView.svelte');
const app=mount(View,{target:document.querySelector('#host'),props:{tab:'overview'}});await settle();
flushSync(()=>document.querySelector('.tr-credit-table tbody tr button').click());await settle();
const field=label=>[...document.querySelectorAll('.tr-credit-editor-grid label')].findLast(l=>l.textContent.trim()===label).querySelector('input');
function type(input,value){input.focus();input.value=value;input.dispatchEvent(new window.Event('input',{bubbles:true}));input.dispatchEvent(new window.Event('change',{bubbles:true}));flushSync();}
// Native controls can emit a change for each intermediate year segment.
let start=field('生效日');type(start,'0002-08-31');await settle(750);assert.equal(writes.length,0);
type(start,'2026-08-31');start.blur();await settle(750);assert.equal(writes.length,1);assert.equal(writes[0].changes.institution.effectiveDate,'2026-08-31');
// Renew both endpoints beyond the old expiry: retain the first edit until valid.
start=field('生效日');type(start,'2027-08-31');start.blur();await settle(750);assert.equal(writes.length,1);
assert.match(document.body.textContent,/到期日不能早于生效日/);
let end=field('到期日');type(end,'2028-08-31');end.blur();await settle(750);assert.equal(writes.length,2);
assert.deepEqual(writes[1].changes.institution,{effectiveDate:'2027-08-31',expiryDate:'2028-08-31'});
// Blank dates never become a destructive clear, and amount editing still saves.
end=field('到期日');type(end,'');end.blur();await settle(750);assert.equal(writes.length,2);assert.equal(end.value,'2028-08-31');
const amount=field('授信总额（亿元）');type(amount,'9');amount.blur();await settle(750);assert.equal(writes.at(-1).changes.institution.totalLimit,9);
await unmount(app);await tick();await window.happyDOM.abort();console.log('Credit date editor checks passed');
