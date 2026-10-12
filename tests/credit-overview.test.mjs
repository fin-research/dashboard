import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCreditOverview } from '../src/lib/credit/overview.ts';
import { groupCreditInstitutions, defaultCreditSort } from '../src/lib/credit/sorting.ts';
const row=(name,type,limit=10,used=2,extra={})=>({institutionName:name,institutionType:type,totalLimit:limit,totalUsed:used,status:'approved',reportDate:'2026-10-12',expiryDate:null,
 items:['bond_investment','yield_certificate','legal_overdraft','interbank_lending','other'].map(type=>({type,limitAmount:type==='other'?null:limit,usedAmount:type==='legal_overdraft'||type==='other'?null:used})),...extra});
test('overview shares category aliases, effective amount scope and decimal sums',()=>{
 const rows=[row('甲','国有行',0.1,0.03),row('乙','国有银行',0.2,0.02),row('丙','股份行',20,2,{status:'applying'}),row('丁','农商行',100,50,{status:'revoked'})];
 const result=buildCreditOverview(rows,'2026-10-12');
 assert.deepEqual(result.bankCounts,[{label:'国有行',value:2},{label:'股份行',value:1}]);
 assert.deepEqual(result.bankLimits,[{label:'国有行',value:0.3},{label:'股份行',value:null}]);
 assert.ok(Math.abs(result.bankUtilization[0].value-100/6)<1e-12);
 assert.deepEqual(result.statusCounts,[{label:'已获批',value:2},{label:'申请中',value:1}]);
 assert.equal(result.productLimits.length,4);assert.equal(result.productUsage[2].value,0);assert.equal(result.productUsage[4].value,0);
 assert.equal(result.topLimits[0].label,'乙');assert.equal(result.expiryCounts.at(-1).value,2);
});
test('partial financing missing values and zero denominators remain missing while negative net use remains signed',()=>{
 const missing=row('未关联','城商行',5,null);missing.items.forEach(item=>item.usedAmount=null);
 const result=buildCreditOverview([row('已关联','城商行',5,2),missing,row('零','农商行',0,0),row('净卖出','外资行',3,-1)],'2026-10-12');
 assert.equal(result.bankUtilization.find(row=>row.label==='城商行').value,null);
 assert.equal(result.bankUtilization.find(row=>row.label==='农商行').value,null);
 assert.equal(result.productUsage[0].value,null);assert.equal(result.productUsage[2].value,0);
 assert.ok(result.bankUtilization.find(row=>row.label==='外资行').value<0);
});
test('maturity buckets retain undated approvals and every boundary',()=>{
 const dates=['2026-10-12','2026-11-11','2026-11-12','2027-01-10','2027-04-10','2027-10-12','2027-10-13',null];
 const result=buildCreditOverview(dates.map((expiryDate,i)=>row(String(i),'股份行',10,2,{expiryDate})),'2026-10-12');
 assert.deepEqual(result.expiryCounts.map(row=>row.value),[2,2,1,1,1,1]);
});
test('filtered rows form contiguous categories, aliases merge and multisort priorities remain inside each group',()=>{
 const rows=[row('甲','股份行',10,2),row('乙','股份行',10,4),row('丙','国有银行',1),row('丁','国有行',20),row('戊','城商行',30)];
 let groups=groupCreditInstitutions(rows,[...defaultCreditSort,{key:'totalUsed',direction:'descending'}]);
 assert.deepEqual(groups.map(group=>group.institutionType),['国有行','股份行','城商行']);
 assert.deepEqual(groups[0].institutions.map(row=>row.institutionName),['丁','丙']);
 assert.deepEqual(groups[1].institutions.map(row=>row.institutionName),['乙','甲']);
 groups=groupCreditInstitutions(rows.filter(row=>row.totalLimit>=10),[{key:'institutionType',direction:'descending'},{key:'totalLimit',direction:'ascending'}]);
 assert.deepEqual(groups.map(group=>group.institutionType),['城商行','股份行','国有行']);
 assert.equal(groups[2].institutions.length,1);assert.equal(rows[2].institutionType,'国有银行');
});

test('shared bar options retain null data, signed ranges and utilization beyond 100 percent',async()=>{
 await import('./helpers/svelte-dom.mjs');
 const {workbenchBarChartOption}=await import('../src/charts/trading-research.ts');
 const option=workbenchBarChartOption([{label:'净卖出',value:-20},{label:'超额',value:140},{label:'缺失',value:null}],'使用率','%',100,[60,80],true);
 assert.equal(option.xAxis.min,undefined);assert.equal(option.xAxis.max,140);
 assert.equal(option.series[0].data[2].value,null);assert.equal(option.series[0].showBackground,false);
 assert.equal(option.tooltip.valueFormatter(null),'—');assert.equal(option.series[0].label.formatter({value:null}),'—');
 assert.equal(option.series[0].label.formatter({value:-20}),'-20.0%');
 assert.deepEqual(option.yAxis.data,['净卖出','超额','缺失 —']);
 assert.deepEqual(option.series[0].markLine.data,[{xAxis:60},{xAxis:80}]);
});
