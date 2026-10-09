import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCreditReport } from '../src/lib/server/credit-repository.ts';
import { compareCreditInstitutionOrder } from '../src/lib/credit/presentation.ts';

const base = { id: 1, institution_name: '甲银行', effective_on: '2026-08-01', created_at: '2026-08-01T00:00:00Z',
  created_by: null, updated_at: null, type: 'maintenance', confidentiality_status:false, status: 'approved', institution_type: '城商行',
  effective_date: '2026-08-01', expiry_date: '2026-08-31', total: 10, bond_investment_secondary_used: 2 };
import {creditDatabase,seedCredit} from './helpers/credit-database.mjs';

test('calendar usage queries include only affected institutions while table dates retain every balance',async t=>{
  const db=await creditDatabase(t);
  for(const name of ['甲银行','乙银行'])await seedCredit(db,'2026-08-21',name,{expiry_date:'2026-12-31',bond_investment_secondary_used:0});
  await db.exec(`INSERT INTO financing.debt(debt_type,name,client_id,amount,activated_at,maturity_date) VALUES
    ('同业拆借','甲拆借',(SELECT id FROM public.client WHERE name='甲银行'),100000000,'2026-09-04','2026-12-31'),
    ('同业拆借','乙拆借',(SELECT id FROM public.client WHERE name='乙银行'),200000000,'2026-09-05','2026-12-31')`);
  const query=db.query.bind(db);let balances;
  const client={query:async(sql,params)=>{const r=await query(sql,params);if(sql.includes('financing.credit_usage_as_of(d.date)'))balances=r.rows;return r;}};
  const report=await loadCreditReport(client,'2026-09-15','2026-09');
  assert.deepEqual(report.institutions.map(i=>i.totalUsed).sort(),[1,2]);
  assert.ok(balances.some(r=>r.date==='2026-09-04'&&r.institution_name==='甲银行'&&r.amount===1));
  assert.equal(balances.some(r=>r.date==='2026-09-04'&&r.institution_name==='乙银行'),false);
  assert.ok(balances.some(r=>r.date==='2026-09-08'&&r.institution_name==='乙银行'&&r.amount===2));
  assert.ok(report.calendarEvents.some(e=>e.date==='2026-09-04'&&e.institutionName==='甲银行'&&/增加1亿元/.test(e.label)));
  assert.ok(report.calendarEvents.some(e=>e.date==='2026-09-05'&&e.institutionName==='乙银行'&&/增加2亿元/.test(e.label)));
});

test('lazy snapshots retain historical renewal periods and independent amount/calendar states', async t => {
  const db=await creditDatabase(t);
  await db.query("INSERT INTO public.client(name,type) VALUES ('甲银行','银行')");
  const rows = [base,
    { id: 2, institution_name: '甲银行', effective_on: '2026-08-20', created_at: '2026-08-20T00:00:00Z', created_by: null,
      updated_at: null, type: 'renewal', effective_date: '2026-09-01', expiry_date: '2026-09-30', total: 12 },
    { id: 3, institution_name: '甲银行', effective_on: '2026-08-25', created_at: '2026-08-25T00:00:00Z', created_by: null,
      updated_at: null, type: 'maintenance', bond_investment_secondary_used: 4 },
    { id: 4, institution_name: '甲银行', effective_on: '2026-09-10', created_at: '2026-09-10T00:00:00Z', created_by: null,
      updated_at: null, type: 'renewal', effective_date: '2026-10-01', expiry_date: '2030-01-31' }];
  for (const row of rows) {
    const {id,institution_name,effective_on,created_at,created_by,updated_at,type,...patch}=row;
    await db.query('SELECT credit.append_diff($1::date,$2,$3::jsonb,$4,$5)',[effective_on,institution_name,JSON.stringify(patch),created_by,type]);
  }
  const august = await loadCreditReport(db, '2026-08-26');
  assert.equal(august.institutions[0].totalLimit, 12);
  assert.equal(august.institutions[0].totalUsed, 4);
  assert.deepEqual(august.institutions[0].previousPeriod, { effectiveDate: '2026-08-01', expiryDate: '2026-08-31' });
  assert.equal(august.previousSummary.totalLimit, 10);
  assert.equal(august.previousSummary.totalUsed, 2);
  assert.ok(august.calendarEvents.some(e => e.date === '2026-08-25' && e.usageComponent === 'secondary' && /增加2亿元/.test(e.label)));
  const september = await loadCreditReport(db, '2026-09-15');
  assert.deepEqual(september.institutions[0].previousPeriod, { effectiveDate: '2026-09-01', expiryDate: '2026-09-30' });
  const futureCalendar = await loadCreditReport(db, '2026-09-15', '2030-01');
  assert.ok(futureCalendar.calendarEvents.some(e => e.kind === 'expiry' && e.date === '2030-01-31'));
  assert.equal(september.calendarEvents.some(e => e.date === '2030-01-31'), false);
});

test('reused Chinese collators preserve legacy type and numeric name ordering', () => {
  const rows = ['甲银行10', '甲银行2', '乙银行', 'A银行', '甲银行01'].flatMap(institutionName =>
    ['城商行', '股份行', '国有行', '国有银行', '其它', '其他'].map(institutionType => ({ institutionName, institutionType })));
  const order = { '国有行': 1, '国有银行': 1, '股份行': 2, '城商行': 3 };
  const legacy = (a,b) => (order[a.institutionType] ?? 7) - (order[b.institutionType] ?? 7)
    || a.institutionType.localeCompare(b.institutionType, 'zh-CN')
    || a.institutionName.localeCompare(b.institutionName, 'zh-CN', { numeric: true });
  assert.deepEqual([...rows].sort(compareCreditInstitutionOrder), [...rows].sort(legacy));
});
