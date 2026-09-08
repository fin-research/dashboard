import fs from 'node:fs';
import { Client } from 'pg';

const outputPath=process.argv.slice(2).find(arg=>!arg.startsWith('--'));
const db=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:15_000,application_name:'eastmoney-client-reconciliation'});
await db.connect();
try {
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const report={generatedAt:new Date().toISOString()};
  report.clients=(await db.query('SELECT id::text,name,fullname,type,subtype FROM public.client ORDER BY type,name')).rows;
  report.coverage=(await db.query(`SELECT count(*) AS debt_count,count(client_id) AS linked_count,
    count(*) FILTER(WHERE counterparty IS NOT NULL AND client_id IS NULL) AS named_unlinked_count,
    count(*) FILTER(WHERE counterparty IS NULL) AS missing_name_count FROM financing.debt`)).rows[0];
  report.reconciliation=(await db.query(`SELECT to_char(report_date,'YYYY-MM-DD') AS report_date,institution_name,item_type,
    imported_used_amount::float8,financing_used_amount::float8,difference::float8,linked_client_count::integer,status
    FROM credit.usage_reconciliation ORDER BY report_date,institution_name,item_type`)).rows;
  report.totalDiscrepancies=(await db.query(`SELECT to_char(i.report_date,'YYYY-MM-DD') AS report_date,i.institution_name,
    i.total_used::float8 AS imported_total,sum(coalesce(t.used_amount,0))::float8 AS item_total,
    (i.total_used-sum(coalesce(t.used_amount,0)))::float8 AS difference
    FROM credit.institution i JOIN credit.item t USING(report_date,institution_name)
    GROUP BY i.report_date,i.institution_name,i.total_used
    HAVING abs(i.total_used-sum(coalesce(t.used_amount,0)))>0.0001 ORDER BY i.report_date,i.institution_name`)).rows;
  report.unlinked=(await db.query(`SELECT id::text,debt_type,name,counterparty,amount::float8,
    to_char(issue_date,'YYYY-MM-DD') AS issue_date,to_char(maturity_date,'YYYY-MM-DD') AS maturity_date
    FROM financing.debt WHERE client_id IS NULL ORDER BY debt_type,id`)).rows;
  report.creditMappings=(await db.query(`SELECT m.institution_name,c.name AS client_name,m.yield_certificate,m.interbank_lending,m.notes
    FROM credit.institution_client m JOIN public.client c ON c.id=m.client_id ORDER BY m.institution_name,c.name`)).rows;
  report.latestOutstanding=(await db.query(`SELECT c.name,c.type,u.debt_type,(u.amount/100000000)::float8 AS amount_yi,u.debt_count::integer,
    m.institution_name FROM financing.credit_usage_as_of((SELECT max(report_date) FROM credit.institution)) u
    LEFT JOIN public.client c ON c.id=u.client_id
    LEFT JOIN credit.institution_client m ON m.client_id=u.client_id
      AND CASE u.debt_type WHEN '收益凭证' THEN m.yield_certificate ELSE m.interbank_lending END
    ORDER BY c.type,c.name,u.debt_type`)).rows;
  await db.query('COMMIT');
  if(outputPath) fs.writeFileSync(outputPath,JSON.stringify(report,null,2),{mode:0o600});
  console.log(JSON.stringify({clients:report.clients.length,coverage:report.coverage,
    mismatches:report.reconciliation.filter(r=>r.status!=='matched'),totalDiscrepancies:report.totalDiscrepancies,
    output:outputPath??null},null,2));
} finally {await db.end();}
