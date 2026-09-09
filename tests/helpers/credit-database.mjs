import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

export async function creditDatabase(t, beforeDiff = false) {
  const db = new PGlite();
  const query = db.query.bind(db);
  db.query = async (...args) => { const r = await query(...args); return {...r,rowCount:r.rows.length || r.affectedRows || 0}; };
  t.after(() => db.close());
  for (const name of ['0001_financing_postgres.sql','0007_detach_projects_from_debt.sql','0015_income_certificate_dates_and_names.sql','0028_client_master.sql','0031_bank_client_identity.sql']) {
    await db.exec(fs.readFileSync(new URL(`../../financing-migrations/${name}`,import.meta.url),'utf8'));
  }
  for (const name of fs.readdirSync(new URL('../../credit-migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort()) {
    if (!beforeDiff || name < '0008') await db.exec(fs.readFileSync(new URL(`../../credit-migrations/${name}`,import.meta.url),'utf8'));
  }
  return db;
}

export async function seedCredit(db,date='2026-08-21',name='甲银行',patch={}) {
  await db.query("INSERT INTO public.client(name,type) VALUES ($1,'银行') ON CONFLICT(name) DO NOTHING",[name]);
  return db.query('SELECT credit.append_diff($1::date,$2,$3::jsonb,$4) AS id',[date,name,JSON.stringify({
    institution_type:'股份行',status:'approved',confidentiality_status:false,total:10,
    bond_investment_used:3,bond_investment_limit:4,effective_date:'2026-01-01',expiry_date:'2026-08-30',...patch
  }),'auth0|test']);
}
