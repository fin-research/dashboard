import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { loadCreditReport, persistCreditWorkbook, saveCreditInstitution } from '../src/lib/server/credit-repository.ts';
import { creditInstitutionUpdateSchema } from '../src/lib/credit/update.ts';
import { creditItemTypes } from '../src/lib/credit/types.ts';
import { importDebtWorkbook } from '../src/lib/server/financing/debt-importer.js';
import { transformWorkbook } from '../scripts/financing/lib/debt-transform.mjs';

async function database(t, legacy = false) {
  const db = new PGlite();
  const query = db.query.bind(db);
  db.query = async (...args) => { const result = await query(...args); return {...result,rowCount: result.rows.length || result.affectedRows || 0}; };
  t.after(() => db.close());
  for (const name of ['0001_financing_postgres.sql','0007_detach_projects_from_debt.sql','0015_income_certificate_dates_and_names.sql','0028_client_master.sql','0031_bank_client_identity.sql']) {
    await db.exec(fs.readFileSync(new URL(`../financing-migrations/${name}`, import.meta.url),'utf8'));
  }
  for (const name of fs.readdirSync(new URL('../credit-migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort()) {
    if (!legacy || name < '0005') await db.exec(fs.readFileSync(new URL(`../credit-migrations/${name}`,import.meta.url),'utf8'));
  }
  await db.exec(`INSERT INTO public.client(name,fullname,type,subtype) VALUES
    ('招商银行','招商银行股份有限公司','银行','股份行'),('中银理财','中银理财有限责任公司','理财子',NULL),('乙银行',NULL,'银行','城商行');
    INSERT INTO public.client_alias(alias,match_kind,client_id,notes) VALUES
    ('^银行-申万宏源证券资产管理有限公司\\(代“申万宏源招行凭证一号单一资产管理计划','pattern',1,'实际投资人'),
    (public.normalize_client_name('银行-信银理财有限责任公司（代中银理财之乐赢稳健和信一年定开5期净值型人民币理财产品）'),'exact',2,'用户确认');`);
  return db;
}

async function institution(db, date='2026-09-04', name='合并授信') {
  await db.query(`INSERT INTO credit.institution(report_date,institution_name,institution_type,confidentiality_status,status,total_limit,total_used)
    VALUES ($1,$2,'银行',false,'approved',20,10)`,[date,name]);
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

test('static combined credit sums clients once, excludes matured/future/closed debt, and preserves original usage',async t=>{
  const db=await database(t);
  await db.exec(`INSERT INTO credit.institution_client(institution_name,client_id,notes) VALUES ('合并授信',1,'明确合并'),('合并授信',2,'明确合并')`);
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
  await assert.rejects(db.query(`INSERT INTO credit.institution_client(institution_name,client_id,notes) VALUES ('重复授信',1,'重复测试')`),/unique/);
  const unknown=(await loadCreditReport(db)).institutions.find(i=>i.institutionName==='重复授信');
  assert.equal(unknown.totalUsed,null);
  assert.equal(unknown.availableAmount,null);
  // Other manually maintained usage changes the total, financing usage is read-only.
  await saveCreditInstitution(db,{reportDate:'2026-09-04',institutionName:'合并授信',changes:{items:[{type:'other',usedAmount:5}]}});
  assert.equal((await loadCreditReport(db)).institutions[0].totalUsed,12);
});

test('credit import keeps static manual mappings and automatically links clear new customers',async t=>{
  const db=await database(t);
  await institution(db,'2026-09-04','乙银行');
  assert.equal((await db.query('SELECT client_id FROM credit.institution_client')).rows[0].client_id,3);
  await db.query("UPDATE credit.institution_client SET client_id=2,notes='人工确认主体'");
  const original=(await loadCreditReport(db)).institutions[0];
  await persistCreditWorkbook(db,{parsed:{reportDate:'2026-09-04',institutions:[original],approvedCount:1,totalLimit:20,totalUsed:10,totalAvailable:10,weeklyApprovedCount:1,weeklyTotalLimit:20,weeklyTotalUsed:10,weeklyTotalAvailable:10}});
  assert.equal((await db.query('SELECT client_id FROM credit.institution_client')).rows[0].client_id,2);
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

test('item changes, deletion and direct header updates always preserve the item sum', async t => {
  const db = await database(t);
  await institution(db, '2026-08-21', '乙银行');
  const total = async () => Number((await db.query('SELECT total_used FROM credit.institution')).rows[0].total_used);
  assert.equal(await total(), 10);
  await db.query("UPDATE credit.institution SET total_used=99");
  assert.equal(await total(), 10);
  await db.query("UPDATE credit.item SET used_amount=0.0245 WHERE item_type='other'");
  assert.equal(await total(), 8.0245);
  await db.query("DELETE FROM credit.item WHERE item_type='yield_certificate'");
  assert.equal(await total(), 0.0245);
  await db.query("INSERT INTO credit.item(report_date,institution_name,item_type,used_amount) VALUES ('2026-08-21','乙银行','yield_certificate',45)");
  assert.equal(await total(), 45.0245);
  // A static manual ownership edit affects all report dates and survives a reimport.
  await institution(db, '2026-08-28', '乙银行');
  assert.equal((await db.query('SELECT count(*) n FROM credit.institution_client')).rows[0].n, 1);
  const report = await loadCreditReport(db, '2026-08-21');
  assert.equal(report.institutions[0].totalUsed, 0.0245);
  assert.equal(report.summary.totalUsed, report.weeklySummary.totalUsed);
});

test('bank proprietary and asset clients own both financing types independently without item flags', async t => {
  const db = await database(t);
  await db.query("INSERT INTO public.client(name,type,subtype) VALUES ('乙银行资管','理财子','银行资管')");
  for (const name of ['乙银行（金市）', '乙银行（资管）']) await institution(db, '2026-09-04', name);
  await db.query(`INSERT INTO financing.debt(debt_type,name,counterparty,amount,activated_at,maturity_date) VALUES
    ('收益凭证','银行凭证','乙银行',100000000,'2026-08-01','2027-08-01'),
    ('同业拆借','银行拆借','乙银行',200000000,'2026-08-01','2027-08-01'),
    ('收益凭证','资管凭证','乙银行（资管）',300000000,'2026-08-01','2027-08-01'),
    ('同业拆借','资管拆借','乙银行资管',400000000,'2026-08-01','2027-08-01')`);
  const report = await loadCreditReport(db);
  const usage = name => report.institutions.find(i=>i.institutionName===name).items.filter(i=>i.usageSource==='financing').map(i=>i.usedAmount);
  assert.deepEqual(usage('乙银行（金市）'), [1,2]);
  assert.deepEqual(usage('乙银行（资管）'), [3,4]);
  assert.equal(report.summary.totalUsed, 14); // 10 financing + 2 other per subject.
  assert.equal((await db.query("SELECT count(*) n FROM information_schema.columns WHERE table_schema='credit' AND table_name='institution_client' AND column_name IN ('yield_certificate','interbank_lending')")).rows[0].n,0);
});

test('confirmed 2021 group-loan typo is normalized before incremental identity matching', async t => {
  const db = await database(t);
  await db.query("INSERT INTO public.client(name,type) VALUES ('集团公司','其它')");
  const raw={debts:[[1,'group','集团借款',null,null,null,null,null,'东方财富证券股份有限公司',500000000,500000000,'CNY',null,'2021-09-06','2021-09-14','matured']],cashflows:[],balances:[],records:[],recordGroups:[],fields:[],definitions:[],cells:[],snapshot:{asOfDate:'2021-09-14',totalYi:0}};
  const payload=transformWorkbook(raw);
  assert.equal(payload.debts[0].counterparty,'集团公司');
  assert.equal(payload.debts[0].name,'集团借款·集团公司·2021-09-06');
  await db.query(`INSERT INTO financing.debt(id,debt_type,name,counterparty,amount,issue_date,maturity_date)
    VALUES (9445,'集团借款','集团借款·东方财富证券股份有限公司·2021-09-06','东方财富证券股份有限公司',500000000,'2021-09-06','2021-09-14')`);
  await db.exec(fs.readFileSync(new URL('../financing-migrations/0030_correct_group_loan_counterparty.sql',import.meta.url),'utf8'));
  const result=await importDebtWorkbook(db,payload);
  assert.equal(result.insertedDebtCount,0);
  assert.equal(result.skippedDebtCount,1);
  assert.equal((await db.query('SELECT counterparty FROM financing.debt WHERE id=9445')).rows[0].counterparty,'集团公司');
});

test('nonempty migration converts all NDA states, consolidates dates and applies the confirmed historical amounts', async t => {
  const db=await database(t,true);
  await db.query(`INSERT INTO credit.client_mapping(institution_name,client_id,notes) VALUES ('浦发银行',1,'测试'),('北京农商行',2,'测试'),('昆山农商行',3,'测试')`);
  await db.query(`INSERT INTO credit.institution(report_date,source_row,institution_name,institution_type,confidentiality_status,status,included_in_weekly_report,total_limit,total_used) VALUES
    ('2026-08-28',4,'浦发银行','股份行','signed','approved',false,100,87.5),
    ('2026-08-21',5,'北京农商行','农商行','not_signed','approved',true,20,9.0245),
    ('2026-08-21',6,'昆山农商行','农商行','unknown','approved',false,10,0),
    ('2026-08-28',5,'北京农商行','农商行','not_signed','approved',true,20,9)`);
  await db.query(`INSERT INTO credit.item(report_date,institution_name,item_type,used_amount)
    SELECT i.report_date,i.institution_name,t::credit.item_type,
      CASE WHEN institution_name='浦发银行' THEN CASE t WHEN 'yield_certificate' THEN 65 WHEN 'bond_investment' THEN 7.5 WHEN 'interbank_lending' THEN 5 WHEN 'other' THEN 10 ELSE 0 END
        WHEN institution_name='北京农商行' THEN CASE t WHEN 'yield_certificate' THEN 5 WHEN 'bond_investment' THEN 4 ELSE 0 END
        ELSE CASE t WHEN 'bond_investment' THEN 0.5 ELSE 0 END END
    FROM credit.institution i CROSS JOIN unnest($1::text[]) t`,[creditItemTypes]);
  await db.exec(fs.readFileSync(new URL('../credit-migrations/0005_static_clients_and_usage_totals.sql',import.meta.url),'utf8'));
  const rows=(await db.query("SELECT institution_name,confidentiality_status,total_used::float8 FROM credit.institution WHERE (report_date='2026-08-21') OR institution_name='浦发银行' ORDER BY institution_name")).rows;
  assert.deepEqual(rows.map(r=>[r.institution_name,r.confidentiality_status,r.total_used]),[['北京农商行',false,9.0245],['昆山农商行',false,0.5],['浦发银行',true,67.5]]);
  assert.equal((await db.query('SELECT count(*) n FROM credit.institution_client')).rows[0].n,3);
  assert.equal((await db.query("SELECT count(*) n FROM information_schema.columns WHERE table_schema='credit' AND (column_name IN ('source_row','included_in_weekly_report') OR (table_name='institution_client' AND column_name='report_date'))")).rows[0].n,0);
  assert.equal((await db.query("SELECT to_regclass('credit.client_mapping') old_table")).rows[0].old_table,null);
});


test('explicit bank asset suffixes resolve to separate wealth clients, while unmarked banks and verified investors stay proprietary', async t => {
  const db=await database(t);
  await db.query("INSERT INTO public.client(name,type,subtype) VALUES ('招商银行资管','理财子','银行资管')");
  for (const raw of ['招商银行（资管）','招商银行资管','招商银行资产管理部','银行-招商银行股份有限公司(资产管理)']) {
    assert.equal((await db.query('SELECT public.resolve_client($1) id',[raw])).rows[0].id,4);
  }
  for (const raw of ['招商银行','银行-招商银行股份有限公司','招商银行（金市）','招商银行自营','银行-申万宏源证券资产管理有限公司（代“申万宏源招行凭证一号单一资产管理计划”）']) {
    assert.equal((await db.query('SELECT public.resolve_client($1) id',[raw])).rows[0].id,1);
  }
  // An explicit asset department must never silently fall back to its bank when missing.
  assert.equal((await db.query("SELECT public.resolve_client('乙银行（资管）') id")).rows[0].id,null);
  assert.equal((await db.query("SELECT public.resolve_client('未知银行（资管）') id")).rows[0].id,null);
});

test('bank asset migration separates existing identities and aliases without changing business amounts', async t => {
  const db=await database(t,true);
  await db.exec(fs.readFileSync(new URL('../credit-migrations/0005_static_clients_and_usage_totals.sql',import.meta.url),'utf8'));
  await db.query(`INSERT INTO credit.institution_client(institution_name,client_id,yield_certificate,interbank_lending,notes) VALUES
    ('乙银行（金市）',3,false,true,'旧品种分配'),('乙银行（资管）',3,true,false,'旧品种分配')`);
  await db.query("INSERT INTO public.client_alias(alias,client_id,notes) VALUES ('乙银行(资管)',3,'旧银行别名')");
  for(const name of ['乙银行（金市）','乙银行（资管）']) await institution(db,'2026-09-04',name);
  await db.query(`INSERT INTO financing.debt(debt_type,name,counterparty,client_id,amount,activated_at,maturity_date) VALUES
    ('收益凭证','未标注资管','乙银行',3,100000000,'2026-08-01','2027-08-01'),
    ('收益凭证','明确资管','银行-乙银行（资管）',3,200000000,'2026-08-01','2027-08-01')`);
  await db.exec(fs.readFileSync(new URL('../credit-migrations/0006_bank_asset_management_clients.sql',import.meta.url),'utf8'));
  const asset=(await db.query("SELECT * FROM public.client WHERE name='乙银行资管'")).rows[0];
  assert.equal(asset.type,'理财子');assert.equal(asset.fullname,null);
  assert.deepEqual((await db.query("SELECT name,client_id,amount::float8 amount FROM financing.debt ORDER BY name")).rows,
    [{name:'明确资管',client_id:asset.id,amount:200000000},{name:'未标注资管',client_id:3,amount:100000000}]);
  assert.equal((await db.query("SELECT client_id FROM public.client_alias WHERE alias='乙银行(资管)'")).rows[0].client_id,asset.id);
  await assert.rejects(db.query("INSERT INTO credit.institution_client(institution_name,client_id,notes) VALUES ('重复主体',3,'重复')"),/unique/);
});
