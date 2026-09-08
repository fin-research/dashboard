import { brotliDecompressSync } from 'node:zlib';
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import {
	decodeDebtImportPayload,
	debtImportSummary,
	MAX_COMPRESSED_PAYLOAD_BYTES,
	MAX_PROTOBUF_PAYLOAD_BYTES,
	workflowPayloadBytes
} from '../src/lib/financing/debt-import-codec.js';
import { createPostgresDatabase } from '../src/lib/financing/postgres.js';
import { importDebtWorkbook } from '../src/lib/server/financing/debt-importer.js';

import type { DebtImportWorkflowParams } from '../src/lib/financing/debt-import-types';
export type { DebtImportWorkflowParams } from '../src/lib/financing/debt-import-types';

async function withDatabase<T>(
	env: Env,
	applicationName: string,
	callback: (database: ReturnType<typeof createPostgresDatabase>) => Promise<T>
) {
	const database = createPostgresDatabase(env.HYPERDRIVE.connectionString, applicationName);
	try {
		return await callback(database);
	} finally {
		await database.close();
	}
}

function nonRetryableMessage(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	return message.slice(0, 1000) || '导入数据无效';
}

function isBusinessValidationError(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	return /^(余额核对失败|已有负债的继承类型与工作簿不一致|台账)/u.test(message);
}

function decodeWorkflowPayload(payloadBase64: string) {
	let compressed: Uint8Array;
	try {
		compressed = workflowPayloadBytes(payloadBase64);
	} catch {
		throw new NonRetryableError('Workflow 导入数据编码无效');
	}
	if (!compressed.byteLength || compressed.byteLength > MAX_COMPRESSED_PAYLOAD_BYTES) {
		throw new NonRetryableError('Workflow 导入数据超过安全上限');
	}
	try {
		const protobuf = brotliDecompressSync(compressed, {
			maxOutputLength: MAX_PROTOBUF_PAYLOAD_BYTES
		});
		return decodeDebtImportPayload(protobuf);
	} catch (error) {
		throw new NonRetryableError(`台账数据解码或校验失败：${nonRetryableMessage(error)}`);
	}
}

export class DebtImportWorkflow extends WorkflowEntrypoint<Env, DebtImportWorkflowParams> {
	async run(event: WorkflowEvent<DebtImportWorkflowParams>, step: WorkflowStep) {
		const { payloadBase64, fileName, fileSizeBytes } = event.payload;
		if (
			typeof payloadBase64 !== 'string'
			|| typeof fileName !== 'string'
			|| !fileName.toLowerCase().endsWith('.xlsx')
			|| !Number.isInteger(fileSizeBytes)
			|| fileSizeBytes <= 0
			|| fileSizeBytes > 10 * 1024 * 1024
		) {
			throw new NonRetryableError('Workflow 导入参数无效');
		}

		return step.do('validate and atomically import debt ledger', {
			retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' },
			timeout: '20 minutes'
		}, async () => {
			const payload = decodeWorkflowPayload(payloadBase64);
			const source = debtImportSummary(payload);
			try {
				const result = await withDatabase(
					this.env,
					'eastmoney-financing-debt-import',
					(database) => importDebtWorkbook(database, payload, { refreshDerivatives: true })
				);
				return {
					fileName,
					fileSizeBytes,
					asOfDate: result.asOfDate,
					totalYi: result.totalYi,
					sourceDebtCount: source.debtCount,
					sourceCashflowCount: source.cashflowCount,
					sourceBalanceCount: source.balanceCount,
					insertedDebtCount: result.insertedDebtCount,
					updatedDebtCount: result.updatedDebtCount,
					skippedDebtCount: result.skippedDebtCount,
					warnings: result.warnings,
					unlinkedClientNames: result.unlinkedClientNames,
					snapshotDifferenceYi: result.snapshotDifferenceYi,
					insertedCashflowCount: result.insertedCashflowCount,
					updatedCashflowCount: result.updatedCashflowCount,
					databaseDebtCount: result.debtCount,
					databaseCashflowCount: result.cashflowCount,
					historyDateCount: result.historyDateCount,
					derivedMetricCount: result.derivedMetricCount,
					createdAt: event.timestamp.toISOString(),
					completedAt: new Date().toISOString()
				};
			} catch (error) {
				if (isBusinessValidationError(error)) {
					throw new NonRetryableError(nonRetryableMessage(error));
				}
				throw error;
			}
		});
	}
}
