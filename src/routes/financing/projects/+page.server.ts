import { randomUUID } from 'node:crypto';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDatabase } from '$lib/server/financing/db.js';
import { getProjectGanttData } from '$lib/server/financing/queries.js';
import { auditRequestMeta, prepareAudit } from '$lib/server/financing/audit.js';
import { deleteProjectWithReminders } from '$lib/server/financing/project-deletion.js';
import { hasPermission } from '$lib/financing/permissions.js';

const PROJECT_STATUSES = new Set(['planning', 'in_progress', 'at_risk', 'completed', 'cancelled']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dateInShanghai() {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
	}).format(new Date());
}

async function getProjectSource(projectId: string) {
	return (await getProjectGanttData({ projectId })).projects[0] ?? null;
}

function projectBookbuildingDate(data: FormData) {
	return String(data.get('plannedBookbuildingDate') ?? '').trim();
}

function offsetDate(date: string, offsetDays: number) {
	return new Date(Date.parse(`${date}T00:00:00Z`) + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

function projectStartDate(plannedBookbuildingDate: string, nodes: Array<{ offsetDays: number }>) {
	return nodes.reduce(
		(earliest, node) => [earliest, offsetDate(plannedBookbuildingDate, Number(node.offsetDays))].sort()[0] ?? earliest,
		plannedBookbuildingDate
	);
}

export const load: PageServerLoad = async ({ locals }) => {
	const today = dateInShanghai();
	const projectData = await getProjectGanttData();
	return {
		projectSources: projectData.projects,
		today,
		viewContext: {
			role: locals.financingUser?.role ?? 'reviewer',
			personId: locals.financingUser?.personId ?? null,
			personName: locals.financingUser?.personName ?? null,
			defaultOwnProjects: false
		}
	};
};

export const actions: Actions = {
	createProject: async (event) => {
		if (!hasPermission(event.locals.permissions, 'project_manage')) {
			return fail(403, { message: '当前角色无权新增项目' });
		}
		const data = await event.request.formData();
		const name = String(data.get('name') ?? '').trim();
		const sopTemplateId = String(data.get('sopTemplateId') ?? '').trim();
		const amountYi = String(data.get('amountYi') ?? '').trim();
		const ownerId = String(data.get('ownerId') ?? '').trim();
		const notes = String(data.get('notes') ?? '').trim();
		const plannedBookbuildingDate = projectBookbuildingDate(data);
		if (!name || name.length > 160) return fail(400, { message: '项目名称须为 1–160 个字符' });
		if (!sopTemplateId) return fail(400, { message: '请选择融资品种和对应 SOP' });
		if (notes.length > 4000) return fail(400, { message: '项目说明不能超过 4,000 个字符' });
		if (amountYi && (!/^\d+(?:\.\d{1,8})?$/.test(amountYi) || Number(amountYi) < 0)) {
			return fail(400, { message: '项目规模须为有效的非负亿元数值' });
		}
		if (!ISO_DATE.test(plannedBookbuildingDate)) return fail(400, { message: '请填写有效的计划簿记日期' });

		const db = getDatabase();
		if (ownerId && !await db.prepare('SELECT 1 FROM people WHERE id = ? AND active = TRUE').get(ownerId)) {
			return fail(400, { message: '负责人不存在或已停用' });
		}
		const sop = await db.prepare(`
			SELECT id, name, debt_type AS debtType
			FROM sop_templates WHERE id = ? AND is_active = TRUE
		`).get(sopTemplateId) as { id: string; name: string; debtType: string } | undefined;
		if (!sop) return fail(400, { message: '所选 SOP 不存在或已停用，请重新选择' });

		const projectId = randomUUID();
		const code = `FIN-${dateInShanghai().replaceAll('-', '')}-${projectId.slice(0, 8).toUpperCase()}`;
		const nodes = await db.prepare(`
			SELECT id, name, description, sort_order AS sortOrder, default_offset_days AS offsetDays,
				default_owner_role AS ownerRole
			FROM sop_nodes WHERE template_id = ? ORDER BY sort_order
		`).all(sop.id);
		const assignees = await db.prepare('SELECT id, role FROM people WHERE active = TRUE ORDER BY name').all();
		const assigneeByRole = new Map<string, { id: string }>();
		for (const assignee of assignees as Array<{ id: string; role: string }>) {
			if (!assigneeByRole.has(assignee.role)) assigneeByRole.set(assignee.role, assignee);
		}
		const startDate = projectStartDate(plannedBookbuildingDate, nodes as Array<{ offsetDays: number }>);
		await db.transaction(async (transaction: ReturnType<typeof getDatabase>) => {
			await transaction.prepare(`
				INSERT INTO projects (
					id, code, name, debt_type, amount, status,
					planned_start_date, planned_issue_date, sop_template_id, owner_id, notes
				) VALUES (?, ?, ?, ?, ?::numeric * 100000000, 'planning', ?, ?, ?, ?, ?)
			`).run(
				projectId, code, name, sop.debtType, amountYi || null,
				startDate, plannedBookbuildingDate, sop.id, ownerId || null, notes || null
			);
			for (const node of nodes) {
				const dueDate = offsetDate(plannedBookbuildingDate, Number(node.offsetDays));
				const assignee = assigneeByRole.get(node.ownerRole) ?? (ownerId ? { id: ownerId } : undefined);
				await transaction.prepare(`
					INSERT INTO project_tasks (
						id, project_id, sop_node_id, name, status, assignee_id,
						planned_start_date, due_date, sort_order, notes
					) VALUES (?, ?, ?, ?, 'not_started', ?, ?, ?, ?, ?)
				`).run(
					randomUUID(), projectId, node.id, node.name, assignee?.id ?? null,
					startDate, dueDate, node.sortOrder, node.description || null
				);
			}
			await prepareAudit({
				...auditRequestMeta(event),
				db: transaction,
				action: 'project.create',
				entityType: 'project',
				entityId: projectId,
				summary: `创建独立融资项目：${name}`,
				after: {
					code,
					name,
					debtType: sop.debtType,
					amountYi: amountYi || null,
					status: 'planning',
					plannedStartDate: startDate,
					plannedIssueDate: plannedBookbuildingDate,
					sopTemplateId: sop.id,
					ownerId: ownerId || null
				}
			}).run();
		});
		return {
			success: true,
			projectId,
			project: await getProjectSource(projectId),
			refreshReminders: true,
			message: '项目已创建，并已套用对应 SOP 节点。'
		};
	},

	updateProject: async (event) => {
		const data = await event.request.formData();
		const projectId = String(data.get('id') ?? '').trim();
		const name = String(data.get('name') ?? '').trim();
		const status = String(data.get('status') ?? '').trim();
		const ownerId = String(data.get('ownerId') ?? '').trim();
		const notes = String(data.get('notes') ?? '').trim();
		const plannedBookbuildingDate = projectBookbuildingDate(data);
		if (!projectId || !name || name.length > 160) return fail(400, { message: '项目名称须为 1–160 个字符' });
		if (!PROJECT_STATUSES.has(status)) return fail(400, { message: '项目状态无效' });
		if (notes.length > 4000) return fail(400, { message: '项目说明不能超过 4,000 个字符' });
		if (!ISO_DATE.test(plannedBookbuildingDate)) return fail(400, { message: '请填写有效的计划簿记日期' });

		const db = getDatabase();
		if (ownerId && !await db.prepare('SELECT 1 FROM people WHERE id = ? AND active = TRUE').get(ownerId)) {
			return fail(400, { message: '负责人不存在或已停用' });
		}
		const before = await db.prepare(`
			SELECT id, name, status, owner_id AS ownerId,
				planned_start_date AS plannedStartDate, planned_issue_date AS plannedIssueDate, notes
			FROM projects WHERE id = ?
		`).get(projectId) as any;
		if (!before) return fail(404, { message: '项目不存在' });
		await db.transaction(async (transaction: ReturnType<typeof getDatabase>) => {
			if (before.plannedIssueDate && before.plannedIssueDate !== plannedBookbuildingDate) {
				await transaction.prepare(`
					UPDATE project_tasks
					SET planned_start_date = CASE
							WHEN planned_start_date IS NULL THEN NULL
							ELSE planned_start_date + (?::date - ?::date)
						END,
						due_date = CASE
							WHEN sop_node_id IN (SELECT id FROM sop_nodes WHERE default_offset_days = 0)
								THEN ?::date
							WHEN due_date IS NULL THEN NULL
							ELSE due_date + (?::date - ?::date)
						END,
						updated_at = CURRENT_TIMESTAMP
					WHERE project_id = ? AND sop_node_id IS NOT NULL
				`).run(
					plannedBookbuildingDate, before.plannedIssueDate, plannedBookbuildingDate,
					plannedBookbuildingDate, before.plannedIssueDate, projectId
				);
			}
			const schedule = await transaction.prepare(`
				SELECT LEAST(?::date, COALESCE(MIN(due_date), ?::date)) AS startDate
				FROM project_tasks WHERE project_id = ?
			`).get(plannedBookbuildingDate, plannedBookbuildingDate, projectId) as { startDate: string };
			const after = {
				...before,
				name,
				status,
				ownerId: ownerId || null,
				plannedStartDate: schedule.startDate,
				plannedIssueDate: plannedBookbuildingDate,
				notes: notes || null
			};
			await transaction.prepare(`
				UPDATE projects
				SET name = ?, status = ?, owner_id = ?, planned_start_date = ?,
					planned_issue_date = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
				WHERE id = ?
			`).run(name, status, ownerId || null, schedule.startDate, plannedBookbuildingDate, notes || null, projectId);
			await prepareAudit({
				...auditRequestMeta(event), db: transaction,
				action: 'project.update', entityType: 'project', entityId: projectId,
				summary: `更新项目：${name}`, before, after
			}).run();
		});
		return {
			success: true,
			updatedProjectId: projectId,
			project: await getProjectSource(projectId),
			refreshReminders:
				before.name !== name || before.status !== status ||
				(before.ownerId ?? null) !== (ownerId || null) ||
				before.plannedIssueDate !== plannedBookbuildingDate,
			message: `已更新项目 ${name}`
		};
	},

	deleteProject: async (event) => {
		const data = await event.request.formData();
		const projectId = String(data.get('id') ?? '').trim();
		const db = getDatabase();
		if (!projectId) return fail(400, { message: '项目参数无效' });
		const before = await deleteProjectWithReminders(db, projectId, async ({ transaction, before: deleted }: any) => {
			await prepareAudit({
				...auditRequestMeta(event), db: transaction,
				action: 'project.delete', entityType: 'project', entityId: projectId,
				summary: `删除项目：${deleted.name}`, before: deleted
			}).run();
		});
		if (!before) {
			return {
				success: true,
				deletedProjectId: projectId,
				refreshReminders: true,
				message: '该项目已经删除，页面数据已同步'
			};
		}
		return {
			success: true,
			deletedProjectId: projectId,
			refreshReminders: true,
			message: `已删除项目 ${before.name}；项目节点和关联提醒已清理`
		};
	}
};
