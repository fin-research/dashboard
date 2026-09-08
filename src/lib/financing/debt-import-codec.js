// @ts-nocheck
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { base64Decode, base64Encode } from '@bufbuild/protobuf/wire';
import {
	BalanceRecordBatchSchema,
	CashflowRecordBatchSchema,
	DebtImportPayloadSchema,
	DebtRecordBatchSchema,
	DebtTable
} from './generated/debt_import_pb.js';

export const DEBT_IMPORT_PAYLOAD_VERSION = 1;
export const MAX_WORKFLOW_EVENT_BYTES = 1024 * 1024;
export const MAX_COMPRESSED_PAYLOAD_BYTES = 720 * 1024;
export const MAX_PROTOBUF_PAYLOAD_BYTES = 16 * 1024 * 1024;

const TABLE_TO_PROTO = new Map([
	['debt', DebtTable.DEBT],
	['bond', DebtTable.BOND],
	['income_certificate', DebtTable.INCOME_CERTIFICATE],
	['income_right', DebtTable.INCOME_RIGHT],
	['refinancing', DebtTable.REFINANCING],
	['swap_facility', DebtTable.SWAP_FACILITY]
]);
const PROTO_TO_TABLE = new Map([...TABLE_TO_PROTO].map(([name, value]) => [value, name]));
const MAX_DEBT_RECORDS = 100_000;
const MAX_CASHFLOW_RECORDS = 200_000;
const MAX_BALANCE_RECORDS = 100_000;
const RECORD_BATCH_SIZE = 500;

function optional(value) {
	return value == null ? undefined : value;
}

function debtMessage(item) {
	const extension = item.extension ?? {};
	const table = TABLE_TO_PROTO.get(item.table);
	if (table == null) throw new Error(`不支持的负债继承表：${item.table}`);
	return {
		sourceKey: item.sourceKey,
		table,
		debtType: item.debtType,
		subtype: optional(item.subtype),
		name: item.name,
		legacyName: optional(item.legacyName),
		counterparty: optional(item.counterparty),
		amount: item.amount,
		interestPayable: item.interestPayable,
		annualRate: optional(item.annualRate),
		issueDate: optional(item.issueDate),
		maturityDate: optional(item.maturityDate),
		activatedAt: optional(item.activatedAt),
		settledAt: optional(item.settledAt),
		closedAt: optional(item.closedAt),
		issuanceMethod: optional(extension.issuanceMethod),
		bookbuildingDate: optional(extension.bookbuildingDate),
		interestBasis: optional(extension.interestBasis),
		issuanceTarget: optional(extension.issuanceTarget),
		market: optional(extension.market),
		receivingAccount: optional(extension.receivingAccount),
		trustee: optional(extension.trustee),
		bookrunner: optional(extension.bookrunner),
		liquidationSubmissionStatus: optional(extension.liquidationSubmissionStatus),
		liquidationRegistrationStatus: optional(extension.liquidationRegistrationStatus),
		returnType: optional(extension.returnType),
		subscriptionDate: optional(extension.subscriptionDate),
		redemptionDate: optional(extension.redemptionDate),
		earlyMaturity: optional(extension.earlyMaturity),
		interestBasisDays: optional(extension.interestBasisDays),
		isExtended: optional(extension.isExtended),
		repaymentAccount: optional(extension.repaymentAccount),
		averageRepoBalanceDescription: optional(extension.averageRepoBalanceDescription),
		repoWeightedAverageRate: optional(extension.repoWeightedAverageRate)
	};
}

function cashflowMessage(item) {
	return {
		sourceKey: item.sourceKey,
		cashflowType: item.cashflowType,
		dueDate: item.dueDate,
		amount: optional(item.amount),
		paidAmount: optional(item.paidAmount),
		paidAt: optional(item.paidAt),
		accrualStartDate: optional(item.accrualStartDate),
		accrualEndDate: optional(item.accrualEndDate),
		note: optional(item.note),
		sourceSequence: Number(item.sourceSequence ?? item.sequence ?? 0)
	};
}

export function encodeDebtImportPayload(transformed) {
	const debtBatches = [];
	for (let offset = 0; offset < transformed.debts.length; offset += RECORD_BATCH_SIZE) {
		debtBatches.push(toBinary(DebtRecordBatchSchema, create(DebtRecordBatchSchema, {
			records: transformed.debts.slice(offset, offset + RECORD_BATCH_SIZE).map(debtMessage)
		})));
	}
	const cashflowBatches = [];
	for (let offset = 0; offset < transformed.cashflows.length; offset += RECORD_BATCH_SIZE) {
		cashflowBatches.push(toBinary(CashflowRecordBatchSchema, create(CashflowRecordBatchSchema, {
			records: transformed.cashflows.slice(offset, offset + RECORD_BATCH_SIZE).map(cashflowMessage)
		})));
	}
	const balanceBatches = [];
	for (let offset = 0; offset < transformed.balances.length; offset += RECORD_BATCH_SIZE) {
		balanceBatches.push(toBinary(BalanceRecordBatchSchema, create(BalanceRecordBatchSchema, {
			records: transformed.balances.slice(offset, offset + RECORD_BATCH_SIZE).map((item) => ({
				asOfDate: item.asOfDate,
				debtType: item.debtType,
				subtype: item.subtype ?? '',
				amount: item.amount
			}))
		})));
	}
	const message = create(DebtImportPayloadSchema, {
		version: DEBT_IMPORT_PAYLOAD_VERSION,
		asOfDate: transformed.snapshot.asOfDate,
		totalYi: transformed.snapshot.totalYi,
		debtBatches,
		cashflowBatches,
		balanceBatches,
		debtCount: transformed.debts.length,
		cashflowCount: transformed.cashflows.length,
		balanceCount: transformed.balances.length
	});
	return toBinary(DebtImportPayloadSchema, message);
}

function assertDate(value, label, { nullable = false } = {}) {
	if (nullable && value == null) return;
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
		throw new Error(`${label}无效`);
	}
}

function assertText(value, label, { nullable = false, maximumLength = 2_000 } = {}) {
	if (nullable && value == null) return;
	if (typeof value !== 'string' || !value.trim() || value.length > maximumLength) {
		throw new Error(`${label}无效`);
	}
}

function assertNumber(value, label, { nullable = false, minimum = null } = {}) {
	if (nullable && value == null) return;
	if (!Number.isFinite(value) || (minimum != null && value < minimum)) throw new Error(`${label}无效`);
}

export function decodeDebtImportPayload(bytes) {
	const payload = fromBinary(DebtImportPayloadSchema, bytes, { readUnknownFields: false });
	if (payload.version !== DEBT_IMPORT_PAYLOAD_VERSION) {
		throw new Error('导入数据版本不受支持，请刷新页面后重试');
	}
	assertDate(payload.asOfDate, '台账基准日');
	assertNumber(payload.totalYi, '台账汇总余额', { minimum: 0 });
	if (!payload.debtCount || !payload.balanceCount) throw new Error('台账没有可导入的负债或余额记录');
	if (payload.debtCount > MAX_DEBT_RECORDS) throw new Error('负债记录超过 100,000 条上限');
	if (payload.cashflowCount > MAX_CASHFLOW_RECORDS) throw new Error('现金流记录超过 200,000 条上限');
	if (payload.balanceCount > MAX_BALANCE_RECORDS) throw new Error('余额记录超过 100,000 条上限');
	const batchLimit = (maximum) => Math.ceil(maximum / RECORD_BATCH_SIZE);
	if (
		!payload.debtBatches.length
		|| !payload.balanceBatches.length
		|| payload.debtBatches.length > batchLimit(MAX_DEBT_RECORDS)
		|| payload.cashflowBatches.length > batchLimit(MAX_CASHFLOW_RECORDS)
		|| payload.balanceBatches.length > batchLimit(MAX_BALANCE_RECORDS)
	) {
		throw new Error('台账分批结构无效');
	}

	const sourceKeys = new Set();
	let debtsDecoded = false;
	return {
		snapshot: { asOfDate: payload.asOfDate, totalYi: payload.totalYi },
		asOfDate: payload.asOfDate,
		totalYi: payload.totalYi,
		debtCount: payload.debtCount,
		cashflowCount: payload.cashflowCount,
		balanceCount: payload.balanceCount,
		*debtBatches() {
			let count = 0;
			for (const bytes of payload.debtBatches) {
				const records = fromBinary(DebtRecordBatchSchema, bytes, { readUnknownFields: false }).records;
				if (!records.length || records.length > RECORD_BATCH_SIZE) throw new Error('台账负债分批大小无效');
				for (const debt of records) {
					const index = count + 1;
					assertText(debt.sourceKey, `台账第 ${index} 条负债来源键`);
					if (sourceKeys.has(debt.sourceKey)) throw new Error(`台账第 ${index} 条负债来源键重复`);
					sourceKeys.add(debt.sourceKey);
					if (!PROTO_TO_TABLE.has(debt.table)) throw new Error(`台账第 ${index} 条负债继承表无效`);
					assertText(debt.debtType, `台账第 ${index} 条负债品种`);
					assertText(debt.name, `台账第 ${index} 条负债名称`);
					assertNumber(debt.amount, `台账第 ${index} 条负债金额`, { minimum: 0 });
					assertNumber(debt.interestPayable, `台账第 ${index} 条负债应付利息`, { minimum: 0 });
					assertNumber(debt.annualRate, `台账第 ${index} 条负债利率`, { nullable: true });
					assertDate(debt.issueDate, `台账第 ${index} 条负债起息日`, { nullable: true });
					assertDate(debt.maturityDate, `台账第 ${index} 条负债到期日`, { nullable: true });
					count += 1;
				}
				yield records;
			}
			if (count !== payload.debtCount) throw new Error('台账负债记录数与声明不一致');
			debtsDecoded = true;
		},
		*cashflowBatches() {
			if (!debtsDecoded) throw new Error('台账负债必须先于现金流校验');
			let count = 0;
			for (const bytes of payload.cashflowBatches) {
				const records = fromBinary(CashflowRecordBatchSchema, bytes, { readUnknownFields: false }).records;
				if (!records.length || records.length > RECORD_BATCH_SIZE) throw new Error('台账现金流分批大小无效');
				for (const cashflow of records) {
					const index = count + 1;
					assertText(cashflow.sourceKey, `台账第 ${index} 条现金流来源键`);
					if (!sourceKeys.has(cashflow.sourceKey)) throw new Error(`台账第 ${index} 条现金流没有对应负债`);
					assertText(cashflow.cashflowType, `台账第 ${index} 条现金流类型`);
					assertDate(cashflow.dueDate, `台账第 ${index} 条现金流日期`);
					assertNumber(cashflow.amount, `台账第 ${index} 条现金流金额`, { nullable: true, minimum: 0 });
					if (!Number.isSafeInteger(cashflow.sourceSequence) || cashflow.sourceSequence < 0) {
						throw new Error(`台账第 ${index} 条现金流顺序无效`);
					}
					count += 1;
				}
				yield records;
			}
			if (count !== payload.cashflowCount) throw new Error('台账现金流记录数与声明不一致');
		},
		*balanceBatches() {
			let count = 0;
			let snapshotTotal = 0;
			for (const bytes of payload.balanceBatches) {
				const records = fromBinary(BalanceRecordBatchSchema, bytes, { readUnknownFields: false }).records;
				if (!records.length || records.length > RECORD_BATCH_SIZE) throw new Error('台账余额分批大小无效');
				for (const balance of records) {
					const index = count + 1;
					assertDate(balance.asOfDate, `台账第 ${index} 条余额日期`);
					assertText(balance.debtType, `台账第 ${index} 条余额品种`);
					assertNumber(balance.amount, `台账第 ${index} 条余额金额`, { minimum: 0 });
					if (balance.asOfDate === payload.asOfDate) snapshotTotal += balance.amount;
					count += 1;
				}
				yield records;
			}
			if (count !== payload.balanceCount) throw new Error('台账余额记录数与声明不一致');
			const snapshotTotalYi = snapshotTotal / 100_000_000;
			if (Math.abs(snapshotTotalYi - payload.totalYi) > 0.0001) {
				throw new Error(`台账余额核对失败：明细 ${snapshotTotalYi} 亿元，汇总 ${payload.totalYi} 亿元`);
			}
		}
	};
}

export function debtRecordForImport(item) {
	if (typeof item.table === 'string') return item;
	return {
		sourceKey: item.sourceKey,
		table: PROTO_TO_TABLE.get(item.table),
		debtType: item.debtType,
		subtype: item.subtype,
		name: item.name,
		legacyName: item.legacyName,
		counterparty: item.counterparty,
		amount: item.amount,
		interestPayable: item.interestPayable,
		annualRate: item.annualRate,
		issueDate: item.issueDate,
		maturityDate: item.maturityDate,
		activatedAt: item.activatedAt,
		settledAt: item.settledAt,
		closedAt: item.closedAt,
		extension: {
			issuanceMethod: item.issuanceMethod,
			bookbuildingDate: item.bookbuildingDate,
			interestBasis: item.interestBasis,
			issuanceTarget: item.issuanceTarget,
			market: item.market,
			receivingAccount: item.receivingAccount,
			trustee: item.trustee,
			bookrunner: item.bookrunner,
			liquidationSubmissionStatus: item.liquidationSubmissionStatus,
			liquidationRegistrationStatus: item.liquidationRegistrationStatus,
			returnType: item.returnType,
			subscriptionDate: item.subscriptionDate,
			redemptionDate: item.redemptionDate,
			earlyMaturity: item.earlyMaturity,
			interestBasisDays: item.interestBasisDays,
			isExtended: item.isExtended,
			repaymentAccount: item.repaymentAccount,
			averageRepoBalanceDescription: item.averageRepoBalanceDescription,
			repoWeightedAverageRate: item.repoWeightedAverageRate
		}
	};
}

export function workflowPayloadBase64(bytes) {
	return base64Encode(bytes);
}

export function workflowPayloadBytes(value) {
	if (typeof value !== 'string' || !value) throw new Error('Workflow 导入数据为空');
	return base64Decode(value);
}

export function workflowEventSize(payloadBase64, fileName, fileSizeBytes) {
	return new TextEncoder().encode(JSON.stringify({ payloadBase64, fileName, fileSizeBytes })).byteLength;
}

export function debtImportSummary(payload) {
	return {
		asOfDate: payload.asOfDate ?? payload.snapshot?.asOfDate,
		totalYi: Number(payload.totalYi ?? payload.snapshot?.totalYi),
		debtCount: payload.debtCount ?? payload.debts.length,
		cashflowCount: payload.cashflowCount ?? payload.cashflows.length,
		balanceCount: payload.balanceCount ?? payload.balances.length
	};
}
