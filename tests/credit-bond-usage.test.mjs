import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { creditDatabase, seedCredit } from './helpers/credit-database.mjs';
import { loadCreditReport, persistCreditWorkbook, saveCreditInstitution } from '../src/lib/server/credit-repository.ts';
import { creditInstitutionUpdateSchema } from '../src/lib/credit/update.ts';

async function allocate(db,name,amount,start,end,client='甲银行',closure=null) {
  const id=(await db.query(`INSERT INTO financing.bond(debt_type,subtype,name,amount,issue_date,maturity_date,settled_at)
    VALUES ('债券','小公募',$1,$2,$3,$4,$5) RETURNING id`,[name,amount*1e8,start,end,closure])).rows[0].id;
  await db.query(`INSERT INTO financing.bond_investors(bond_id,investor_id,amount)
    VALUES ($1,(SELECT id FROM public.client WHERE name=$2),$3)`,[id,client,amount*1e8]);
  return id;
}
const bond=r=>r.institutions[0].items.find(i=>i.type==='bond_investment');

test('一级存续按实际投资人汇总，发行、到期和提前结清触发已用变化，二级买卖可为负',async t=>{
  const db=await creditDatabase(t);await seedCredit(db,'2026-08-01','甲银行',{bond_investment_secondary_used:-0.5});
  await allocate(db,'期一',2,'2026-08-20','2026-08-25');
  await allocate(db,'期二',3,'2026-08-21','2026-09-25','甲银行','2026-08-24');
  await allocate(db,'未知投资人',10,'2026-08-21','2026-09-25','不存在');
  const historical=await loadCreditReport(db,'2026-08-22');
  assert.equal(bond(historical).primaryUsedAmount,5);assert.equal(bond(historical).secondaryUsedAmount,-0.5);
  assert.equal(bond(historical).usedAmount,4.5);assert.equal(historical.summary.totalUsed,4.5);
  const r=await loadCreditReport(db,'2026-08-26');
  assert.equal(bond(r).primaryUsedAmount,0);assert.equal(bond(r).usedAmount,-0.5);
  assert.deepEqual(r.calendarEvents.filter(e=>e.usageComponent==='primary').map(e=>[e.date,e.label]),[
    ['2026-08-20','债券投资——一级发行 · 增加2亿元'],['2026-08-21','债券投资——一级发行 · 增加3亿元'],
    ['2026-08-24','债券投资——一级发行 · 减少3亿元'],['2026-08-25','债券投资——一级发行 · 减少2亿元'],
  ]);
});

test('一级和二级同日抵消仍逐项展示，二级编辑进入总已用与周比较且重复保存幂等',async t=>{
  const db=await creditDatabase(t);await seedCredit(db,'2026-08-01','甲银行',{bond_investment_secondary_used:0});
  await allocate(db,'新发行',2,'2026-08-21','2027-08-21');
  const patch={reportDate:'2026-08-21',institutionName:'甲银行',changes:{items:[{type:'bond_investment',secondaryUsedAmount:-2}]}};
  await saveCreditInstitution(db,patch,'auth0|test');
  const before=(await db.query('SELECT count(*) n FROM credit.diff')).rows[0].n;
  await saveCreditInstitution(db,patch,'auth0|test');
  assert.equal((await db.query('SELECT count(*) n FROM credit.diff')).rows[0].n,before);
  const r=await loadCreditReport(db,'2026-08-21');assert.equal(r.summary.totalUsed,0);
  assert.equal(r.calendarEvents.filter(e=>e.date==='2026-08-21'&&e.type==='usage').length,2);
  assert.ok(r.calendarEvents.some(e=>e.usageComponent==='secondary'&&e.label==='债券投资——二级买卖 · 减少2亿元'));
  assert.equal(r.usageChanges.length,1);assert.equal(r.usageChanges[0].deltaAmount,0);
  assert.ok(r.usageChanges[0].details.some(d=>d.includes('二级买卖')));
  await saveCreditInstitution(db,{...patch,reportDate:'2026-08-22',changes:{items:[{type:'bond_investment',secondaryUsedAmount:null}]}},'auth0|test');
  assert.equal(bond(await loadCreditReport(db,'2026-08-22')).usedAmount,2);
});

test('非空历史迁移逐期保持真实余额，未变真实值也在到期后重算残差，退休分项归其它',async t=>{
  const db=await creditDatabase(t,false,true);
  await db.exec("INSERT INTO public.client(name,type) VALUES ('甲银行','银行')");
  await db.query(`SELECT credit.append_diff('2026-08-21','甲银行',$1::jsonb,NULL)`,[JSON.stringify({
    institution_type:'股份行',status:'approved',confidentiality_status:false,total:10,bond_investment_used:3,
    other_limit:1,other_used:0.5,other_detail:'原其它',margin_income_rights_limit:4,margin_income_rights_used:1,margin_income_rights_detail:'两融旧说明',
  })]);
  await db.query(`SELECT credit.append_diff('2026-08-28','甲银行','{"notes":"第二期，债券真实余额未变","margin_income_rights_used":0}'::jsonb,NULL)`);
  await allocate(db,'到期债券',2,'2026-01-01','2026-08-25');
  const original=(await db.query('SELECT to_jsonb(d) data FROM credit.diff d ORDER BY id')).rows;
  // Test rollback as well as successful application against populated rows.
  await db.exec('BEGIN');
  await db.exec(fs.readFileSync(new URL('../credit-migrations/0009_bond_usage_and_other.sql',import.meta.url),'utf8'));
  assert.equal(bond(await loadCreditReport(db,'2026-08-21')).secondaryUsedAmount,1);
  await db.exec('ROLLBACK');
  assert.deepEqual((await db.query('SELECT to_jsonb(d) data FROM credit.diff d ORDER BY id')).rows,original);
  await db.exec(fs.readFileSync(new URL('../credit-migrations/0009_bond_usage_and_other.sql',import.meta.url),'utf8'));
  for(const [date,primary,secondary,other] of [['2026-08-21',2,1,1.5],['2026-08-28',0,3,0.5]]) {
    const r=await loadCreditReport(db,date);assert.equal(bond(r).usedAmount,3);
    assert.equal(bond(r).primaryUsedAmount,primary);assert.equal(bond(r).secondaryUsedAmount,secondary);
    const item=r.institutions[0].items.find(i=>i.type==='other');assert.equal(item.usedAmount,other);assert.equal(item.limitAmount,5);
    assert.equal(item.details,'原其它；两融收益权转让：两融旧说明');
    assert.equal(r.institutions[0].items.some(i=>i.type==='margin_income_rights'),false);
  }
  const retained=(await db.query('SELECT to_jsonb(d) data FROM credit.diff d WHERE id<=2 ORDER BY id')).rows;
  for(let i=0;i<retained.length;i++) {delete retained[i].data.bond_investment_secondary_used;assert.deepEqual(retained[i],original[i]);}
});

test('旧台账导入按真实值登记残差；无客户关联非零值拒绝且回滚，不伪造为零',async t=>{
  const db=await creditDatabase(t);await seedCredit(db,'2026-08-01','甲银行',{bond_investment_secondary_used:0});
  await allocate(db,'发行',5,'2026-08-01','2027-08-01');
  const source=(await loadCreditReport(db,'2026-08-21')).institutions[0];source.items.find(i=>i.type==='bond_investment').usedAmount=3;
  const parsed={reportDate:'2026-08-21',institutions:[source],warnings:[]};
  await persistCreditWorkbook(db,{parsed,createdBy:'auth0|test'});
  const current=await loadCreditReport(db,'2026-08-21');assert.equal(bond(current).secondaryUsedAmount,-2);assert.equal(bond(current).usedAmount,3);
  assert.equal((await persistCreditWorkbook(db,{parsed,createdBy:'auth0|test'})).addedDiffCount,0);
  const missing={...source,institutionName:'未维护客户'};
  const before=(await db.query('SELECT count(*) n FROM credit.diff')).rows[0].n;
  await assert.rejects(persistCreditWorkbook(db,{parsed:{...parsed,institutions:[missing]}}),/缺少客户关联/);
  assert.equal((await db.query('SELECT count(*) n FROM credit.diff')).rows[0].n,before);
});

test('API 只允许债券二级净余额输入，移除两融收益权转让并拒绝非有限数值',()=>{
  const valid=item=>creditInstitutionUpdateSchema.safeParse({reportDate:'2026-09-10',institutionName:'甲',changes:{items:[item]}}).success;
  assert.equal(valid({type:'bond_investment',secondaryUsedAmount:-0.1}),true);
  assert.equal(valid({type:'bond_investment',usedAmount:1}),false);
  assert.equal(valid({type:'other',secondaryUsedAmount:1}),false);
  assert.equal(valid({type:'margin_income_rights',usedAmount:0}),false);
  assert.equal(valid({type:'bond_investment',secondaryUsedAmount:Infinity}),false);
});
