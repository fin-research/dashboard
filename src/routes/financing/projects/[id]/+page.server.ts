import { randomUUID } from 'node:crypto';
import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { auditRequestMeta, prepareAudit } from '$lib/server/financing/audit.js';
import { getDatabase } from '$lib/server/financing/db.js';

const PROJECT_STATUSES = new Set(['planning', 'in_progress', 'at_risk', 'completed', 'cancelled']);
const TASK_STATUSES = new Set(['not_started', 'in_progress', 'blocked', 'completed']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function actionAudit(event: Parameters<typeof auditRequestMeta>[0], action: string, detail: string) {
	return {
		action,
		detail,
		actor: event.locals.user?.email ?? '系统',
		createdAt: new Date().toISOString()
	};
}

async function resolveProjectId(rawId: string) {
	const db = getDatabase();
	const exact = await db.prepare('SELECT id FROM projects WHERE id = ?').get(rawId) as { id: string } | undefined;
	if (exact) return exact.id;

	const index = Number(rawId);
	if (!Number.isInteger(index) || index < 1) return null;
	const legacy = await db.prepare(`
		SELECT id FROM projects
		ORDER BY COALESCE(planned_start_date, planned_issue_date), name
		LIMIT 1 OFFSET ?
	`).get(index - 1) as { id: string } | undefined;
	return legacy?.id ?? null;
}

async function loadProject(projectId: string) {
	const db = getDatabase();
	const row = await db.prepare(`
		SELECT p.id, p.code, p.name, p.debt_type AS debtType, p.borrower, p.amount, p.currency,
			p.status, p.planned_start_date AS plannedStartDate, p.planned_issue_date AS plannedIssueDate,
			p.planned_maturity_date AS plannedMaturityDate, p.notes, p.created_at AS createdAt,
			p.updated_at AS updatedAt, p.owner_id AS ownerId, owner.name AS ownerName,
			p.expected_rate_min AS expectedRateMin, p.expected_rate_max AS expectedRateMax,
			p.funding_cost_rate AS fundingCostRate, p.tenor_description AS tenorDescription,
			p.amount_description AS amountDescription,
			st.name AS sopName,
			COALESCE((
				SELECT jsonb_agg(jsonb_build_object(
					'id', pt.id, 'name', pt.name, 'status', pt.status,
					'assigneeId', pt.assignee_id, 'assigneeName', assignee.name,
					'plannedStartDate', pt.planned_start_date, 'dueDate', pt.due_date,
					'completedAt', pt.completed_at, 'sortOrder', pt.sort_order,
					'notes', COALESCE(pt.notes, node.description), 'updatedAt', pt.updated_at
				) ORDER BY pt.sort_order, pt.due_date, pt.name)
				FROM project_tasks pt
				LEFT JOIN sop_nodes node ON node.id = pt.sop_node_id
				LEFT JOIN people assignee ON assignee.id = pt.assignee_id
				WHERE pt.project_id = p.id
			), '[]'::jsonb) AS tasks,
			COALESCE((
				SELECT jsonb_agg(jsonb_build_object(
					'id', person.id, 'name', person.name, 'email', person.email, 'role', person.role
				) ORDER BY person.name)
				FROM people person WHERE person.active = TRUE
			), '[]'::jsonb) AS people,
			COALESCE((
				SELECT jsonb_agg(jsonb_build_object(
					'action', logs.action, 'detail', logs.summary,
					'actor', COALESCE(logs.actor_email, '系统'), 'createdAt', logs.created_at
				) ORDER BY logs.created_at DESC, logs.id DESC)
				FROM (
					SELECT id, action, summary, actor_email, created_at
					FROM audit_logs WHERE entity_type = 'project' AND entity_id = p.id
					ORDER BY created_at DESC, id DESC LIMIT 30
				) logs
			), '[]'::jsonb) AS auditLogs
		FROM projects p
		LEFT JOIN people owner ON owner.id = p.owner_id
		LEFT JOIN sop_templates st ON st.id = p.sop_template_id
		WHERE p.id = ?
	`).get(projectId);
	if (!row) return null;
	const { tasks = [], people = [], auditLogs = [], ...project } = row as any;

	const membersById = new Map<string, { id: string; name: string; email: string | null; role: string | null; responsibility: string }>();
	if ((project as { ownerId?: string }).ownerId) {
		const owner = people.find((person: any) => person.id === (project as any).ownerId) as any;
		if (owner) membersById.set(owner.id, { ...owner, responsibility: '项目负责人' });
	}
	for (const task of tasks as any[]) {
		if (!task.assigneeId || membersById.has(task.assigneeId)) continue;
		const person = people.find((candidate: any) => candidate.id === task.assigneeId) as any;
		if (person) membersById.set(person.id, { ...person, responsibility: '任务执行人' });
	}

	const fallbackLogs = [
		...(tasks as any[])
			.filter((task) => task.completedAt)
			.map((task) => ({
				action: '完成任务节点',
				detail: task.name,
				actor: task.assigneeName ?? '系统',
				createdAt: task.completedAt
			})),
		{
			action: '创建项目',
			detail: `${(project as any).code} · ${(project as any).name}`,
			actor: (project as any).ownerName ?? '系统',
			createdAt: (project as any).createdAt
		}
	].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

	return {
		project,
		tasks,
		people,
		members: [...membersById.values()],
		auditLogs: auditLogs.length ? auditLogs : fallbackLogs
	};
}

export const load: PageServerLoad = async ({ params }) => {
	const direct = await loadProject(params.id);
	if (direct) return direct;
	const legacyIndex = Number(params.id);
	if (!Number.isInteger(legacyIndex) || legacyIndex < 1) throw error(404, '项目不存在');
	const legacy = await getDatabase().prepare(`
		SELECT id FROM projects
		ORDER BY COALESCE(planned_start_date, planned_issue_date), name
		LIMIT 1 OFFSET ?
	`).get(legacyIndex - 1) as { id: string } | undefined;
	if (!legacy) throw error(404, '项目不存在');
	const result = await loadProject(legacy.id);
	if (!result) throw error(404, '项目不存在');
	return result;
};

export const actions: Actions = {
	updateProject: async (event) => {
		const { request, params } = event;
		const projectId = await resolveProjectId(params.id);
		if (!projectId) return fail(404, { message: '项目不存在' });
		const data = await request.formData();
		const status = String(data.get('status') ?? '');
		const ownerId = String(data.get('ownerId') ?? '');
		const notes = String(data.get('notes') ?? '').trim();
		if (!PROJECT_STATUSES.has(status)) return fail(400, { message: '项目状态无效' });
		const db = getDatabase();
		if (ownerId && !await db.prepare('SELECT 1 FROM people WHERE id = ? AND active = TRUE').get(ownerId)) {
			return fail(400, { message: '负责人不存在或已停用' });
		}
		const before = await db.prepare('SELECT status, owner_id AS ownerId, notes FROM projects WHERE id = ?').get(projectId);
		if (!before) return fail(404, { message: '项目不存在' });
		let project;
		await db.transaction(async (transaction: ReturnType<typeof getDatabase>) => {
			project = await transaction.prepare(`
				UPDATE projects SET status = ?, owner_id = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
				WHERE id = ?
				RETURNING status, owner_id AS ownerId, notes, updated_at AS updatedAt
			`).get(status, ownerId || null, notes || null, projectId);
			await prepareAudit({
				db: transaction,
				...auditRequestMeta(event),
				action: 'project.update',
				entityType: 'project',
				entityId: projectId,
				summary: '更新项目状态、负责人或说明',
				before,
				after: project
			}).run();
		});
		return {
			success: true,
			message: '项目状态与负责人已更新',
			project,
			auditLog: actionAudit(event, 'project.update', '更新项目状态、负责人或说明'),
			refreshReminders:
				(before as any).status !== status ||
				((before as any).ownerId ?? null) !== (ownerId || null)
		};
	},
	updateTask: async (event) => {
		const { request, params } = event;
		const projectId = await resolveProjectId(params.id);
		if (!projectId) return fail(404, { message: '项目不存在' });
		const data = await request.formData();
		const taskId = String(data.get('taskId') ?? '');
		const status = String(data.get('status') ?? '');
		const assigneeId = String(data.get('assigneeId') ?? '');
		const dueDate = String(data.get('dueDate') ?? '');
		if (!taskId || !TASK_STATUSES.has(status)) return fail(400, { message: '任务参数无效' });
		if (dueDate && !ISO_DATE.test(dueDate)) return fail(400, { message: '截止日期格式无效' });
		const db = getDatabase();
		if (assigneeId && !await db.prepare('SELECT 1 FROM people WHERE id = ? AND active = TRUE').get(assigneeId)) {
			return fail(400, { message: '任务负责人不存在或已停用' });
		}
		const selectState = db.prepare(`
			SELECT id, name, status, assignee_id AS assigneeId, due_date AS dueDate, completed_at AS completedAt
			FROM project_tasks WHERE id = ? AND project_id = ?
		`);
		const before = await selectState.get(taskId, projectId) as any;
		if (!before) return fail(404, { message: '任务节点不存在' });
		let task;
		await db.transaction(async (transaction: ReturnType<typeof getDatabase>) => {
			task = await transaction.prepare(`
				UPDATE project_tasks
				SET status = ?, assignee_id = ?, due_date = ?,
					completed_at = CASE
						WHEN ? = 'completed' THEN COALESCE(completed_at, CURRENT_TIMESTAMP)
						ELSE NULL
					END,
					updated_at = CURRENT_TIMESTAMP
				WHERE id = ? AND project_id = ?
				RETURNING id, name, status, assignee_id AS assigneeId,
					planned_start_date AS plannedStartDate, due_date AS dueDate,
					completed_at AS completedAt, sort_order AS sortOrder, notes,
					updated_at AS updatedAt
			`).get(status, assigneeId || null, dueDate || null, status, taskId, projectId);
			await prepareAudit({
				db: transaction,
				...auditRequestMeta(event),
				action: 'project.task.update',
				entityType: 'project',
				entityId: projectId,
				summary: `更新任务节点：${before.name}`,
				before,
				after: task
			}).run();
		});
		return {
			success: true,
			message: '任务节点已更新',
			task,
			auditLog: actionAudit(event, 'project.task.update', `更新任务节点：${before.name}`),
			refreshReminders:
				before.status !== status ||
				(before.assigneeId ?? null) !== (assigneeId || null) ||
				(before.dueDate ?? null) !== (dueDate || null)
		};
	},
	updateOwnTaskStatus: async (event) => {
		const { request, params } = event;
		if (!['admin', 'handler', 'reviewer'].includes(event.locals.user?.financing?.role ?? '')) {
			return fail(403, { message: '当前角色无权更新任务节点' });
		}
		const personId = event.locals.user?.financing?.personId;
		if (!personId) return fail(401, { message: '当前账号未关联人员主档，无法更新任务节点' });
		const projectId = await resolveProjectId(params.id);
		if (!projectId) return fail(404, { message: '项目不存在' });
		const data = await request.formData();
		const taskId = String(data.get('taskId') ?? '');
		const status = String(data.get('status') ?? '');
		if (!taskId || !TASK_STATUSES.has(status)) return fail(400, { message: '任务参数无效' });

		const db = getDatabase();
		const before = await db.prepare(`
			SELECT id, name, status, assignee_id AS assigneeId, due_date AS dueDate,
				completed_at AS completedAt
			FROM project_tasks WHERE id = ? AND project_id = ?
		`).get(taskId, projectId) as any;
		if (!before) return fail(404, { message: '任务节点不存在' });
		if (before.assigneeId !== personId) return fail(403, { message: '仅可更新分配给自己的任务节点状态' });

		let task;
		await db.transaction(async (transaction: ReturnType<typeof getDatabase>) => {
			task = await transaction.prepare(`
				UPDATE project_tasks
				SET status = ?,
					completed_at = CASE
						WHEN ? = 'completed' THEN COALESCE(completed_at, CURRENT_TIMESTAMP)
						ELSE NULL
					END,
					updated_at = CURRENT_TIMESTAMP
				WHERE id = ? AND project_id = ? AND assignee_id = ?
				RETURNING id, name, status, assignee_id AS assigneeId,
					planned_start_date AS plannedStartDate, due_date AS dueDate,
					completed_at AS completedAt, sort_order AS sortOrder, notes,
					updated_at AS updatedAt
			`).get(status, status, taskId, projectId, personId);
			if (!task) return;
			await prepareAudit({
				db: transaction,
				...auditRequestMeta(event),
				action: 'project.task.status.update',
				entityType: 'project',
				entityId: projectId,
				summary: `更新本人任务节点状态：${before.name}`,
				before,
				after: task
			}).run();
		});
		if (!task) return fail(409, { message: '任务负责人已变化，请刷新页面后重试' });
		return {
			success: true,
			message: '任务节点状态已更新',
			task,
			auditLog: actionAudit(event, 'project.task.status.update', `更新本人任务节点状态：${before.name}`),
			refreshReminders: before.status !== status
		};
	},
	addTask: async (event) => {
		const { request, params } = event;
		const projectId = await resolveProjectId(params.id);
		if (!projectId) return fail(404, { message: '项目不存在' });
		const data = await request.formData();
		const name = String(data.get('name') ?? '').trim();
		const assigneeId = String(data.get('assigneeId') ?? '');
		const dueDate = String(data.get('dueDate') ?? '');
		if (!name || name.length > 120) return fail(400, { message: '请输入 1–120 个字符的任务名称' });
		if (dueDate && !ISO_DATE.test(dueDate)) return fail(400, { message: '截止日期格式无效' });
		const db = getDatabase();
		if (assigneeId && !await db.prepare('SELECT 1 FROM people WHERE id = ? AND active = TRUE').get(assigneeId)) {
			return fail(400, { message: '任务负责人不存在或已停用' });
		}
		const nextOrder = (await db.prepare(`
			SELECT COALESCE(MAX(sort_order), 0) + 1 AS nextOrder
			FROM project_tasks WHERE project_id = ?
		`).get(projectId) as { nextOrder: number }).nextOrder;
		const taskId = randomUUID();
		await db.batch([
			db.prepare(`
				INSERT INTO project_tasks (
					id, project_id, name, status, assignee_id, due_date, sort_order
				) VALUES (?, ?, ?, 'not_started', ?, ?, ?)
			`).bind(taskId, projectId, name, assigneeId || null, dueDate || null, nextOrder),
			prepareAudit({
				db,
				...auditRequestMeta(event),
				action: 'project.task.create',
				entityType: 'project',
				entityId: projectId,
				summary: `添加任务节点：${name}`,
				after: { id: taskId, name, assigneeId: assigneeId || null, dueDate: dueDate || null, sortOrder: nextOrder }
			})
		]);
		return {
			success: true,
			message: '任务节点已添加',
			task: {
				id: taskId,
				name,
				status: 'not_started',
				assigneeId: assigneeId || null,
				assigneeName: null,
				plannedStartDate: null,
				dueDate: dueDate || null,
				completedAt: null,
				sortOrder: nextOrder,
				notes: null
			},
			auditLog: actionAudit(event, 'project.task.create', `添加任务节点：${name}`),
			refreshReminders: true
		};
	}
};
