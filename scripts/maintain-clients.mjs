import fs from 'node:fs';
import { Client } from 'pg';
import { z } from 'zod';

const inputPath = process.argv.slice(2).find(arg => !arg.startsWith('--'));
if (!inputPath) throw new Error('用法：node scripts/maintain-clients.mjs <客户清单.json> [--apply]；默认事务回滚预览');
const name = z.string().trim().min(1).max(500);
const schema = z.object({
  clients: z.array(z.object({ name, fullname: name.nullable(), type: z.enum(['银行','理财子','券商','基金','营业部客户','其它']), subtype: name.nullable() })),
  aliases: z.array(z.object({ alias: name, matchKind: z.enum(['exact','pattern']), clientName: name, notes: name })),
  creditMappings: z.array(z.object({ institutionName: name, clientName: name, yieldCertificate: z.boolean(), interbankLending: z.boolean(), notes: name }))
});
const manifest = schema.parse(JSON.parse(fs.readFileSync(inputPath, 'utf8')));
const clientNames = new Set(manifest.clients.map(c => c.name));
if (clientNames.size !== manifest.clients.length) throw new Error('客户简称重复');
for (const item of [...manifest.aliases, ...manifest.creditMappings]) {
  if (!clientNames.has(item.clientName)) throw new Error(`关联客户未在清单中定义：${item.clientName}`);
}
const database = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15_000, application_name: 'eastmoney-client-maintenance' });
await database.connect();
try {
  await database.query('BEGIN');
  await database.query("SELECT pg_advisory_xact_lock(hashtext('financing.local_debt_maintenance'))");
  await database.query("SELECT pg_advisory_xact_lock(hashtextextended('credit.excel_import', 0))");
  await database.query(`INSERT INTO public.client (name,fullname,type,subtype)
    SELECT name,fullname,type,subtype FROM jsonb_to_recordset($1::jsonb) AS x(name text,fullname text,type text,subtype text)
    ON CONFLICT(name) DO UPDATE SET fullname=EXCLUDED.fullname,type=EXCLUDED.type,subtype=EXCLUDED.subtype`, [JSON.stringify(manifest.clients)]);
  await database.query(`INSERT INTO public.client_alias(alias,match_kind,client_id,notes)
    SELECT CASE WHEN x."matchKind"='exact' THEN public.normalize_client_name(x.alias) ELSE x.alias END,
      x."matchKind",c.id,x.notes
    FROM jsonb_to_recordset($1::jsonb) AS x(alias text,"matchKind" text,"clientName" text,notes text)
    JOIN public.client c ON c.name=x."clientName"
    ON CONFLICT(alias,match_kind) DO UPDATE SET client_id=EXCLUDED.client_id,notes=EXCLUDED.notes`, [JSON.stringify(manifest.aliases)]);
  await database.query(`INSERT INTO credit.institution_client(institution_name,client_id,yield_certificate,interbank_lending,notes)
    SELECT x."institutionName",c.id,x."yieldCertificate",x."interbankLending",x.notes
    FROM jsonb_to_recordset($1::jsonb) AS x("institutionName" text,"clientName" text,"yieldCertificate" boolean,"interbankLending" boolean,notes text)
    JOIN public.client c ON c.name=x."clientName"
    ON CONFLICT(institution_name,client_id) DO UPDATE SET yield_certificate=EXCLUDED.yield_certificate,interbank_lending=EXCLUDED.interbank_lending,notes=EXCLUDED.notes`, [JSON.stringify(manifest.creditMappings)]);
  const linked = await database.query(`WITH names AS MATERIALIZED (SELECT counterparty,public.resolve_client(counterparty) AS client_id
      FROM (SELECT DISTINCT counterparty FROM financing.debt WHERE client_id IS NULL) names)
    UPDATE financing.debt d SET client_id=n.client_id FROM names n
    WHERE d.client_id IS NULL AND d.counterparty=n.counterparty AND n.client_id IS NOT NULL`);
  const {rows} = await database.query(`SELECT
    (SELECT count(*) FROM public.client) AS clients,
    (SELECT count(*) FROM financing.debt WHERE client_id IS NOT NULL) AS linked_debts,
    (SELECT count(*) FROM financing.debt WHERE client_id IS NULL) AS unlinked_debts,
    (SELECT count(*) FROM credit.institution_client) AS credit_links,
    (SELECT count(*) FROM credit.usage_reconciliation WHERE report_date=(SELECT max(report_date) FROM credit.institution) AND status='mismatch') AS latest_mismatches,
    (SELECT count(*) FROM credit.usage_reconciliation WHERE report_date=(SELECT max(report_date) FROM credit.institution) AND status='unlinked') AS latest_unlinked`);
  await database.query(process.argv.includes('--apply') ? 'COMMIT' : 'ROLLBACK');
  console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'applied' : 'rollback-preview', linkedNow: linked.rowCount, ...rows[0] },null,2));
} catch (error) {
  await database.query('ROLLBACK').catch(() => {});
  throw error;
} finally { await database.end(); }
