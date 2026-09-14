import type { DatabaseClient } from './postgres.ts';
import type { QuantInput } from './quant-input-contract.ts';

export async function persistQuantInputs(client: DatabaseClient, rows: QuantInput[], insertOnly = false): Promise<number> {
  let count = 0;
  await client.query('BEGIN');
  try {
    for (let offset = 0; offset < rows.length; offset += 1500) {
      const batch = rows.slice(offset, offset + 1500);
      const result = await client.query(`INSERT INTO public.quant_input
        (dataset,entity_key,field,observation_date,numeric_value,text_value,published_date,source,source_key,source_hash)
        SELECT dataset,"entityKey",field,"observationDate"::date,"numericValue","textValue","publishedDate"::date,source,"sourceKey","sourceHash"
        FROM jsonb_to_recordset($1::jsonb) AS x(dataset text,"entityKey" text,field text,"observationDate" text,
          "numericValue" double precision,"textValue" text,"publishedDate" text,source text,"sourceKey" text,"sourceHash" text)
        ON CONFLICT (dataset,entity_key,field,observation_date) ${insertOnly ? 'DO NOTHING' : `DO UPDATE SET
          numeric_value=EXCLUDED.numeric_value,text_value=EXCLUDED.text_value,published_date=EXCLUDED.published_date,
          source=EXCLUDED.source,source_key=EXCLUDED.source_key,source_hash=EXCLUDED.source_hash,synced_at=clock_timestamp()
          WHERE (quant_input.numeric_value,quant_input.text_value,quant_input.published_date,quant_input.source_hash)
            IS DISTINCT FROM (EXCLUDED.numeric_value,EXCLUDED.text_value,EXCLUDED.published_date,EXCLUDED.source_hash)`}`,
      [JSON.stringify(batch)]);
      count += result.rowCount ?? 0;
    }
    await client.query('COMMIT');
    return count;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}

export async function recordQuantSync(client: DatabaseClient, key: string, hash: string,
  status: 'complete' | 'partial' | 'failed', count: number, detail = '') {
  await client.query(`INSERT INTO public.quant_input_sync(source_key,source_hash,status,row_count,detail)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(source_key) DO UPDATE SET source_hash=EXCLUDED.source_hash,
    status=EXCLUDED.status,row_count=EXCLUDED.row_count,detail=EXCLUDED.detail,synced_at=clock_timestamp()`,
  [key,hash,status,count,detail]);
}
