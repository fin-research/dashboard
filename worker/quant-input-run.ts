import type { WorkflowStep } from 'cloudflare:workers';
import { createHash } from 'node:crypto';
import type { DataApiRequest } from '../src/lib/server/economic-indicator-sync.ts';
import { quantMarketRequests, fetchQuantMarketInputs, fetchIssueSpreads } from '../src/lib/server/quant-market-sync.ts';
import { persistQuantInputs, recordQuantSync } from '../src/lib/server/quant-input-repository.ts';
import { parseQuantFundReport } from '../src/lib/server/quant-fund-report.ts';
import { withPostgres } from '../src/lib/server/postgres.ts';
import { MAX_FUND_REPORT_BYTES } from '../src/lib/fund-report.ts';

export async function runQuantInputSync(step:Pick<WorkflowStep,'do'>,env:Pick<Cloudflare.Env,'HYPERDRIVE'|'EASTMONEY'>,
  scheduledTime:number,request:DataApiRequest) {
  const endDate=new Date(scheduledTime+8*3600_000).toISOString().slice(0,10);
  // Small revision overlap; history is seeded by the explicitly invoked backfill.
  const startDate=new Date(Date.parse(`${endDate}T00:00:00Z`)-7*86400000).toISOString().slice(0,10);
  const db=<T>(fn:Parameters<typeof withPostgres<T>>[2])=>withPostgres(env.HYPERDRIVE.connectionString,'quant-input-sync',fn);
  const failures:Array<{source:string;error:string}>=[];
  let stored=0;
  for(const spec of quantMarketRequests(startDate,endDate)) {
    try {
      // Persist retries never re-fetch paid market data. No automatic paid-fetch retries.
      const rows=await step.do(`quant fetch ${spec.id}`,{retries:{limit:0,delay:'1 second'},timeout:'2 minutes'},
        ()=>fetchQuantMarketInputs(request,spec,startDate,endDate));
      stored+=await step.do(`quant persist ${spec.id}`,()=>db(async client=>{
        const count=await persistQuantInputs(client,rows);
        const missing=spec.fields.filter(field=>!rows.some(row=>row.field===field));
        const partial=rows.length===0 || (spec.dataset!=='equity' && missing.length>0);
        await recordQuantSync(client,spec.id,rows[0]?.sourceHash??'',partial?'partial':'complete',rows.length,
          rows.length===0?'No observations returned':partial?`Missing fields: ${missing.join(',')}`:'');
        return count;
      }));
    }catch(error) {
      const message=error instanceof Error?error.message:'source failed';
      // Error output is already redacted by the data request adapter.
      failures.push({source:spec.id,error:message});
      await step.do(`quant failure ${spec.id}`,()=>db(client=>recordQuantSync(client,spec.id,'','failed',0,message)));
    }
  }
  // Backfill only missing spreads, bounded to 64 per daily run; subsequent runs advance.
  try {
    const bonds=await step.do('quant missing issuance spreads',()=>db(async client=>{
      const result=await client.query<{code:string;date:string}>(`SELECT DISTINCT i.entity_key AS code,i.observation_date::text AS date
        FROM public.quant_input i WHERE i.dataset='issue' AND i.field='SECUCODE'
        AND NOT EXISTS(SELECT 1 FROM public.quant_input s WHERE s.dataset='issue' AND s.entity_key=i.entity_key
          AND s.field='ISSUECREDITSPREAD' AND s.observation_date=i.observation_date)
        AND NOT EXISTS(SELECT 1 FROM public.quant_input_sync s
          WHERE s.source_key='issue-spread/' || i.entity_key || '/' || i.observation_date::text)
        ORDER BY date DESC LIMIT 64`);return result.rows;
    }));
    if(bonds.length) {
      const rows=await step.do('quant fetch issuance spreads',{retries:{limit:0,delay:'1 second'},timeout:'2 minutes'},()=>fetchIssueSpreads(request,bonds));
      stored+=await step.do('quant persist issuance spreads',()=>db(async client=>{
        const count=await persistQuantInputs(client,rows);
        for (const bond of bonds.filter(bond=>!rows.some(row=>row.entityKey===bond.code))) {
          await recordQuantSync(client,`issue-spread/${bond.code}/${bond.date}`,'','partial',0,
            'Source returned no valid spread; excluded from automatic paid retries.');
        }
        await recordQuantSync(client,'issue-spread',rows[0]?.sourceHash??'',rows.length===bonds.length?'complete':'partial',rows.length);
        return count;
      }));
    }
  }catch(error){failures.push({source:'issue-spread',error:error instanceof Error?error.message:'spread failed'});}

  // R2 is scanned with pagination; only changed objects are downloaded.
  let cursor:string|undefined;
  do {
    const page=await step.do(`quant list fund reports ${cursor??'first'}`,async()=>{
      const result=await env.EASTMONEY.list({prefix:'fund-reports/',cursor,limit:100});
      return {objects:result.objects.map(x=>({key:x.key,etag:x.etag,size:x.size})),cursor:result.truncated?result.cursor:null};
    });
    for(const object of page.objects) {
      const match=object.key.match(/^fund-reports\/(\d{4}-\d{2}-\d{2})\.html$/);
      if(!match||match[1]!>endDate)continue;
      try {
        stored+=await step.do(`quant fund report ${object.key} ${object.etag}`,()=>db(async client=>{
          const previous=await client.query('SELECT source_hash FROM public.quant_input_sync WHERE source_key=$1 AND status=$2',[object.key,'complete']);
          if(previous.rows[0]?.source_hash===object.etag)return 0;
          if(object.size>MAX_FUND_REPORT_BYTES)throw new Error('Fund report exceeds size limit');
          const body=await env.EASTMONEY.get(object.key);
          if(!body)throw new Error('Fund report disappeared');
          const rows=parseQuantFundReport(await body.text(),match[1]!);
          const count=await persistQuantInputs(client,rows);
          await recordQuantSync(client,object.key,body.etag,'complete',rows.length,'Static gap and previous-trading-day margin retain report labels.');
          return count;
        }));
      }catch(error){failures.push({source:object.key,error:error instanceof Error?error.message:'report failed'});}
    }
    cursor=page.cursor??undefined;
  }while(cursor);
  const result={status:failures.length?'partial':'complete',stored,failures};
  await step.do('quant record sync summary',()=>db(client=>recordQuantSync(client,'daily-summary',createHash('sha256').update(JSON.stringify(result)).digest('hex'),
    result.status as 'partial'|'complete',stored,JSON.stringify(failures))));
  return result;
}
