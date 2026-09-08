import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import test from 'node:test';
import * as XLSX from 'xlsx/xlsx.mjs';
import { parseDebtWorkbookData } from '../../scripts/financing/lib/excel-import.mjs';
import { transformWorkbook } from '../../scripts/financing/lib/debt-transform.mjs';
import {
	decodeDebtImportPayload,
	encodeDebtImportPayload,
	MAX_WORKFLOW_EVENT_BYTES,
	workflowEventSize,
	workflowPayloadBase64
} from '../../src/lib/financing/debt-import-codec.js';

const brotli = createRequire(import.meta.url)('brotli-wasm');

function workbookFixture() {
	const workbook = XLSX.utils.book_new();
	const summaryRows = [
		[],
		[],
		['品种', '2026-09-03'],
		['收益凭证', 1],
		['收益权转让', 2],
		['同业拆借', 3],
		['次级债', 4],
		['集团借款', 5],
		['转融资', 6],
		['短期融资券', 7],
		['私募债', 8],
		['小公募', 9],
		['互换便利', 10],
		['合计', 55]
	];
	XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summaryRows), '借入资金汇总表');
	XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
		['名称', '借款对象', '借入金额', '起息日', '到期日', '利率'],
		['测试集团借款', '集团公司', 100000000, '2026-09-01', '2027-09-01', '2.1%']
	]), '集团借款');
	return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
}

test('uploaded workbook is parsed and transformed directly without persisting the raw file', () => {
	const transformed = transformWorkbook(parseDebtWorkbookData(
		workbookFixture(),
		'东方财富证券借入资金汇总表20260903.xlsx'
	));
	assert.equal(transformed.snapshot.asOfDate, '2026-09-03');
	assert.equal(transformed.snapshot.totalYi, 55);
	assert.equal(transformed.debts.length, 1);
	assert.equal(transformed.debts[0].debtType, '集团借款');
	assert.equal(transformed.debts[0].amount, 100000000);
	assert.equal(transformed.debts[0].annualRate, 0.021);
	assert.equal(transformed.balances.length, 10);
});

test('generated Protobuf payload survives Brotli round-trip within the Workflow event contract', () => {
	const transformed = transformWorkbook(parseDebtWorkbookData(
		workbookFixture(),
		'东方财富证券借入资金汇总表20260903.xlsx'
	));
	const protobuf = encodeDebtImportPayload(transformed);
	const compressed = brotli.compress(protobuf, { quality: 10 });
	const decoded = decodeDebtImportPayload(brotli.decompress(compressed));
	assert.equal(decoded.asOfDate, '2026-09-03');
	assert.equal(decoded.totalYi, 55);
	const debts = [...decoded.debtBatches()].flat();
	const cashflows = [...decoded.cashflowBatches()].flat();
	const balances = [...decoded.balanceBatches()].flat();
	assert.equal(debts.length, 1);
	assert.equal(debts[0].debtType, '集团借款');
	assert.equal(cashflows.length, 0);
	assert.equal(balances.length, 10);
	assert.ok(workflowEventSize(
		workflowPayloadBase64(compressed),
		'东方财富证券借入资金汇总表20260903.xlsx',
		1_397_495
	) < MAX_WORKFLOW_EVENT_BYTES);
});

test('online import uses client Protobuf plus idempotent Workflow and no database staging', () => {
	const [route, workflow, config, panel, browserWorker, migration] = [
		fs.readFileSync(new URL('../../src/routes/financing/data/import/+server.ts', import.meta.url), 'utf8'),
		fs.readFileSync(new URL('../../worker/financing-debt-import.ts', import.meta.url), 'utf8'),
		fs.readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'),
		fs.readFileSync(new URL('../../src/lib/financing/DebtImportPanel.svelte', import.meta.url), 'utf8'),
		fs.readFileSync(new URL('../../src/lib/financing/debt-import.worker.js', import.meta.url), 'utf8'),
		fs.readFileSync(new URL('../../financing-migrations/0022_remove_debt_import_state.sql', import.meta.url), 'utf8')
	];
	assert.match(route, /request\.arrayBuffer\(\)/);
	assert.doesNotMatch(route, /parseDebtWorkbookData|stageDebtImportPayload|getDatabase/);
	assert.match(route, /DEBT_IMPORT_WORKFLOW\.createBatch/);
	assert.match(route, /sha256Hex\(payloadBytes\)/);
	assert.match(route, /instance\.restart\(\)/);
	assert.doesNotMatch(route, /R2|LIABILITY_REPORT_SNAPSHOTS|\.put\(/);
	assert.match(workflow, /brotliDecompressSync/);
	assert.match(workflow, /decodeDebtImportPayload/);
	assert.match(workflow, /importDebtWorkbook/);
	assert.match(workflow, /refreshDerivatives: true/);
	assert.doesNotMatch(workflow, /DebtImportRun|debt-import-runs|debt_import_/);
	assert.match(config, /"name": "financing-debt-import"/);
	assert.match(config, /"class_name": "DebtImportWorkflow"/);
	assert.match(panel, /function schedulePoll\(runId: string, delay = 1500\)/);
	assert.match(panel, /new Worker\(new URL\('\.\/debt-import\.worker\.js'/);
	assert.match(browserWorker, /parseDebtWorkbookData\(event\.data\.workbookData/);
	assert.match(browserWorker, /encodeDebtImportPayload\(transformed\)/);
	assert.match(browserWorker, /brotli\.compress\(protobuf, \{ quality: 10 \}\)/);
	assert.match(panel, /原始 Excel 不上传/);
	assert.match(migration, /DROP TABLE IF EXISTS financing\.debt_import_payloads/);
	assert.match(migration, /DROP TABLE IF EXISTS financing\.debt_import_runs/);
});
