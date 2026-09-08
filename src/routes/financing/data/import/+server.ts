import { json } from '@sveltejs/kit';
import {
	MAX_COMPRESSED_PAYLOAD_BYTES,
	MAX_WORKFLOW_EVENT_BYTES,
	workflowEventSize,
	workflowPayloadBase64
} from '$lib/financing/debt-import-codec.js';
import { debtImportRun } from '$lib/server/financing/debt-import-workflow.js';
import { sha256Hex } from '../../../../../scripts/financing/lib/hash.mjs';
import type { RequestHandler } from './$types';
import { hasPermission } from '$lib/permissions';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const PRIVATE_JSON_HEADERS = {
	'cache-control': 'no-store, private',
	vary: 'Cookie'
};

function canImportDebtLedger(locals: App.Locals) {
	return hasPermission(locals.permissions, 'financing.data:import');
}

function uploadFileName(request: Request) {
	const encoded = request.headers.get('x-import-filename');
	if (!encoded) throw new Error('请选择借入资金汇总表文件');
	let decoded: string;
	try {
		decoded = decodeURIComponent(encoded);
	} catch {
		throw new Error('文件名编码无效');
	}
	const name = decoded.split(/[/\\]/).at(-1)?.trim() ?? '';
	if (!name.toLowerCase().endsWith('.xlsx')) throw new Error('仅支持 .xlsx 格式的借入资金汇总表');
	if (!name || name.length > 240) throw new Error('文件名无效或过长');
	return name;
}

function originalFileSize(request: Request) {
	const size = Number(request.headers.get('x-import-file-size'));
	if (!Number.isInteger(size) || size <= 0) throw new Error('无法确认原始文件大小');
	if (size > MAX_UPLOAD_BYTES) throw new Error('文件超过 10 MB 上限');
	return size;
}

function compressedSize(request: Request) {
	const size = Number(request.headers.get('content-length'));
	if (!Number.isInteger(size) || size <= 0) throw new Error('无法确认编码后的导入数据大小');
	if (size > MAX_COMPRESSED_PAYLOAD_BYTES) {
		throw new Error('台账数据超过 Workflow 安全上限，请联系管理员调整导入方案');
	}
	return size;
}

function safeError(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	return message.slice(0, 1000) || '导入请求失败';
}

export const POST: RequestHandler = async ({ request, url, locals, platform }) => {
	if (!canImportDebtLedger(locals)) return json({ error: '当前角色无权上传借入资金汇总表' }, { status: 403 });
	if (request.headers.get('origin') !== url.origin) {
		return json({ error: '上传请求来源无效，请刷新页面后重试' }, { status: 403 });
	}
	if (request.headers.get('content-type') !== 'application/vnd.eastmoney.debt-import+protobuf') {
		return json({ error: '导入数据编码无效，请刷新页面后重试' }, { status: 415 });
	}
	if (!request.body) return json({ error: '请选择借入资金汇总表文件' }, { status: 400 });
	if (!platform?.env?.DEBT_IMPORT_WORKFLOW) {
		return json({ error: 'Workflow 暂不可用，请稍后重试' }, { status: 503 });
	}

	let fileName: string;
	let fileSizeBytes: number;
	let claimedCompressedSize: number;
	try {
		fileName = uploadFileName(request);
		fileSizeBytes = originalFileSize(request);
		claimedCompressedSize = compressedSize(request);
	} catch (error) {
		return json({ error: safeError(error) }, { status: 400, headers: PRIVATE_JSON_HEADERS });
	}

	let payloadBytes: Uint8Array;
	let payloadBase64: string;
	let eventBytes: number;
	let instanceId: string;
	try {
		payloadBytes = new Uint8Array(await request.arrayBuffer());
		if (!payloadBytes.byteLength || payloadBytes.byteLength !== claimedCompressedSize) {
			throw new Error('编码后的导入数据大小不一致，请重新上传');
		}
		payloadBase64 = workflowPayloadBase64(payloadBytes);
		eventBytes = workflowEventSize(payloadBase64, fileName, fileSizeBytes);
		if (eventBytes > MAX_WORKFLOW_EVENT_BYTES) {
			throw new Error('台账数据超过 Workflow 1 MiB 上限，请联系管理员调整导入方案');
		}
		instanceId = `debt-v1-${sha256Hex(payloadBytes)}`;
	} catch (error) {
		return json({ error: safeError(error) }, { status: 400, headers: PRIVATE_JSON_HEADERS });
	}

	try {
		let instance;
		let details;
		let created = false;
		try {
			[instance] = await platform.env.DEBT_IMPORT_WORKFLOW.createBatch([{
				id: instanceId,
				params: { payloadBase64, fileName, fileSizeBytes },
				retention: {
					successRetention: '1 day',
					errorRetention: '1 day'
				}
			}]);
			created = true;
		} catch (createError) {
			try {
				instance = await platform.env.DEBT_IMPORT_WORKFLOW.get(instanceId);
				details = await instance.status();
				if (details.status === 'unknown') throw createError;
			} catch {
				throw createError;
			}
		}
		if (!instance) throw new Error('Workflow 未返回实例');
		details ??= await instance.status();
		if (details.status === 'unknown') throw new Error('Workflow 实例状态未知');
		let restarted = false;
		if (!created && (details.status === 'errored' || details.status === 'terminated')) {
			await instance.restart();
			details = await instance.status();
			if (details.status === 'errored' || details.status === 'terminated') {
				details = { status: 'queued' };
			}
			restarted = true;
		}
		return json({
			run: {
				...debtImportRun(instanceId, details, {
					fileName,
					fileSizeBytes,
					createdAt: new Date().toISOString()
				}),
				fileSizeBytes,
				compressedSizeBytes: payloadBytes.byteLength,
				workflowEventBytes: eventBytes,
				restarted
			}
		}, { status: created || restarted ? 202 : 200, headers: PRIVATE_JSON_HEADERS });
	} catch (error) {
		console.error('Failed to create idempotent debt import Workflow instance', error);
		return json({ error: 'Workflow 启动失败，请稍后重试' }, { status: 503, headers: PRIVATE_JSON_HEADERS });
	}
};
