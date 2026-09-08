// @ts-nocheck
import brotliPromise from 'brotli-wasm';
import { parseDebtWorkbookData } from '../../../scripts/financing/lib/excel-import.mjs';
import { transformWorkbook } from '../../../scripts/financing/lib/debt-transform.mjs';
import {
	encodeDebtImportPayload,
	MAX_COMPRESSED_PAYLOAD_BYTES,
	MAX_PROTOBUF_PAYLOAD_BYTES
} from './debt-import-codec.js';

self.addEventListener('message', async (event) => {
	try {
		const transformed = transformWorkbook(parseDebtWorkbookData(event.data.workbookData, event.data.fileName));
		self.postMessage({
			type: 'parsed',
			summary: {
				asOfDate: transformed.snapshot.asOfDate,
				totalYi: transformed.snapshot.totalYi,
				debtCount: transformed.debts.length,
				cashflowCount: transformed.cashflows.length,
				balanceCount: transformed.balances.length
			}
		});
		const protobuf = encodeDebtImportPayload(transformed);
		if (protobuf.byteLength > MAX_PROTOBUF_PAYLOAD_BYTES) {
			throw new Error('台账结构化数据超过 16 MB 安全上限');
		}
		const brotli = await brotliPromise;
		const compressed = Uint8Array.from(brotli.compress(protobuf, { quality: 10 }));
		if (compressed.byteLength > MAX_COMPRESSED_PAYLOAD_BYTES) {
			throw new Error('台账数据超过 Workflow 安全上限，请联系管理员调整导入方案');
		}
		self.postMessage({
			type: 'complete',
			compressed: compressed.buffer,
			protobufSizeBytes: protobuf.byteLength
		}, [compressed.buffer]);
	} catch (error) {
		self.postMessage({
			type: 'error',
			message: error instanceof Error ? error.message : String(error)
		});
	}
});
