import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {issuanceSnapshot} from './fixtures/issuance.mjs';
import {financingModel} from './visual/report-fixtures.mjs';
import {loadIssuanceModelReport} from '../src/lib/server/issuance-model-repository.ts';
import {saveFinancingModelConclusion,saveTimingDecisionRecord,loadTimingDecisionHistory} from '../src/lib/server/financing-model-repository.ts';
const directory=new URL('../financing-model-migrations/',import.meta.url);
function snapshot(){const value=issuanceSnapshot();value.online_run={model_version:'0123456789abcdef0123',feature_version:'issuance-lgb-v1',training_as_of:'2026-08-01',retrain_after:'2026-08-31',runtime:'cloudflare-workflow',workflow_id:'bond-test',input_prefix:`quant-trial/runs/${value.as_of_date}/bond-test`};return value;}
const publish=(db,value,key=`${value.online_run.input_prefix}/result.json`)=>db.query('SELECT financing_model.publish_online_result($1::jsonb,$2) AS id',[JSON.stringify(value),key]).then(r=>r.rows[0].id);
async function database(){const db=new PGlite();for(const name of (await readdir(directory)).sort())await db.exec(await readFile(new URL(name,directory),'utf8'));return db;}

test('issuance publication round-trips coupon and SHAP while retaining daily manual content',async()=>{
 const db=await database();try{
  const first=snapshot(),id=await publish(db,first),report=await loadIssuanceModelReport(db);
  assert.equal(report.snapshot.run_id,id);assert.equal(report.snapshot.forecast[0].coupon_percent,1.85);
  assert.deepEqual(report.snapshot.explanation.features,first.explanation.features);
  assert.equal(report.snapshot.validation.metrics.length,2);
  assert.equal(report.snapshot.market_forecast.length,11);
  assert.equal((await db.query('SELECT predicted_deviation_bp FROM financing_model.model_run')).rows[0].predicted_deviation_bp,null);
  await saveFinancingModelConclusion(db,{runId:id,verdict:'人工结论',preferredWindow:'下周',narrative:'保留人工判断'});
  await saveTimingDecisionRecord(db,{runId:id,decisionAction:'等待询价',outcome:''});
  await db.query(`INSERT INTO financing_model.sell_side_snapshot(id,run_id,period_start,period_end,search_query,model_name,payload)
    VALUES(gen_random_uuid(),$1,'2026-08-18','2026-08-24','测试','测试',$2::jsonb)`,[id,JSON.stringify(financingModel.sellSide)]);
  const updated=structuredClone(first);updated.run_id=crypto.randomUUID();updated.generated_at='2026-08-24T04:00:00Z';updated.decision.expected_net_saving_bp=3.1;
  assert.equal(await publish(db,updated),id);
  const revised=await loadIssuanceModelReport(db,id);
  assert.equal(revised.snapshot.decision.expected_net_saving_bp,3.1);assert.equal(revised.conclusion.verdict,'人工结论');
  assert.equal(revised.sellSide.logicSummary,financingModel.sellSide.logicSummary);
  const decisions=await loadTimingDecisionHistory(db);assert.equal(decisions[0].runId,id);assert.equal(decisions[0].historicalPercentile,null);
  assert.equal(await publish(db,first),id);assert.equal((await loadIssuanceModelReport(db)).snapshot.decision.expected_net_saving_bp,3.1);
  assert.equal((await db.query('SELECT count(*) FROM financing_model.model_run')).rows[0].count,1);
 }finally{await db.close();}
});

test('issuance publication rejects old models, unavailable labels, broken SHAP and rolls back details',async()=>{
 const db=await database();try{
  const first=snapshot();await publish(db,first);
  await assert.rejects(publish(db,first,'quant-trial/runs/other/result.json'),/Invalid issuance/);
  for(const mutate of [v=>{v.schema_version=3;},v=>{v.online_run.runtime='node';},v=>{v.online_run.retrain_after='2026-08-01';},
    v=>{delete v.online_run.training_as_of;},v=>{v.online_run.model_version='invalid';},v=>{v.forecast[0].market_train_label_end=v.as_of_date;},
    v=>{v.market_forecast[1].date=v.as_of_date;},v=>{v.forecast[0].effective_horizon=30;},
    v=>{v.explanation.prediction_coupon_bp+=1;v.explanation.base_coupon_bp+=1;},v=>{v.explanation=null;},
    v=>{v.explanation.features=[];},v=>{v.explanation.features[0].shap_bp=99;},v=>{v.decision.action='';}]){
   const invalid=structuredClone(first);invalid.generated_at='2026-08-24T05:00:00Z';mutate(invalid);await assert.rejects(publish(db,invalid));
  }
  const broken=structuredClone(first);broken.generated_at='2026-08-24T05:00:00Z';broken.decision.expected_net_saving_bp=99;broken.forecast[1].saving_probability=2;
  await assert.rejects(publish(db,broken),/check constraint/);
  const after=await loadIssuanceModelReport(db);assert.equal(after.snapshot.decision.expected_net_saving_bp,3);assert.equal(after.snapshot.forecast[1].saving_probability,.7);
 }finally{await db.close();}
});
