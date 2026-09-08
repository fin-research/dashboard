// @ts-nocheck
import { financingPersonView } from '../../identity.ts';
import { randomUUID } from 'node:crypto';
import { getDatabase } from './db.js';

const ALLOWED_ENTITY_TYPES = new Set([
	'project',
	'sop',
	'person',
	'reminder_rule',
	'auth',
	'finance_parameter',
	'debt_limit',
	'debt',
	'cashflow',
	'balance_snapshot',
	'liability_weekly_report'
]);
const SENSITIVE_KEYS = /password|secret|token|api[_-]?key|authorization|cookie/i;

function redact(value) {
	if (value === null || value === undefined) return value;
	if (Array.isArray(value)) return value.map(redact);
	if (typeof value !== 'object') return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEYS.test(key) ? '[REDACTED]' : redact(item)])
	);
}

function serialize(value) {
	return value === undefined ? null : JSON.stringify(redact(value));
}

export function auditRequestMeta(event) {
	return {
		actor: financingPersonView(event.locals.user) ?? null,
		requestIp: event.getClientAddress?.() ?? null,
		userAgent: event.request.headers.get('user-agent')
	};
}

function auditValues(options) {
	const {
		db = getDatabase(),
		actor,
		action,
		entityType,
		entityId = null,
		summary,
		before,
		after,
		requestIp = null,
		userAgent = null
	} = options;
	if (!ALLOWED_ENTITY_TYPES.has(entityType)) {
		throw new Error(`不支持的审计实体类型：${entityType}`);
	}
	if (!action?.trim() || !summary?.trim()) {
		throw new Error('审计动作和摘要不能为空');
	}

	return {
		db,
		id: randomUUID(),
		values: [
			actor?.personId ?? null,
			actor?.email ?? null,
			action.trim(),
			entityType,
			entityId,
			summary.trim(),
			serialize(before),
			serialize(after),
			requestIp,
			userAgent
		]
	};
}

export function prepareAudit(options) {
	const { db, id, values } = auditValues(options);
	return db.prepare(`
		INSERT INTO audit_logs (
			id, actor_person_id, actor_email, action, entity_type, entity_id,
			summary, before_json, after_json, request_ip, user_agent
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`).bind(id, ...values);
}

export async function recordAudit(options) {
	const { db, id, values } = auditValues(options);
	await db.prepare(`
		INSERT INTO audit_logs (
			id, actor_person_id, actor_email, action, entity_type, entity_id,
			summary, before_json, after_json, request_ip, user_agent
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`).run(id, ...values);
	return id;
}

export async function getAuditLogs({ entityType, entityId, limit = 100 } = {}) {
	const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
	const clauses = [];
	const params = {};
	if (entityType) {
		clauses.push('entity_type = @entityType');
		params.entityType = entityType;
	}
	if (entityId) {
		clauses.push('entity_id = @entityId');
		params.entityId = entityId;
	}
	const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
	return getDatabase().prepare(`
		SELECT id, actor_person_id AS actorPersonId,
			actor_email AS actorIdentifier,
			action, entity_type AS entityType, entity_id AS entityId, summary,
			before_json AS beforeJson, after_json AS afterJson,
			request_ip AS requestIp, user_agent AS userAgent, created_at AS createdAt
		FROM audit_logs
		${where}
		ORDER BY created_at DESC, id DESC
		LIMIT @limit
	`).all({ ...params, limit: safeLimit });
}
