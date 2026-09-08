import { json } from '@sveltejs/kit';
import { debtImportRun } from '$lib/server/financing/debt-import-workflow.js';
import type { RequestHandler } from './$types';
import { hasPermission } from '$lib/financing/permissions.js';

const INSTANCE_ID_PATTERN = /^debt-v1-[0-9a-f]{64}$/;
const PRIVATE_JSON_HEADERS = {
	'cache-control': 'no-store, private',
	vary: 'Cookie'
};

export const GET: RequestHandler = async ({ params, locals, platform }) => {
	if (!hasPermission(locals.permissions, 'data_manage')) {
		return json({ error: '当前角色无权查看台账导入进度' }, { status: 403 });
	}
	if (!INSTANCE_ID_PATTERN.test(params.id)) return json({ error: '导入任务编号无效' }, { status: 400 });
	if (!platform?.env?.DEBT_IMPORT_WORKFLOW) {
		return json({ error: 'Workflow 暂不可用，请稍后重试' }, { status: 503 });
	}
	try {
		const instance = await platform.env.DEBT_IMPORT_WORKFLOW.get(params.id);
		const details = await instance.status();
		if (details.status === 'unknown') throw new Error('Workflow instance not found');
		return json({
			run: debtImportRun(params.id, details)
		}, { headers: PRIVATE_JSON_HEADERS });
	} catch {
		return json({ error: '未找到导入任务，Workflow 临时状态可能已过保留期' }, {
			status: 404,
			headers: PRIVATE_JSON_HEADERS
		});
	}
};
