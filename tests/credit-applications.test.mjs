import assert from 'node:assert/strict';
import test from 'node:test';
import {applyCreditMigration,creditDatabase,seedCredit} from './helpers/credit-database.mjs';
import {loadCreditReport,saveCreditInstitution} from '../src/lib/server/credit-repository.ts';

test('历史同机构同日变更合并，保留原记录并写入续期及扩额类型',async t=>{
  const db=await creditDatabase(t,false,false,true);
  await seedCredit(db,'2026-08-21','浙江萧山农商行',{
    total:8,effective_date:'2025-09-22',expiry_date:'2026-09-21',
  });
  await db.query("SELECT credit.append_diff('2026-09-24','浙江萧山农商行',$1::jsonb,'auth0|test')",
    [JSON.stringify({effective_date:'2026-09-21',expiry_date:'2027-08-31'})]);
  await db.query("SELECT credit.append_diff('2026-09-24','浙江萧山农商行',$1::jsonb,'auth0|test')",
    [JSON.stringify({total:9})]);
  const state=async date=>(await db.query("SELECT total::float8,effective_date::text,expiry_date::text FROM credit.state_as_of($1::date) WHERE institution_name='浙江萧山农商行'",[date])).rows[0];
  const before=[await state('2026-09-21'),await state('2026-09-24')];
  await applyCreditMigration(db,'0013_explicit_credit_applications.sql');
  assert.deepEqual([await state('2026-09-21'),await state('2026-09-24')],before);
  const rows=(await db.query("SELECT id,type,total::float8,expiry_date::text FROM credit.diff WHERE institution_name='浙江萧山农商行' AND effective_on='2026-09-24'")).rows;
  assert.equal(rows.length,1);
  assert.equal(rows[0].type,'renewal_increase');
  assert.equal(rows[0].total,9);
  assert.equal((await db.query('SELECT count(*)::int n FROM credit.diff_merge_archive')).rows[0].n,2);
  const report=await loadCreditReport(db,'2026-09-24','2026-09');
  assert.deepEqual(report.weeklyNews.map(row=>row.eventType),['renewal_increase']);
  assert.equal(report.calendarEvents.some(row=>row.date==='2026-09-21'&&row.kind==='expiry'),false);
  assert.ok(report.calendarEvents.some(row=>row.date==='2026-09-24'&&row.label==='授信续作及扩额 · 9亿元'));
});

test('申请按操作校验，同日续期和扩额形成一条可追溯事件',async t=>{
  const db=await creditDatabase(t);
  await seedCredit(db,'2026-08-21','甲银行',{
    total:8,effective_date:'2025-09-22',expiry_date:'2026-09-21',
  });
  await assert.rejects(saveCreditInstitution(db,{operation:'renewal',reportDate:'2026-09-24',institutionName:'甲银行',
    changes:{institution:{expiryDate:'2026-09-21'}}},'auth0|test'),/晚于原到期日/);
  await assert.rejects(saveCreditInstitution(db,{operation:'increase',reportDate:'2026-09-24',institutionName:'甲银行',
    changes:{institution:{totalLimit:8}}},'auth0|test'),/高于原额度/);
  await assert.rejects(saveCreditInstitution(db,{operation:'maintenance',reportDate:'2026-09-24',institutionName:'甲银行',
    changes:{institution:{status:'revoked'}}},'auth0|test'),/对应授信申请操作/);
  await assert.rejects(saveCreditInstitution(db,{operation:'maintenance',reportDate:'2026-09-24',institutionName:'甲银行',
    changes:{institution:{status:'applying'}}},'auth0|test'),/对应授信申请操作/);
  await assert.rejects(saveCreditInstitution(db,{operation:'renewal',reportDate:'2026-09-24',institutionName:'甲银行',
    changes:{institution:{expiryDate:'2027-08-31',handler:'不属于续期'}}},'auth0|test'),/不属于本操作/);
  await saveCreditInstitution(db,{operation:'renewal',reportDate:'2026-09-24',institutionName:'甲银行',
    changes:{institution:{effectiveDate:'2026-09-21',expiryDate:'2027-08-31'}}},'auth0|test');
  await saveCreditInstitution(db,{operation:'increase',reportDate:'2026-09-24',institutionName:'甲银行',
    changes:{institution:{totalLimit:9}}},'auth0|test');
  const rows=(await db.query("SELECT type FROM credit.diff WHERE institution_name='甲银行' AND effective_on='2026-09-24'")).rows;
  assert.deepEqual(rows.map(row=>row.type),['renewal_increase']);
  assert.equal((await db.query('SELECT count(*)::int n FROM credit.diff_merge_archive')).rows[0].n,1);
  const report=await loadCreditReport(db,'2026-09-24','2026-09');
  assert.deepEqual(report.weeklyNews.map(row=>row.eventType),['renewal_increase']);
  assert.equal(report.weeklySummary.expiredInstitutionCount,0);
  assert.equal(report.calendarEvents.some(row=>row.date==='2026-09-21'&&row.kind==='expiry'),false);
});

test('首个业务日的显式新增进入日历和周报，申请中转获批生成新增事件',async t=>{
  const db=await creditDatabase(t);
  await saveCreditInstitution(db,{operation:'new',reportDate:'2026-09-24',institutionName:'首家银行',
    changes:{institution:{institutionType:'城商行',status:'approved',confidentialityStatus:false,totalLimit:5,
      effectiveDate:'2026-09-24',expiryDate:'2027-09-24'}}},'auth0|test',true);
  const first=await loadCreditReport(db,'2026-09-24','2026-09');
  assert.deepEqual(first.weeklyNews.map(row=>row.eventType),['new']);
  assert.ok(first.calendarEvents.some(row=>row.kind==='new'&&row.institutionName==='首家银行'));
  await saveCreditInstitution(db,{operation:'new',reportDate:'2026-09-25',institutionName:'待批银行',
    changes:{institution:{institutionType:'城商行',status:'applying',confidentialityStatus:false}}},'auth0|test',true);
  assert.equal((await loadCreditReport(db,'2026-09-25')).weeklyNews.some(row=>row.institutionName==='待批银行'),false);
  await saveCreditInstitution(db,{operation:'maintenance',reportDate:'2026-09-26',institutionName:'待批银行',
    changes:{institution:{status:'approved',totalLimit:3}}},'auth0|test');
  assert.ok((await loadCreditReport(db,'2026-09-26')).weeklyNews.some(row=>row.institutionName==='待批银行'&&row.eventType==='new'));
});
