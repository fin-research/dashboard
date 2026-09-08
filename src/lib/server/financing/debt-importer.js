// @ts-nocheck
import { debtRecordForImport } from '../../financing/debt-import-codec.js';

const IMPORT_BATCH_SIZE = 1_000;

const commonColumns = [
	'id', 'debt_type', 'subtype', 'name', 'counterparty', 'amount', 'interest_payable',
	'annual_rate', 'issue_date', 'maturity_date', 'activated_at', 'settled_at', 'closed_at'
];

const tableExtensions = {
	debt: [],
	bond: [
		['issuance_method', 'issuanceMethod', 'text'], ['bookbuilding_date', 'bookbuildingDate', 'date'],
		['interest_basis', 'interestBasis', 'text'], ['issuance_target', 'issuanceTarget', 'text'],
		['market', 'market', 'text'], ['receiving_account', 'receivingAccount', 'text'],
		['trustee', 'trustee', 'text'], ['bookrunner', 'bookrunner', 'text']
	],
	income_certificate: [
		['liquidation_submission_status', 'liquidationSubmissionStatus', 'text'],
		['liquidation_registration_status', 'liquidationRegistrationStatus', 'text'],
		['return_type', 'returnType', 'text'], ['subscription_date', 'subscriptionDate', 'date'],
		['redemption_date', 'redemptionDate', 'date'], ['receiving_account', 'receivingAccount', 'text'],
		['early_maturity', 'earlyMaturity', 'boolean']
	],
	income_right: [['interest_basis_days', 'interestBasisDays', 'integer']],
	refinancing: [
		['interest_basis_days', 'interestBasisDays', 'integer'], ['market', 'market', 'text'],
		['is_extended', 'isExtended', 'boolean'], ['receiving_account', 'receivingAccount', 'text'],
		['repayment_account', 'repaymentAccount', 'text']
	],
	swap_facility: [
		['average_repo_balance_description', 'averageRepoBalanceDescription', 'text'],
		['repo_weighted_average_rate', 'repoWeightedAverageRate', 'numeric']
	]
};

function extensionExpression(key, type, alias = 'source') {
	return type === 'text'
		? `${alias}.extension ->> '${key}'`
		: `NULLIF(${alias}.extension ->> '${key}', '')::${type}`;
}

function commonSelect(alias = 'source') {
	return [
		`${alias}.debt_id`, `${alias}.debt_type`, `${alias}.subtype`, `${alias}.name`, `${alias}.counterparty`,
		`${alias}.amount`, `${alias}.interest_payable`, `${alias}.annual_rate`, `${alias}.issue_date`,
		`${alias}.maturity_date`, `${alias}.activated_at`, `${alias}.settled_at`, `${alias}.closed_at`
	];
}

function databaseNumber(value) {
	const result = Number(value);
	return Number.isFinite(result) ? result : 0;
}

function chunks(values) {
	const result = [];
	for (let offset = 0; offset < values.length; offset += IMPORT_BATCH_SIZE) {
		result.push(values.slice(offset, offset + IMPORT_BATCH_SIZE));
	}
	return result;
}

function importBatches(transformed, property, factory) {
	if (typeof transformed[factory] === 'function') return transformed[factory]();
	return chunks(transformed[property]);
}

function workbookSnapshot(transformed) {
	return transformed.snapshot ?? {
		asOfDate: transformed.asOfDate,
		totalYi: transformed.totalYi
	};
}

/**
 * Applies one parsed workbook to the financing base tables in one transaction.
 * Existing records are matched by stable business identity and updated; records
 * that exist only online are retained.
 */
export async function importDebtWorkbook(database, transformed, {
	rollback = false,
	refreshDerivatives = false,
	onStage = async () => {}
} = {}) {
	const snapshot = workbookSnapshot(transformed);
	await database.query('BEGIN');
	try {
		await database.query("SELECT pg_advisory_xact_lock(hashtext('financing.local_debt_maintenance'))");
		await onStage({ stage: 'importing', progress: 65, message: '正在原子更新负债、现金流与余额历史' });
		await database.query(`
			CREATE TEMP TABLE maintenance_debt (
				source_ordinal bigint GENERATED ALWAYS AS IDENTITY,
				source_key text NOT NULL UNIQUE,
				target_table text NOT NULL,
				debt_type text NOT NULL,
				subtype text,
				name text NOT NULL,
				legacy_name text,
				counterparty text,
				amount numeric(20, 2) NOT NULL,
				interest_payable numeric(20, 2) NOT NULL,
				annual_rate numeric(12, 10),
				issue_date date,
				maturity_date date,
				activated_at date,
				settled_at date,
				closed_at date,
				extension jsonb NOT NULL,
				occurrence integer,
				legacy_occurrence integer,
				debt_id bigint,
				existing_table text,
				is_new boolean NOT NULL DEFAULT false
			) ON COMMIT DROP
		`);
		for await (const batch of importBatches(transformed, 'debts', 'debtBatches')) {
			await database.query(`
				INSERT INTO maintenance_debt (
					source_key, target_table, debt_type, subtype, name, legacy_name, counterparty, amount,
					interest_payable, annual_rate, issue_date, maturity_date, activated_at,
					settled_at, closed_at, extension
				)
				SELECT * FROM jsonb_to_recordset($1::jsonb) AS source(
					source_key text, target_table text, debt_type text, subtype text, name text, legacy_name text,
					counterparty text, amount numeric, interest_payable numeric, annual_rate numeric,
					issue_date date, maturity_date date, activated_at date, settled_at date,
					closed_at date, extension jsonb
				)
			`, [JSON.stringify(batch.map((sourceDebt) => {
				const debt = debtRecordForImport(sourceDebt);
				return {
					source_key: debt.sourceKey,
					target_table: debt.table,
					debt_type: debt.debtType,
					subtype: debt.subtype,
					name: debt.name,
					legacy_name: debt.legacyName,
					counterparty: debt.counterparty,
					amount: debt.amount,
					interest_payable: debt.interestPayable,
					annual_rate: debt.annualRate,
					issue_date: debt.issueDate,
					maturity_date: debt.maturityDate,
					activated_at: debt.activatedAt,
					settled_at: debt.settledAt,
					closed_at: debt.closedAt,
					extension: debt.extension
				};
			}))]);
		}
		await database.query(`
			WITH ranked AS (
				SELECT source_ordinal,
					row_number() OVER (PARTITION BY debt_type, subtype, name, counterparty, issue_date, maturity_date ORDER BY source_ordinal) AS occurrence,
					row_number() OVER (PARTITION BY debt_type, subtype, legacy_name, counterparty, issue_date, maturity_date ORDER BY source_ordinal) AS legacy_occurrence
				FROM maintenance_debt
			)
			UPDATE maintenance_debt source
			SET occurrence = ranked.occurrence, legacy_occurrence = ranked.legacy_occurrence
			FROM ranked WHERE ranked.source_ordinal = source.source_ordinal
		`);
		await database.query(`
			WITH existing AS (
				SELECT d.id, d.tableoid::regclass::text AS physical_table,
					row_number() OVER (
						PARTITION BY d.debt_type, d.subtype, d.name, d.counterparty, d.issue_date, d.maturity_date
						ORDER BY d.id
					) AS occurrence,
					d.debt_type, d.subtype, d.name, d.counterparty, d.issue_date, d.maturity_date
				FROM financing.debt d
			)
			UPDATE maintenance_debt source
			SET debt_id = existing.id, existing_table = existing.physical_table
			FROM existing
			WHERE existing.debt_type = source.debt_type
				AND existing.subtype IS NOT DISTINCT FROM source.subtype
				AND existing.name = source.name
				AND existing.counterparty IS NOT DISTINCT FROM source.counterparty
				AND (
					existing.issue_date IS NOT DISTINCT FROM source.issue_date
					OR (
						source.debt_type = '互换便利'
						AND existing.debt_type = '互换便利'
						AND existing.maturity_date IS NOT DISTINCT FROM source.maturity_date
					)
				)
				AND existing.maturity_date IS NOT DISTINCT FROM source.maturity_date
				AND existing.occurrence = source.occurrence
		`);
		await database.query(`
			WITH existing AS (
				SELECT d.id, d.tableoid::regclass::text AS physical_table,
					row_number() OVER (
						PARTITION BY d.debt_type, d.subtype, d.name, d.counterparty, d.issue_date, d.maturity_date
						ORDER BY d.id
					) AS occurrence,
					d.debt_type, d.subtype, d.name, d.counterparty, d.issue_date, d.maturity_date
				FROM financing.debt d
			)
			UPDATE maintenance_debt source
			SET debt_id = existing.id, existing_table = existing.physical_table
			FROM existing
			WHERE source.debt_id IS NULL
				AND source.debt_type = '收益凭证'
				AND source.legacy_name IS NOT NULL
				AND existing.debt_type = source.debt_type
				AND existing.subtype IS NOT DISTINCT FROM source.subtype
				AND existing.name = source.legacy_name
				AND existing.counterparty IS NOT DISTINCT FROM source.counterparty
				AND existing.issue_date IS NOT DISTINCT FROM source.issue_date
				AND existing.maturity_date IS NOT DISTINCT FROM source.maturity_date
				AND existing.occurrence = source.legacy_occurrence
		`);
		const mismatches = await database.query(`
			SELECT source_key, target_table, existing_table FROM maintenance_debt
			WHERE debt_id IS NOT NULL AND existing_table <> 'financing.' || target_table
		`);
		if (mismatches.rowCount) {
			throw new Error(`已有负债的继承类型与工作簿不一致：${JSON.stringify(mismatches.rows.slice(0, 5))}`);
		}
		await database.query(`
			UPDATE maintenance_debt SET debt_id = nextval('financing.debt_id_seq'), is_new = true
			WHERE debt_id IS NULL
		`);

		for (const [table, extensions] of Object.entries(tableExtensions)) {
			const updateAssignments = [
				'debt_type = source.debt_type', 'subtype = source.subtype', 'name = source.name',
				'counterparty = source.counterparty', 'amount = source.amount',
				'interest_payable = source.interest_payable', 'annual_rate = source.annual_rate',
				'issue_date = source.issue_date', 'maturity_date = source.maturity_date',
				'activated_at = source.activated_at', 'settled_at = source.settled_at', 'closed_at = source.closed_at',
				...extensions.map(([column, key, type]) => `${column} = ${extensionExpression(key, type)}`)
			];
			await database.query(`
				UPDATE ONLY financing.${table} target SET ${updateAssignments.join(', ')}
				FROM maintenance_debt source
				WHERE source.target_table = $1 AND source.is_new = false AND target.id = source.debt_id
			`, [table]);
			const extensionColumns = extensions.map(([column]) => column);
			const selectValues = [
				...commonSelect(),
				...extensions.map(([_column, key, type]) => extensionExpression(key, type))
			];
			await database.query(`
				INSERT INTO financing.${table} (${[...commonColumns, ...extensionColumns].join(', ')})
				SELECT ${selectValues.join(', ')} FROM maintenance_debt source
				WHERE source.target_table = $1 AND source.is_new = true
				ORDER BY source.source_ordinal
			`, [table]);
		}

		await database.query(`
			CREATE TEMP TABLE maintenance_cashflow (
				source_key text NOT NULL,
				debt_id bigint,
				cashflow_type text NOT NULL,
				due_date date NOT NULL,
				amount numeric(20, 2),
				paid_amount numeric(20, 2),
				paid_at date,
				accrual_start_date date,
				accrual_end_date date,
				note text,
				source_sequence integer NOT NULL,
				occurrence integer,
				sequence integer,
				is_new boolean NOT NULL DEFAULT false
			) ON COMMIT DROP
		`);
		for await (const batch of importBatches(transformed, 'cashflows', 'cashflowBatches')) {
			await database.query(`
				INSERT INTO maintenance_cashflow (
					source_key, cashflow_type, due_date, amount, paid_amount, paid_at,
					accrual_start_date, accrual_end_date, note, source_sequence
				)
				SELECT source_key, cashflow_type, due_date, amount, paid_amount, paid_at,
					accrual_start_date, accrual_end_date, note, source_sequence
				FROM jsonb_to_recordset($1::jsonb) AS source(
					source_key text, cashflow_type text, due_date date, amount numeric,
					paid_amount numeric, paid_at date, accrual_start_date date, accrual_end_date date,
					note text, source_sequence integer
				)
			`, [JSON.stringify(batch.map((flow) => ({
				source_key: flow.sourceKey,
				cashflow_type: flow.cashflowType,
				due_date: flow.dueDate,
				amount: flow.amount,
				paid_amount: flow.paidAmount,
				paid_at: flow.paidAt,
				accrual_start_date: flow.accrualStartDate,
				accrual_end_date: flow.accrualEndDate,
				note: flow.note,
				source_sequence: flow.sourceSequence ?? flow.sequence ?? 0
			})))]);
		}
		await database.query(`
			WITH ranked AS (
				SELECT ctid,
					row_number() OVER (
						PARTITION BY source_key, cashflow_type, due_date, amount
						ORDER BY source_sequence
					) AS occurrence
				FROM maintenance_cashflow
			)
			UPDATE maintenance_cashflow source SET occurrence = ranked.occurrence
			FROM ranked WHERE source.ctid = ranked.ctid
		`);
		await database.query(`
			UPDATE maintenance_cashflow flow SET debt_id = debt.debt_id
			FROM maintenance_debt debt WHERE debt.source_key = flow.source_key
		`);
		await database.query(`
			WITH existing AS (
				SELECT c.debt_id, c.sequence, c.cashflow_type, c.due_date, c.amount,
					row_number() OVER (PARTITION BY c.debt_id, c.cashflow_type, c.due_date, c.amount ORDER BY c.sequence) AS occurrence
				FROM financing.cashflow c
			)
			UPDATE maintenance_cashflow source SET sequence = existing.sequence
			FROM existing
			WHERE existing.debt_id = source.debt_id
				AND existing.cashflow_type = source.cashflow_type
				AND existing.due_date = source.due_date
				AND existing.amount IS NOT DISTINCT FROM source.amount
				AND existing.occurrence = source.occurrence
		`);
		await database.query(`
			WITH maximum AS (
				SELECT debt_id, COALESCE(MAX(sequence), 0) AS maximum FROM financing.cashflow GROUP BY debt_id
			), numbered AS (
				SELECT ctid, debt_id,
					row_number() OVER (PARTITION BY debt_id ORDER BY due_date, cashflow_type, occurrence) AS offset
				FROM maintenance_cashflow WHERE sequence IS NULL
			)
			UPDATE maintenance_cashflow source
			SET sequence = COALESCE(maximum.maximum, 0) + numbered.offset, is_new = true
			FROM numbered LEFT JOIN maximum ON maximum.debt_id = numbered.debt_id
			WHERE source.ctid = numbered.ctid
		`);
		await database.query(`
			UPDATE financing.cashflow target SET
				cashflow_type = source.cashflow_type, due_date = source.due_date, amount = source.amount,
				paid_amount = source.paid_amount, paid_at = source.paid_at,
				accrual_start_date = source.accrual_start_date, accrual_end_date = source.accrual_end_date,
				note = source.note
			FROM maintenance_cashflow source
			WHERE source.is_new = false AND target.debt_id = source.debt_id AND target.sequence = source.sequence
		`);
		await database.query(`
			INSERT INTO financing.cashflow (
				debt_id, sequence, cashflow_type, due_date, amount, paid_amount, paid_at,
				accrual_start_date, accrual_end_date, note
			)
			SELECT debt_id, sequence, cashflow_type, due_date, amount, paid_amount, paid_at,
				accrual_start_date, accrual_end_date, note
			FROM maintenance_cashflow WHERE is_new = true ORDER BY debt_id, sequence
		`);
		for await (const batch of importBatches(transformed, 'balances', 'balanceBatches')) {
			await database.query(`
				INSERT INTO financing.balance_snapshot (as_of_date, debt_type, subtype, amount)
				SELECT as_of_date, debt_type, subtype, amount
				FROM jsonb_to_recordset($1::jsonb) AS source(
					as_of_date date, debt_type text, subtype text, amount numeric
				)
				ON CONFLICT (as_of_date, debt_type, subtype) DO UPDATE SET amount = EXCLUDED.amount
			`, [JSON.stringify(batch.map((item) => ({
				as_of_date: item.asOfDate,
				debt_type: item.debtType,
				subtype: item.subtype,
				amount: item.amount
				})))]);
		}

		const verification = await database.query(`
			SELECT
				(SELECT COUNT(*) FROM financing.debt) AS debt_count,
				(SELECT COUNT(*) FROM financing.cashflow) AS cashflow_count,
				(SELECT COUNT(DISTINCT as_of_date) FROM financing.balance_snapshot) AS history_date_count,
				(SELECT SUM(amount) / 100000000.0 FROM financing.balance_snapshot WHERE as_of_date = $1::date) AS snapshot_total_yi,
				(SELECT COUNT(*) FROM maintenance_debt WHERE is_new) AS inserted_debt_count,
				(SELECT COUNT(*) FROM maintenance_debt WHERE NOT is_new) AS updated_debt_count,
				(SELECT COUNT(*) FROM maintenance_cashflow WHERE is_new) AS inserted_cashflow_count,
				(SELECT COUNT(*) FROM maintenance_cashflow WHERE NOT is_new) AS updated_cashflow_count
		`, [snapshot.asOfDate]);
		const result = verification.rows[0];
		if (Math.abs(Number(result.snapshot_total_yi) - Number(snapshot.totalYi)) > 0.0001) {
			throw new Error(`余额核对失败：数据库 ${result.snapshot_total_yi} 亿元，工作簿 ${snapshot.totalYi} 亿元`);
		}
		let derivativeResult = { deletedCount: 0, refreshedCount: 0 };
		if (refreshDerivatives) {
			await onStage({ stage: 'refreshing', progress: 88, message: '正在重算月度融资衍生指标' });
			const deleted = await database.query('DELETE FROM financing.monthly_financing_metrics');
			const refreshed = await database.query(
				'SELECT financing.refresh_monthly_financing_metrics($1::date) AS refreshed_count',
				[snapshot.asOfDate]
			);
			derivativeResult = {
				deletedCount: databaseNumber(deleted.rowCount),
				refreshedCount: databaseNumber(refreshed.rows[0]?.refreshed_count)
			};
		}
		await onStage({ stage: 'finalizing', progress: 96, message: '正在执行最终勾稽并提交事务' });
		await database.query("SELECT setval('financing.debt_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM financing.debt), 1), true)");
		await database.query(rollback ? 'ROLLBACK' : 'COMMIT');
		return {
			mode: rollback ? 'rollback' : 'committed',
			asOfDate: snapshot.asOfDate,
			totalYi: Number(result.snapshot_total_yi),
			debtCount: databaseNumber(result.debt_count),
			cashflowCount: databaseNumber(result.cashflow_count),
			historyDateCount: databaseNumber(result.history_date_count),
			insertedDebtCount: databaseNumber(result.inserted_debt_count),
			updatedDebtCount: databaseNumber(result.updated_debt_count),
			insertedCashflowCount: databaseNumber(result.inserted_cashflow_count),
			updatedCashflowCount: databaseNumber(result.updated_cashflow_count),
			derivedMetricCount: derivativeResult.refreshedCount
		};
	} catch (error) {
		try {
			await database.query('ROLLBACK');
		} catch {
			// Preserve the original import error if the connection is already unusable.
		}
		throw error;
	}
}

export async function refreshDebtImportDerivatives(database, reportDate) {
	return database.transaction(async (transaction) => {
		await transaction.query("SELECT pg_advisory_xact_lock(hashtext('financing.local_debt_maintenance'))");
		const deleted = await transaction.query('DELETE FROM financing.monthly_financing_metrics');
		const refreshed = await transaction.query(
			'SELECT financing.refresh_monthly_financing_metrics($1::date) AS refreshed_count',
			[reportDate]
		);
		return {
			deletedCount: databaseNumber(deleted.rowCount),
			refreshedCount: databaseNumber(refreshed.rows[0]?.refreshed_count)
		};
	});
}
