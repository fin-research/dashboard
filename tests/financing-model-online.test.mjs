import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { financingModel } from './visual/report-fixtures.mjs';
import { loadFinancingModelReport, saveFinancingModelConclusion, saveTimingDecisionRecord, loadTimingDecisionHistory } from '../src/lib/server/financing-model-repository.ts';

const migrationDirectory = new URL('../financing-model-migrations/', import.meta.url);
function snapshot() {
  const value = structuredClone(financingModel.snapshot);
  value.schema_version = 3;
  value.company_metrics = null;
  value.source_freshness.company_metrics_date = null;
  value.source_freshness.subject_spread_date = null;
  value.online_run = {
    model_version: '0123456789abcdef0123', feature_version: 'online-market-v1',
    training_as_of: '2026-08-01', retrain_after: '2027-02-01',
    excluded_groups: ['secondary_bond', 'company'], runtime: 'cloudflare-workflow',
    workflow_id: 'bond-test', input_prefix: `quant-trial/runs/${value.as_of_date}/bond-test`,
  };
  return value;
}
const publish = (db, value, key = `${value.online_run.input_prefix}/result.json`) => db.query(
  'SELECT financing_model.publish_online_result($1::jsonb, $2) AS id', [JSON.stringify(value), key],
).then(result => result.rows[0].id);
async function database() {
  const db = new PGlite();
  for (const name of (await readdir(migrationDirectory)).sort()) {
    await db.exec(await readFile(new URL(name, migrationDirectory), 'utf8'));
  }
  return db;
}

test('online publication round-trips through the existing report and preserves daily manual work', async () => {
  const db = await database();
  try {
    const first = snapshot();
    const id = await publish(db, first);
    const report = await loadFinancingModelReport(db);
    assert.equal(report.snapshot.run_id, id);
    assert.equal(report.snapshot.company_metrics, null);
    assert.equal(report.snapshot.online_run.model_version, first.online_run.model_version);
    assert.deepEqual(report.snapshot.forecast_window, first.forecast_window);
    assert.deepEqual(report.snapshot.driver_structure, first.driver_structure);
    assert.deepEqual(report.snapshot.market_drivers, first.market_drivers);
    assert.deepEqual(report.snapshot.product_recommendation, first.product_recommendation);
    assert.deepEqual(report.snapshot.validation, first.validation);
    await saveFinancingModelConclusion(db, { runId: id, verdict: '人工结论', preferredWindow: '下周', narrative: '保留人工判断' });
    await saveTimingDecisionRecord(db, { runId: id, decisionAction: '等待询价', outcome: '' });
    await db.query(`INSERT INTO financing_model.sell_side_snapshot
      (id,run_id,period_start,period_end,search_query,model_name,payload)
      VALUES (gen_random_uuid(),$1,'2026-08-18','2026-08-24','测试','测试',$2::jsonb)`, [id, JSON.stringify(financingModel.sellSide)]);
    const updated = structuredClone(first);
    updated.run_id = crypto.randomUUID();
    updated.generated_at = '2026-08-24T04:00:00Z';
    updated.prediction.deviation_bp = 2.75;
    updated.market_drivers[0].shap = -0.6;
    assert.equal(await publish(db, updated), id);
    const revised = await loadFinancingModelReport(db, id);
    assert.equal(revised.snapshot.prediction.deviation_bp, 2.75);
    assert.equal(revised.snapshot.market_drivers[0].shap, -0.6);
    assert.equal(revised.conclusion.verdict, '人工结论');
    assert.equal(revised.sellSide.logicSummary, financingModel.sellSide.logicSummary);
    assert.equal((await loadTimingDecisionHistory(db))[0].runId, id);
    assert.equal(await publish(db, first), id);
    assert.equal((await loadFinancingModelReport(db)).snapshot.prediction.deviation_bp, 2.75);
    assert.equal(await publish(db, updated), id);
    assert.equal((await db.query('SELECT count(*) FROM financing_model.model_run')).rows[0].count, 1);

    const next = snapshot();
    next.run_id = crypto.randomUUID(); next.as_of_date = '2026-08-25';
    next.online_run.input_prefix = 'quant-trial/runs/2026-08-25/bond-test';
    await publish(db, next);
    assert.equal((await loadFinancingModelReport(db)).versions.length, 2);
    assert.equal((await loadFinancingModelReport(db, id)).snapshot.as_of_date, first.as_of_date);
  } finally { await db.close(); }
});

test('publication rejects invalid provenance and rolls back partially replaced details', async () => {
  const db = await database();
  try {
    const first = snapshot();
    await publish(db, first);
    await assert.rejects(publish(db, first, 'quant-trial/runs/other/result.json'), /Invalid online/);
    for (const mutate of [
      value => { value.online_run.runtime = 'javascript'; },
      value => { value.online_run.retrain_after = '2026-08-01'; },
      value => { value.online_run.model_version = 'invalid'; },
      value => { delete value.online_run.excluded_groups; },
      value => { value.company_metrics = financingModel.snapshot.company_metrics; },
      value => { value.forecast_window = []; },
    ]) {
      const invalid = structuredClone(first); mutate(invalid);
      await assert.rejects(publish(db, invalid));
    }
    const broken = structuredClone(first);
    broken.generated_at = '2026-08-24T05:00:00Z';
    broken.prediction.deviation_bp = 99;
    broken.product_recommendation.scenarios[0].rank = 99;
    await assert.rejects(publish(db, broken), /check constraint/);
    const after = await loadFinancingModelReport(db);
    assert.equal(after.snapshot.prediction.deviation_bp, first.prediction.deviation_bp);
    assert.deepEqual(after.snapshot.forecast_window, first.forecast_window);
  } finally { await db.close(); }
});
