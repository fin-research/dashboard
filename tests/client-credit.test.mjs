import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { loadCreditReport, persistCreditWorkbook, saveCreditInstitution } from '../src/lib/server/credit-repository.ts';
import { creditInstitutionUpdateSchema } from '../src/lib/credit/update.ts';
import { creditItemTypes } from '../src/lib/credit/types.ts';
import { importDebtWorkbook } from '../src/lib/server/financing/debt-importer.js';
import { transformWorkbook } from '../scripts/financing/lib/debt-transform.mjs';

async function database(t) {
  const db = new PGlite();
  const query = db.query.bind(db);
  db.query = async (...args) => { const result = await query(...args); return {...result,rowCount: result.rows.length || result.affectedRows || 0}; };
  t.after(() => db.close());
  for (const name of ['0001_financing_postgres.sql','0007_detach_projects_from_debt.sql','0015_income_certificate_dates_and_names.sql','0028_client_master.sql']) {
    await db.exec(fs.readFileSync(new URL(`../financing-migrations/${name}`, import.meta.url),'utf8'));
  }
  for (const name of fs.readdirSync(new URL('../credit-migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort()) {
    await db.exec(fs.readFileSync(new URL(`../credit-migrations/${name}`,import.meta.url),'utf8'));
  }
  await db.exec(`INSERT INTO public.client(name,fullname,type,subtype) VALUES
    ('招商银行','招商银行股份有限公司','银行','股份行'),('中银理财','中银理财有限责任公司','理财子',NULL),('乙银行',NULL,'银行','城商行');
    INSERT INTO public.client_alias(alias,match_kind,client_id,notes) VALUES
    ('^银行-申万宏源证券资产管理有限公司\\(代“申万宏源招行凭证一号单一资产管理计划','pattern',1,'实际投资人'),
    (public.normalize_client_name('银行-信银理财有限责任公司（代中银理财之乐赢稳健和信一年定开5期净值型人民币理财产品）'),'exact',2,'用户确认');`);
  return db;
}

async function institution(db, date='2026-09-04', name='合并授信') {
  await db.query(`INSERT INTO credit.institution(report_date,source_row,institution_name,institution_type,confidentiality_status,status,included_in_weekly_report,total_limit,total_used)
    VALUES ($1,4,$2,'银行','unknown','approved',true,20,10)`,[date,name]);
  for (const type of creditItemTypes) await db.query(`INSERT INTO credit.item(report_date,institution_name,item_type,limit_amount,used_amount)
    VALUES ($1,$2,$3,20,$4)`,[date,name,type,type==='yield_certificate'?8:type==='other'?2:0]);
}

test('customer matching keeps actual investors, supports prefixes, and never guesses an unknown plan manager',async t=>{
  const db=await database(t);
  for (const [raw,id] of [
    ['银行-招商银行股份有限公司',1],
    ['银行-申万宏源证券资产管理有限公司（代“申万宏源招行凭证一号单一资产管理计划”）',1],
    ['银行-信银理财有限责任公司（代中银理财之乐赢稳健和信一年定开5期净值型人民币理财产品）',2],
    ['银行-申万宏源证券资产管理有限公司（代“未知投资人计划”）',null]
  ]) assert.equal((await db.query('SELECT public.resolve_client($1) AS id',[raw])).rows[0].id,id);
  await db.query(`INSERT INTO financing.income_certificate(debt_type,subtype,name,counterparty,amount) VALUES ('收益凭证','固定收益凭证','测试凭证','银行-招商银行股份有限公司',1)`);
  assert.equal((await db.query('SELECT client_id FROM financing.debt')).rows[0].client_id,1);
  await assert.rejects(db.query(`UPDATE financing.income_certificate SET client_id=9999`),/foreign key/);
  await db.query('UPDATE financing.income_certificate SET client_id=2');
  await db.query('UPDATE financing.income_certificate SET amount=2');
  assert.equal((await db.query('SELECT client_id FROM financing.debt')).rows[0].client_id,2);
  await assert.rejects(db.query('DELETE FROM public.client WHERE id=2'),/foreign key/);
});

test('dated combined credit sums clients once, excludes matured/future/closed debt, and preserves original usage',async t=>{
  const db=await database(t);
  await db.exec(`INSERT INTO credit.client_mapping(institution_name,client_id,notes) VALUES ('合并授信',1,'明确合并'),('合并授信',2,'明确合并')`);
  await institution(db);
  await db.exec(`INSERT INTO financing.income_certificate(debt_type,subtype,name,client_id,amount,issue_date,activated_at,maturity_date) VALUES
    ('收益凭证','固定收益凭证','存续甲',1,100000000,'2026-08-01','2026-08-01','2027-08-01'),
    ('收益凭证','固定收益凭证','存续乙',2,200000000,'2026-08-01','2026-08-01','2027-08-01'),
    ('收益凭证','固定收益凭证','当天到期',1,900000000,'2026-08-01','2026-08-01','2026-09-04'),
    ('收益凭证','固定收益凭证','未来',1,900000000,'2026-09-05','2026-09-05','2027-08-01');
    INSERT INTO financing.debt(debt_type,name,client_id,amount,issue_date,activated_at,maturity_date,closed_at) VALUES
    ('同业拆借','存续拆借',1,400000000,'2026-09-01','2026-09-01','2026-09-10',NULL),
    ('同业拆借','已关闭',1,900000000,'2026-09-01','2026-09-01','2026-09-10','2026-09-03');`);
  const report=await loadCreditReport(db);
  const row=report.institutions[0];
  assert.equal(row.totalUsed,9);
  assert.equal(row.importedTotalUsed,10);
  assert.equal(row.clients.length,2);
  assert.equal(row.items.find(i=>i.type==='yield_certificate').usedAmount,3);
  assert.equal(row.items.find(i=>i.type==='yield_certificate').importedUsedAmount,8);
  assert.equal((await db.query("SELECT total_used FROM credit.institution")).rows[0].total_used,'10.000000');
  await institution(db,'2026-09-04','重复授信');
  await assert.rejects(db.query(`INSERT INTO credit.institution_client(report_date,institution_name,client_id) VALUES ('2026-09-04','重复授信',1)`),/unique/);
  const unknown=(await loadCreditReport(db)).institutions.find(i=>i.institutionName==='重复授信');
  assert.equal(unknown.totalUsed,null);
  assert.equal(unknown.availableAmount,null);
  // Other manually maintained usage changes the total, financing usage is read-only.
  await saveCreditInstitution(db,{reportDate:'2026-09-04',institutionName:'合并授信',changes:{items:[{type:'other',usedAmount:5}]}});
  assert.equal((await loadCreditReport(db)).institutions[0].totalUsed,12);
});

test('credit import keeps dated manual mappings and automatically links clear new customers',async t=>{
  const db=await database(t);
  await institution(db,'2026-09-04','乙银行');
  assert.equal((await db.query('SELECT client_id FROM credit.institution_client')).rows[0].client_id,3);
  await db.query('UPDATE credit.institution_client SET yield_certificate=false');
  const original=(await loadCreditReport(db)).institutions[0];
  await persistCreditWorkbook(db,{parsed:{reportDate:'2026-09-04',institutions:[original],approvedCount:1,totalLimit:20,totalUsed:10,totalAvailable:10,weeklyApprovedCount:1,weeklyTotalLimit:20,weeklyTotalUsed:10,weeklyTotalAvailable:10}});
  assert.equal((await db.query('SELECT yield_certificate FROM credit.institution_client')).rows[0].yield_certificate,false);
  assert.equal((await loadCreditReport(db)).institutions[0].items.find(i=>i.type==='yield_certificate').usedAmount,0);
});

test('API rejects edits to derived total and financing usage but permits other components',()=>{
  const input=changes=>({reportDate:'2026-09-04',institutionName:'甲',changes});
  for(const type of ['yield_certificate','interbank_lending']) assert.equal(creditInstitutionUpdateSchema.safeParse(input({items:[{type,usedAmount:4}]})).success,false);
  assert.equal(creditInstitutionUpdateSchema.safeParse(input({institution:{totalUsed:5}})).success,false);
  assert.equal(creditInstitutionUpdateSchema.safeParse(input({items:[{type:'bond_investment',usedAmount:4}]})).success,true);
});

test('incremental import preserves old principal, dates, client override, flows and balances, including repeated imports',async t=>{
  const db=await database(t);
  const payload={snapshot:{asOfDate:'2026-09-04',totalYi:1},debts:[{
    sourceKey:'one',table:'debt',debtType:'同业拆借',subtype:null,name:'甲拆借',counterparty:'招商银行',amount:100000000,interestPayable:0,
    annualRate:0.02,issueDate:'2026-09-01',maturityDate:'2026-09-10',activatedAt:'2026-09-01',settledAt:null,closedAt:null,extension:{}
  }],cashflows:[{sourceKey:'one',cashflowType:'principal',dueDate:'2026-09-10',amount:100000000,sourceSequence:1}],balances:[{asOfDate:'2026-09-04',debtType:'同业拆借',subtype:'',amount:100000000}]};
  const first=await importDebtWorkbook(db,payload);
  assert.equal(first.insertedDebtCount,1);
  await db.exec('UPDATE financing.debt SET client_id=2');
  const prior=(await db.query('SELECT to_jsonb(d) row FROM financing.debt d')).rows[0].row;
  payload.debts[0].amount=200000000;payload.debts[0].maturityDate='2026-09-11';payload.debts[0].settledAt='2026-09-04';
  payload.cashflows[0].amount=200000000;payload.balances[0].amount=200000000;payload.snapshot.totalYi=2;
  const repeat=await importDebtWorkbook(db,payload);
  assert.equal(repeat.insertedDebtCount,0);assert.equal(repeat.skippedDebtCount,1);assert.equal(repeat.updatedDebtCount,0);
  assert.equal(repeat.insertedCashflowCount,0);assert.equal(repeat.warnings.length,1);
  assert.deepEqual((await db.query('SELECT to_jsonb(d) row FROM financing.debt d')).rows[0].row,prior);
  assert.equal(Number((await db.query('SELECT amount FROM financing.cashflow')).rows[0].amount),100000000);
  assert.equal(Number((await db.query('SELECT amount FROM financing.balance_snapshot')).rows[0].amount),100000000);
  payload.debts.push({...payload.debts[0],sourceKey:'two',name:'新拆借',issueDate:'2026-09-04',activatedAt:'2026-09-04',settledAt:null});
  const increment=await importDebtWorkbook(db,payload);
  assert.equal(increment.insertedDebtCount,1);
  assert.equal((await importDebtWorkbook(db,payload)).insertedDebtCount,0);
  payload.snapshot.totalYi=99;
  await assert.rejects(importDebtWorkbook(db,payload),/余额核对失败/);
  assert.equal((await db.query('SELECT count(*) n FROM financing.debt')).rows[0].n,2);
});

test('note cleanup removes only empty note records and parsing never recreates them',async t=>{
  const db=await database(t);
  await db.exec(`INSERT INTO financing.debt(debt_type,name,counterparty,amount) VALUES
    ('集团借款','备注','截至目前集团共发行3次可转债：',0),('集团借款','正常客户','集团公司',0)`);
  await db.exec(fs.readFileSync(new URL('../financing-migrations/0029_remove_group_loan_notes.sql',import.meta.url),'utf8'));
  assert.deepEqual((await db.query('SELECT name FROM financing.debt')).rows.map(r=>r.name),['正常客户']);
  const parsed={debts:[[1,'note','集团借款',null,null,null,null,null,'截至目前集团共发行3次可转债：',0,0]],cashflows:[],balances:[],records:[],recordGroups:[],fields:[],definitions:[],cells:[],snapshot:{asOfDate:'2026-09-04',totalYi:0}};
  assert.equal(transformWorkbook(parsed).debts.length,0);
});
