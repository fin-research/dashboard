import assert from 'node:assert/strict';
import test from 'node:test';
import {creditDatabase,seedCredit} from './helpers/credit-database.mjs';
import {loadCreditReport,saveCreditInstitution} from '../src/lib/server/credit-repository.ts';
import {loadCreditStates,loadCreditSummaries} from '../src/lib/server/credit-snapshots.ts';
import {applyCreditUpdate} from '../src/lib/credit/apply-update.ts';

const orderCollections=report=>({...report,
  weeklyNews:[...report.weeklyNews].sort((a,b)=>a.reportDate.localeCompare(b.reportDate)||a.institutionName.localeCompare(b.institutionName)),
  previousWeeklyNews:[...(report.previousWeeklyNews??[])].sort((a,b)=>a.reportDate.localeCompare(b.reportDate)||a.institutionName.localeCompare(b.institutionName)),
  recentApprovals:[...report.recentApprovals].sort((a,b)=>b.reportDate.localeCompare(a.reportDate)||a.institutionName.localeCompare(b.institutionName)),
  limitChanges:[...report.limitChanges].sort((a,b)=>a.institutionName.localeCompare(b.institutionName))});

test('save returns only affected institution events and authoritative summaries; reactive result equals a fresh report',async t=>{
  const db=await creditDatabase(t);
  await seedCredit(db,'2026-08-01','甲银行',{expiry_date:'2026-09-30'});
  await seedCredit(db,'2026-08-01','乙银行',{expiry_date:'2026-09-30',total:20});
  await db.query("SELECT credit.append_diff('2026-08-12','乙银行','{\"total\":25}',NULL,'increase')");
  const before=await loadCreditReport(db,'2026-08-15');
  const untouched=before.institutions.find(row=>row.institutionName==='乙银行');
  const queries=[];
  const tracked={query:async(sql,params)=>{queries.push({sql,params});return db.query(sql,params);}};
  const result=await saveCreditInstitution(tracked,{operation:'increase',reportDate:'2026-08-15',viewDate:'2026-08-15',calendarMonth:'2026-08',institutionName:'甲银行',changes:{institution:{totalLimit:12}}});
  for(const collection of ['weeklyNews','previousWeeklyNews','recentApprovals','limitChanges','usageChanges','calendarEvents']) {
    assert.ok(result[collection].every(row=>row.institutionName==='甲银行'),collection);
  }
  const requests=queries.find(q=>q.sql.includes('jsonb_to_recordset')&&q.sql.includes('previous_period')&&!q.sql.includes('"totalAvailable"'));
  assert.ok(JSON.parse(requests.params[0]).every(row=>Array.isArray(row.names)&&row.names.every(name=>name==='甲银行')));
  assert.equal(result.summary.totalLimit,37);
  const reactive=applyCreditUpdate(before,result,'2026-08');
  assert.equal(reactive.institutions.find(row=>row.institutionName==='乙银行'),untouched);
  assert.deepEqual(orderCollections(reactive),orderCollections(await loadCreditReport(db,'2026-08-15')));
  assert.equal(applyCreditUpdate(before,{...result,viewDate:'2026-08-16'},'2026-08'),before);
  assert.equal(applyCreditUpdate(before,result,'2026-09'),before);
});

test('historical maintenance and future changes update the selected view without switching its date',async t=>{
  const db=await creditDatabase(t);await seedCredit(db,'2026-08-01');
  const before=await loadCreditReport(db,'2026-08-15','2026-09');
  const past=await saveCreditInstitution(db,{operation:'maintenance',reportDate:'2026-08-08',viewDate:'2026-08-15',calendarMonth:'2026-09',institutionName:'甲银行',changes:{items:[{type:'bond_investment',secondaryUsedAmount:0}],institution:{totalLimit:0,confidentialityStatus:false,notes:''}}});
  assert.equal(past.institution.totalUsed,0);assert.equal(past.institution.totalLimit,0);
  const updated=applyCreditUpdate(before,past,'2026-09');
  assert.deepEqual(orderCollections(updated),orderCollections(await loadCreditReport(db,'2026-08-15','2026-09')));
  const future=await saveCreditInstitution(db,{operation:'maintenance',reportDate:'2026-09-01',viewDate:'2026-08-15',calendarMonth:'2026-09',institutionName:'甲银行',changes:{institution:{totalLimit:5}}});
  assert.equal(future.viewDate,'2026-08-15');assert.equal(future.institution.totalLimit,0);
  assert.deepEqual(orderCollections(applyCreditUpdate(updated,future,'2026-09')),orderCollections(await loadCreditReport(db,'2026-08-15','2026-09')));
});

test('filtered canonical snapshots preserve values, empty lists and reset periods; SQL summaries match report precision',async t=>{
  const db=await creditDatabase(t);
  await seedCredit(db,'2026-08-01','甲银行',{effective_date:'2026-08-01',expiry_date:'2026-08-31',other_used:.000001});
  await seedCredit(db,'2026-08-01','乙银行');
  await db.query("SELECT credit.append_diff('2026-08-10','甲银行','{\"effective_date\":\"2026-09-01\",\"expiry_date\":\"2026-09-30\"}',NULL,'renewal')");
  const full=(await db.query("SELECT to_jsonb(s) AS data FROM credit.state_as_of('2026-08-15') s WHERE institution_name='甲银行'")).rows;
  const filtered=(await db.query("SELECT to_jsonb(s) AS data FROM credit.state_as_of('2026-08-15',ARRAY['甲银行','甲银行']) s")).rows;
  assert.deepEqual(filtered,full);
  assert.equal((await db.query("SELECT * FROM credit.state_as_of('2026-08-15',ARRAY[]::text[])")).rows.length,0);
  assert.deepEqual((await db.query("SELECT to_jsonb(s) AS data FROM credit.state_as_of('2026-08-15',NULL::text[]) s ORDER BY institution_name")).rows,
    (await db.query("SELECT to_jsonb(s) AS data FROM credit.state_as_of('2026-08-15') s ORDER BY institution_name")).rows);
  let states=await loadCreditStates(db,[{date:'2026-08-15',names:['甲银行']}]);
  assert.deepEqual(states[0].previous_period,{effectiveDate:'2026-08-01',expiryDate:'2026-08-31'});
  for(const date of ['2026-08-15','2026-09-01']) assert.deepEqual((await loadCreditSummaries(db,[date]))[0],(await loadCreditReport(db,date)).summary);
  await db.query("SELECT credit.append_diff('2026-08-16','甲银行','{\"status\":\"revoked\"}',NULL,'revocation')");
  await db.query("SELECT credit.append_diff('2026-08-17','甲银行','{\"status\":\"approved\"}',NULL,'new')");
  states=await loadCreditStates(db,[{date:'2026-08-18',names:['甲银行']}]);
  assert.equal(states[0].previous_period,null);
  assert.equal((await loadCreditReport(db,'2026-08-18')).institutions.find(row=>row.institutionName==='甲银行').effectiveStatus,'pending');
});


test('changing the first-week comparison date or history start refreshes dependent collections without replacing other rows',async t=>{
  const db=await creditDatabase(t);
  await seedCredit(db,'2026-08-01','甲银行',{effective_date:'2026-08-01',expiry_date:'2026-08-31'});
  await seedCredit(db,'2026-08-01','乙银行',{effective_date:'2026-08-01',expiry_date:'2026-08-02'});
  let before=await loadCreditReport(db,'2026-08-05');
  let update=await saveCreditInstitution(db,{operation:'maintenance',reportDate:'2026-08-03',viewDate:'2026-08-05',institutionName:'甲银行',changes:{institution:{notes:'补录'}}});
  assert.equal(update.previousDate,'2026-08-03');assert.ok(update.comparison);
  assert.deepEqual(orderCollections(applyCreditUpdate(before,update,'2026-08')),orderCollections(await loadCreditReport(db,'2026-08-05')));
  before=await loadCreditReport(db,'2026-08-15');
  update=await saveCreditInstitution(db,{operation:'new',reportDate:'2026-07-30',viewDate:'2026-08-15',institutionName:'丙银行',changes:{institution:{status:'applying',institutionType:'城商行',confidentialityStatus:false}}},null,true);
  assert.ok(update.calendarRemovals);assert.ok(update.comparison);
  assert.deepEqual(orderCollections(applyCreditUpdate(before,update,'2026-08')),orderCollections(await loadCreditReport(db,'2026-08-15')));
  const outside=await loadCreditReport(db,'2026-08-15','2027-01');
  const earlier=await saveCreditInstitution(db,{operation:'new',reportDate:'2026-07-29',viewDate:'2026-08-15',calendarMonth:'2027-01',institutionName:'丁银行',changes:{institution:{status:'applying',institutionType:'城商行',confidentialityStatus:false}}},null,true);
  assert.equal(earlier.calendarAdditions,undefined);
  assert.deepEqual(orderCollections(applyCreditUpdate(outside,earlier,'2027-01')),orderCollections(await loadCreditReport(db,'2026-08-15','2027-01')));
});


test('creating a future institution confirms the write while keeping the current header snapshot',async t=>{
  const db=await creditDatabase(t);await seedCredit(db,'2026-08-01');
  const before=await loadCreditReport(db,'2026-08-15','2026-09');
  const update=await saveCreditInstitution(db,{operation:'new',reportDate:'2026-09-01',viewDate:'2026-08-15',calendarMonth:'2026-09',institutionName:'未来银行',changes:{institution:{institutionType:'城商行',status:'approved',confidentialityStatus:false,totalLimit:8}}},null,true);
  assert.equal(update.institution,null);assert.equal(update.viewDate,'2026-08-15');
  assert.deepEqual(orderCollections(applyCreditUpdate(before,update,'2026-09')),orderCollections(await loadCreditReport(db,'2026-08-15','2026-09')));
});

test('the credit client displays the sanitized Gateway backend error',async()=>{
  const {fetchCreditReport,updateCreditInstitution}=await import('../src/lib/credit/client.ts');
  const fetcher=async()=>Response.json({detail:'业务服务暂时不可用，请稍后重试',code:'BACKEND_UNAVAILABLE'},{status:503});
  await assert.rejects(fetchCreditReport(null,fetcher),/业务服务暂时不可用/);
  await assert.rejects(updateCreditInstitution({operation:'maintenance',reportDate:'2026-10-09',institutionName:'甲',changes:{institution:{notes:'x'}}},fetcher),/业务服务暂时不可用/);
});
