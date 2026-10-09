import type { DatabaseClient } from './postgres.ts';

export type CreditStateRequest = { date: string; names: string[] | null; include_details?: boolean };
export type CreditStateRow = { date: string; position: number; data: import('../credit/data.ts').CreditDataState['data'];
  previous_period: { effectiveDate: string; expiryDate: string } | null };

// Field inheritance belongs to the existing SQL snapshot. Only request the dates
// and institutions consumed by the table or the bounded event windows.
const stateSql = () => `
  WITH requested AS MATERIALIZED (
    SELECT r.date::date AS date,r.names,coalesce(r.include_details,true) AS include_details FROM jsonb_to_recordset($1::jsonb) r(date text,names text[],include_details boolean)
  ), states AS MATERIALIZED (
    SELECT r.date,(SELECT jsonb_object_agg(field.key,field.value) FROM jsonb_each(to_jsonb(s)) field
      WHERE field.key=ANY('{institution_name,institution_type,confidentiality_status,status,total,effective_date,expiry_date,bond_investment_limit,bond_investment_detail,bond_investment_secondary_used,yield_certificate_limit,legal_overdraft_limit,legal_overdraft_used,interbank_lending_limit,other_detail,other_used}'::text[])
        OR r.include_details AND field.key=ANY('{notes,bank_office,applying_department,handler,detail,bond_preference,updated_at,created_at}'::text[])) || jsonb_build_object('last_changed_on',(SELECT to_char(d.effective_on,'YYYY-MM-DD') FROM credit.diff d WHERE d.id=s.id)) AS data FROM requested r

    CROSS JOIN LATERAL credit.state_as_of(r.date,r.names) s
    WHERE r.names IS NULL OR s.institution_name=ANY(r.names)
  ), term_changes AS MATERIALIZED (
    SELECT DISTINCT d.institution_name,d.effective_on
    FROM credit.diff d JOIN states s ON s.data->>'institution_name'=d.institution_name
      AND d.effective_on<=s.date AND s.data->>'status'='approved'
    WHERE d.effective_date IS NOT NULL OR d.expiry_date IS NOT NULL
  ), term_dates AS (
    SELECT effective_on,array_agg(institution_name) AS names FROM term_changes GROUP BY effective_on
  ), term_before AS MATERIALIZED (
    SELECT s.institution_name,d.effective_on,to_jsonb(s) AS data FROM term_dates d
    CROSS JOIN LATERAL credit.state_as_of(d.effective_on-1,d.names) s
    WHERE s.institution_name=ANY(d.names)
  ), periods AS MATERIALIZED (
    SELECT d.institution_name,d.effective_on,b.data->>'effective_date' AS effective_date,b.data->>'expiry_date' AS expiry_date
    FROM credit.diff d JOIN term_before b USING(institution_name,effective_on)
    WHERE b.data->>'status'='approved'
      AND ((d.effective_date IS NOT NULL AND d.effective_date::text IS DISTINCT FROM b.data->>'effective_date')
        OR (d.expiry_date IS NOT NULL AND d.expiry_date::text IS DISTINCT FROM b.data->>'expiry_date'))
      AND b.data->>'effective_date' IS NOT NULL AND b.data->>'expiry_date' IS NOT NULL
  )
  SELECT to_char(s.date,'YYYY-MM-DD') AS date,s.data,
    (SELECT min(id)::float8 FROM credit.diff d WHERE d.institution_name=s.data->>'institution_name') AS position,
    (SELECT jsonb_build_object('effectiveDate',p.effective_date,'expiryDate',p.expiry_date)
     FROM periods p WHERE p.institution_name=s.data->>'institution_name' AND p.effective_on<=s.date
       AND p.effective_date<=s.date::text AND p.expiry_date>=s.date::text
       AND NOT EXISTS(SELECT 1 FROM credit.diff reset WHERE reset.institution_name=p.institution_name
         AND reset.status IN ('applying','revoked') AND reset.effective_on BETWEEN p.effective_on AND s.date)
     ORDER BY p.effective_on DESC LIMIT 1) AS previous_period
  FROM states s ORDER BY s.date,position
`;

export async function loadCreditStates(client: DatabaseClient, requests: CreditStateRequest[]): Promise<CreditStateRow[]> {
  if (!requests.length) return [];
  return (await client.query<CreditStateRow>(stateSql(),[JSON.stringify(requests)])).rows;
}
