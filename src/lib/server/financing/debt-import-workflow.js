// @ts-nocheck

function safeWorkflowError(details) {
	const message = details.error?.message ?? '';
	if (/^(余额核对失败|已有负债的继承类型与工作簿不一致|台账)/u.test(message)) {
		return message.slice(0, 1000);
	}
	return '线上数据库更新失败；Workflow 已自动重试，请联系管理员查看运行日志';
}

export function debtImportRun(instanceId, details, metadata = {}) {
	const output = details.output && typeof details.output === 'object' && !Array.isArray(details.output)
		? details.output
		: {};
	const errored = details.status === 'errored' || details.status === 'terminated';
	return {
		...metadata,
		...output,
		id: instanceId,
		status: details.status === 'complete' ? 'succeeded' : errored ? 'failed' : details.status === 'queued' ? 'queued' : 'running',
		stage: details.status === 'complete' ? 'completed' : details.status === 'queued' ? 'queued' : 'importing',
		progress: details.status === 'complete' || errored ? 100 : details.status === 'queued' ? 45 : 70,
		message: details.status === 'complete'
			? '线上数据与衍生指标已更新'
			: errored
				? '导入失败，请按提示修正后重新上传'
				: details.status === 'queued'
					? '数据已进入 Workflow，等待执行'
					: 'Workflow 正在原子更新线上数据',
		errorMessage: errored ? safeWorkflowError(details) : null
	};
}
