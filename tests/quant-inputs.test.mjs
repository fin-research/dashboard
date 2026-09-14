import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {inputValue,FUNDING_EDB} from '../src/lib/server/quant-input-contract.ts';
import {persistQuantInputs} from '../src/lib/server/quant-input-repository.ts';
import {parseQuantFundReport} from '../src/lib/server/quant-fund-report.ts';
import {quantMarketRequests,fetchQuantMarketInputs,fetchIssueSpreads} from '../src/lib/server/quant-market-sync.ts';
import {fetchDmFundingRateRows} from '../src/lib/server/economic-indicator-sync.ts';

test('Shibor selects lastPrice, preserves zero, and skips absent quotes',async()=>{
  assert.equal(FUNDING_EDB.cdb3y,'E1701708');
  assert.equal(FUNDING_EDB.cdb10y,'E1701714');
  const result=await fetchDmFundingRateRows(async()=>({hasNextPage:false,rows:[
    {bondCode:'Shibor3M',capitalTime:Date.parse('2026-09-10T00:00:00Z'),weightedYield:null,lastPrice:1.4},
    {bondCode:'Shibor3M',capitalTime:Date.parse('2026-09-11T00:00:00Z'),weightedYield:9,lastPrice:null},
  ]}),'incremental',new Date('2026-09-14T00:00:00Z'),['Shibor3M']);
  assert.deepEqual(result.rows,[{code:'E1300079',date:'2026-09-10',observationDate:'2026-09-10',value:1.4}]);
});

test('unpublished spreads remain retryable while explicit invalid codes are isolated',async()=>{
  const fetch=async(_path,params)=>{
    if(params.get('codes').includes('invalid'))throw new Error('10003008 invalid stock code');
    return {function:'CSS',fields:['code','ISSUECREDITSPREAD'],rows:[{code:'new',ISSUECREDITSPREAD:null}]};
  };
  const result=await fetchIssueSpreads(fetch,[{code:'invalid',date:'2026-09-10'},{code:'new',date:'2026-09-10'}]);
  assert.deepEqual(result,{rows:[],invalidCodes:['invalid']});
});

test('normalized inputs preserve online rows on seed replay and roll back invalid batches',async()=>{
  const engine=new PGlite();const db={query:async(...args)=>{const result=await engine.query(...args);return {...result,rowCount:result.affectedRows};},exec:engine.exec.bind(engine),close:engine.close.bind(engine)};await db.exec(await readFile(new URL('../edb-migrations/0004_quant_inputs.sql',import.meta.url),'utf8'));
  const row=inputValue('company','lcr','2026-09-10',2.5,'r2','report','hash');
  assert.equal(await persistQuantInputs(db,[row]),1);
  assert.equal(await persistQuantInputs(db,[{...row,numericValue:8}],true),0);
  assert.equal((await db.query('select numeric_value from quant_input')).rows[0].numeric_value,2.5);
  await assert.rejects(()=>persistQuantInputs(db,[{...row,observationDate:'2026-09-11'},{...row,observationDate:'2026-09-12',textValue:'invalid'}]));
  assert.equal((await db.query('select count(*)::int as n from quant_input')).rows[0].n,1);
  assert.equal(inputValue('market','rate','2026-09-10',null,'test','test','test'),null);
  assert.equal(inputValue('market','rate','2026-09-10',0,'test','test','test').numericValue,0);
  await db.close();
});

const report=`<html>证券公司资金日报 20260911
  截至上一交易日我司两融规模 <b>100.12 亿</b>
  <script>mk('gLcr').setOption(gaugeOpt('LCR',150,1000,130,CYAN,'140'));
  mk('gNsfr').setOption(gaugeOpt('NSFR',160,300,130,GOLD,'150'));
  var terms=['1D','1M'];var gaps=[1,-20];</script></html>`;
test('fund report literals retain ratios, static-gap scope and previous-trade label',()=>{
  const rows=parseQuantFundReport(report,'2026-09-11');
  assert.deepEqual(rows.map(r=>[r.field,r.numericValue]),[['lcr',1.5],['nsfr',1.6],['static_gap_1m',-20],['margin_scale_previous_trade',100.12]]);
  assert.ok(rows.every(r=>r.dataset==='company_report'&&r.observationDate==='2026-09-11'));
  assert.throws(()=>parseQuantFundReport(report,'2026-09-10'),/date mismatch/);
  assert.throws(()=>parseQuantFundReport(report.replace('var gaps=[1,-20]','var gaps=[1,process.exit()]'),'2026-09-11'));
});

test('issuance statistics query single days, equity valuation includes required options',async()=>{
  const specs=quantMarketRequests('2026-09-10','2026-09-11');
  const primary=specs.filter(s=>s.dataset==='primary');assert.equal(primary.length,2);
  assert.match(primary[0].parameters.options,/StartDate=2026-09-10,EndDate=2026-09-10/);
  const equity=specs.find(s=>s.id==='equity-valuation');
  assert.match(equity.parameters.options,/DelType=1,EquityER=1,BondER=1/);
  const rows=await fetchQuantMarketInputs(async()=>({function:'CSD',fields:['code','date','MV'],rows:[{code:'800004.EI',date:'2026-09-10',MV:100,PETTM:null}]}),equity,'2026-09-10','2026-09-11');
  assert.deepEqual(rows.map(r=>r.field),['all_a_market_cap']);
  await assert.rejects(()=>fetchQuantMarketInputs(async()=>({function:'CTR',fields:[],rows:[{START_DATE:'2026-09-10',END_DATE:'2026-09-11',ISSUE_AMT:1}]}),primary[0],'2026-09-10','2026-09-11'),/Non-daily/);
});
