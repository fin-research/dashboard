import type { CreditSummaryView } from '../credit/types.ts';
import type { DatabaseClient } from './postgres.ts';

export type CreditStateRequest = { date: string; names: string[] | null; include_details?: boolean };
export type CreditStateRow = { date: string; data: import('../credit/data.ts').CreditDataState['data'];
  previous_period: { effectiveDate: string; expiryDate: string } | null };

// Field inheritance belongs to the existing SQL snapshot. Only request the dates
// and institutions consumed by the table or the bounded event windows.
const stateSql = (summaryOnly = false) => `
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
      ${summaryOnly ? "AND s.data->>'effective_date'>s.date::text AND (s.data->>'expiry_date' IS NULL OR s.data->>'expiry_date'>=s.date::text)" : ''}
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
    (SELECT jsonb_build_object('effectiveDate',p.effective_date,'expiryDate',p.expiry_date)
     FROM periods p WHERE p.institution_name=s.data->>'institution_name' AND p.effective_on<=s.date
       AND p.effective_date<=s.date::text AND p.expiry_date>=s.date::text
       AND NOT EXISTS(SELECT 1 FROM credit.diff reset WHERE reset.institution_name=p.institution_name
         AND reset.status IN ('applying','revoked') AND reset.effective_on BETWEEN p.effective_on AND s.date)
     ORDER BY p.effective_on DESC LIMIT 1) AS previous_period
  FROM states s ORDER BY s.date,(SELECT min(id) FROM credit.diff d WHERE d.institution_name=s.data->>'institution_name')
`;

export async function loadCreditStates(client: DatabaseClient, requests: CreditStateRequest[]): Promise<CreditStateRow[]> {
  if (!requests.length) return [];
  return (await client.query<CreditStateRow>(stateSql(),[JSON.stringify(requests)])).rows;
}

/** Save returns authoritative aggregates, without transferring all institution DTOs. */
export async function loadCreditSummaries(client: DatabaseClient, dates: string[]): Promise<CreditSummaryView[]> {
  return (await client.query<CreditSummaryView>(`
    WITH snapshots AS MATERIALIZED (${stateSql(true)}), dates AS (SELECT DISTINCT date::date FROM snapshots),
    used AS MATERIALIZED (
      SELECT d.date,m.institution_name,u.debt_type AS item_type,sum(u.amount)/100000000 AS amount
      FROM dates d CROSS JOIN LATERAL financing.credit_usage_as_of(d.date) u
      JOIN credit.institution_client m ON m.client_id=u.client_id GROUP BY d.date,m.institution_name,u.debt_type
      UNION ALL SELECT d.date,u.institution_name,'bond',u.amount/100000000
      FROM dates d CROSS JOIN LATERAL credit.bond_primary_usage_as_of(d.date) u
    ), amounts AS (
      SELECT s.*,round(
        round(coalesce((SELECT sum(u.amount) FROM used u WHERE u.date=s.date::date
          AND u.institution_name=s.data->>'institution_name' AND u.item_type='bond'),0)
          +coalesce((s.data->>'bond_investment_secondary_used')::numeric,0),6)
        +coalesce((SELECT sum(round(u.amount,6)) FROM used u WHERE u.date=s.date::date
          AND u.institution_name=s.data->>'institution_name' AND u.item_type<>'bond'),0)
        +coalesce((s.data->>'legal_overdraft_used')::numeric,0)
        +coalesce((s.data->>'other_used')::numeric,0),6) AS total_used,
        EXISTS(SELECT 1 FROM credit.institution_client m WHERE m.institution_name=s.data->>'institution_name') AS linked,
        s.data->>'status'='approved'
          AND (s.data->>'expiry_date' IS NULL OR s.data->>'expiry_date'>=s.date)
          AND (s.data->>'effective_date' IS NULL OR s.data->>'effective_date'<=s.date OR s.previous_period IS NOT NULL) AS approved
      FROM snapshots s
    )
    SELECT date AS "reportDate",count(*) FILTER(WHERE data->>'status'<>'revoked')::int AS "institutionCount",
      count(*) FILTER(WHERE approved)::int AS "approvedCount",
      coalesce(round(sum((data->>'total')::numeric) FILTER(WHERE approved),6),0)::float8 AS "totalLimit",
      coalesce(round(sum(total_used) FILTER(WHERE approved AND linked),6),0)::float8 AS "totalUsed",
      coalesce(round(sum((data->>'total')::numeric-total_used) FILTER(WHERE approved AND linked),6),0)::float8 AS "totalAvailable",
      CASE WHEN sum((data->>'total')::numeric) FILTER(WHERE approved)>0 THEN
        coalesce(sum(total_used) FILTER(WHERE approved AND linked),0)/sum((data->>'total')::numeric) FILTER(WHERE approved)*100 ELSE 0 END::float8 AS utilization,
      count(*) FILTER(WHERE approved AND (data->>'expiry_date')::date BETWEEN date::date AND date::date+30)::int AS "expiringWithin30Days"
    FROM amounts GROUP BY date ORDER BY date
  `,[JSON.stringify(dates.map(date=>({date,names:null,include_details:false})))])).rows;
}
