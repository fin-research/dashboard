import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx/xlsx.mjs';
import { parseDebtWorkbookData } from '../../scripts/financing/lib/excel-import.mjs';
import { transformWorkbook } from '../../scripts/financing/lib/debt-transform.mjs';
import { validateWorkbook, validateIncrement } from '../../src/lib/financing/debt-import-json.ts';

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

test('JSON workbook validation preserves rows and rejects invalid dates, money, or orphan cashflows', () => {
 const transformed=transformWorkbook(parseDebtWorkbookData(workbookFixture(),'借入资金汇总表20260903.xlsx'));
 const parsed=validateWorkbook(JSON.parse(JSON.stringify(transformed)));
 assert.equal(parsed.debts.length,1);assert.equal(parsed.balances.length,10);
 assert.throws(()=>validateWorkbook({...transformed,debts:[{...transformed.debts[0],issueDate:'2026-02-30'}]}));
 assert.throws(()=>validateWorkbook({...transformed,debts:[{...transformed.debts[0],amount:-1}]}));
 assert.throws(()=>validateWorkbook({...transformed,cashflows:[{sourceKey:'missing',cashflowType:'principal',dueDate:'2026-09-03',amount:1}]}),/没有对应新增负债/);
 assert.throws(()=>validateIncrement({...parsed,snapshot:{...parsed.snapshot,totalYi:99}}),/余额分项/);
});

test('Excel import refuses a malformed sheet or cashflow instead of silently dropping it',()=>{
 const workbook=XLSX.read(workbookFixture(),{type:'array'});
 XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['无效表头'],['不能丢弃的数据']]),'同业拆借');
 assert.throws(()=>parseDebtWorkbookData(XLSX.write(workbook,{type:'array',bookType:'xlsx'}),'借入资金汇总表20260903.xlsx'),/无法识别表头/);
 delete workbook.Sheets['同业拆借'];workbook.SheetNames.pop();
 workbook.Sheets['集团借款']=XLSX.utils.aoa_to_sheet([['名称','借款对象','借入金额','起息日','到期日','应付利息'],['测试','集团公司',100,'2026-09-01',null,1]]);
 assert.throws(()=>parseDebtWorkbookData(XLSX.write(workbook,{type:'array',bookType:'xlsx'}),'借入资金汇总表20260903.xlsx'),/缺少有效日期/);
});


test('derived movement summary is allowed but a business row without money is refused',()=>{
 const workbook=XLSX.read(workbookFixture(),{type:'array'});
 XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['起息','到期','变化']]),'变动');
 const read=()=>parseDebtWorkbookData(XLSX.write(workbook,{type:'array',bookType:'xlsx'}),'借入资金汇总表20260903.xlsx');
 assert.equal(transformWorkbook(read()).debts.length,1);
 workbook.Sheets['集团借款']=XLSX.utils.aoa_to_sheet([['名称','借款对象','借入金额','起息日','到期日'],['测试','集团公司',null,'2026-09-01','2027-09-01']]);
 assert.throws(()=>transformWorkbook(read()),/缺少金额/);
});
