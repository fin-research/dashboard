import type { z } from "zod";
import type { createTrackingSchema, TrackingDraft, TrackingCommentary, TrackingRevision, CommentaryEvidence } from "../tracking-commentary.ts";
import { PolicyRepositoryError } from "./policy-repository.ts";

interface TrackingRow {
  id: string; policy_id: string | null; commentary_type: TrackingCommentary["type"];
  event_name: string; sources: string; event_published_at: string; commentary_date: string;
  event_summary: string; commentary: string; recommendation: string;
  model: string | null; prompt_version: string | null; generated_at: string | null;
  edited: number; updated_at: string; origin: TrackingCommentary["origin"] | null;
  original_text: string | null; source_files_json: string | null; evidence_json: string | null; search_json: string | null;
}
const select = `SELECT rc.*, w.origin, w.original_text, w.source_files_json, w.evidence_json, w.search_json
 FROM research_commentary rc LEFT JOIN tracking_commentary_workspace w ON w.commentary_id = rc.id`;
function fromRow(row: TrackingRow): TrackingCommentary {
  return {
    id: row.id, policyId: row.policy_id, type: row.commentary_type, eventName: row.event_name,
    sources: row.sources, eventPublishedAt: row.event_published_at, commentaryDate: row.commentary_date,
    eventSummary: row.event_summary, commentary: row.commentary, recommendation: row.recommendation,
    model: row.model, promptVersion: row.prompt_version, generatedAt: row.generated_at,
    edited: row.edited === 1, updatedAt: row.updated_at, origin: row.origin ?? "legacy",
    originalText: row.original_text ?? "", sourceFiles: JSON.parse(row.source_files_json ?? "[]"),
    evidence: JSON.parse(row.evidence_json ?? "[]"), search: row.search_json ? JSON.parse(row.search_json) : null,
  };
}
export async function getTrackingCommentary(db: Env["DB"], id: string): Promise<TrackingCommentary> {
  const row = await db.prepare(`${select} WHERE rc.id = ?`).bind(id).first<TrackingRow>();
  if (!row) throw new PolicyRepositoryError(404, "跟踪点评不存在");
  return fromRow(row);
}
export async function listTrackingCommentaries(db: Env["DB"], filters: { q?: string; type?: string; offset?: number; policyId?: string }) {
  const conditions: string[] = []; const values: (string | number)[] = [];
  if (filters.q) { conditions.push("(rc.event_name LIKE ? ESCAPE '\\' OR rc.event_summary LIKE ? ESCAPE '\\')"); const q = `%${filters.q.replace(/[\\%_]/g, c => `\\${c}`)}%`; values.push(q, q); }
  if (filters.type) { conditions.push("rc.commentary_type = ?"); values.push(filters.type); }
  if (filters.policyId) { conditions.push("rc.policy_id = ?"); values.push(filters.policyId); }
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const result = await db.prepare(`SELECT rc.id, rc.event_name AS eventName, rc.commentary_type AS type,
    rc.commentary_date AS commentaryDate, rc.edited, rc.generated_at AS generatedAt,
    COALESCE(w.origin,'legacy') AS origin FROM research_commentary rc
    LEFT JOIN tracking_commentary_workspace w ON w.commentary_id=rc.id ${where}
    ORDER BY rc.commentary_date DESC, rc.id DESC LIMIT 51 OFFSET ?`).bind(...values, filters.offset ?? 0).all();
  const policy = filters.policyId ? await db.prepare("SELECT id,title,summary,departments_json,policy_date FROM policy_event WHERE id=?").bind(filters.policyId).first<{id:string;title:string;summary:string;departments_json:string;policy_date:string}>() : null;
  return { items: result.results.slice(0, 50), hasMore: result.results.length > 50,
    policy: policy ? { id: policy.id, title: policy.title, summary: policy.summary, departments: JSON.parse(policy.departments_json) as string[], policyDate: policy.policy_date } : null };

}
export async function createTrackingCommentary(db: Env["DB"], input: z.infer<typeof createTrackingSchema>) {
  if (input.policyId) {
    const policy = await db.prepare("SELECT id FROM policy_event WHERE id = ?").bind(input.policyId).first();
    if (!policy) throw new PolicyRepositoryError(404, "关联政策不存在");
    const existing = await db.prepare("SELECT id FROM research_commentary WHERE policy_id = ?").bind(input.policyId).first<{ id: string }>();
    if (existing) return await getTrackingCommentary(db, existing.id);
  }
  const id = crypto.randomUUID(), now = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT INTO research_commentary (id,policy_id,commentary_type,event_name,sources,event_published_at,
      commentary_date,event_summary,commentary,recommendation,edited,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?) ON CONFLICT(policy_id) DO NOTHING`).bind(id, input.policyId, input.type,
      input.eventName, input.sources, input.eventPublishedAt, input.commentaryDate, input.eventSummary, input.commentary, input.recommendation, now, now),
    db.prepare(`INSERT INTO tracking_commentary_workspace(commentary_id,origin)
      SELECT id,'manual' FROM research_commentary WHERE id=?`).bind(id),
  ]);
  if (input.policyId) {
    const row = await db.prepare("SELECT id FROM research_commentary WHERE policy_id = ?").bind(input.policyId).first<{ id: string }>();
    if (row) return await getTrackingCommentary(db, row.id);
  }
  return await getTrackingCommentary(db, id);
}
export async function updateTrackingCommentary(db: Env["DB"], id: string, input: TrackingDraft, expected: string,
  generation?: { model: string; promptVersion: string; evidence: CommentaryEvidence[]; search: NonNullable<TrackingCommentary["search"]> }) {
  const current = await getTrackingCommentary(db, id);
  if (current.updatedAt !== expected) throw new PolicyRepositoryError(409, "点评已更新，请重新打开后编辑");
  const now = new Date(Math.max(Date.now(), Date.parse(expected) + 1)).toISOString();
  const update = db.prepare(`UPDATE research_commentary SET event_name=?,commentary_type=?,sources=?,event_published_at=?,
    commentary_date=?,event_summary=?,commentary=?,recommendation=?,model=?,prompt_version=?,generated_at=?,edited=?,updated_at=?
    WHERE id=? AND updated_at=?`).bind(input.eventName, current.policyId ? "policy_tracking" : input.type,
    input.sources, input.eventPublishedAt, input.commentaryDate, input.eventSummary, input.commentary, input.recommendation,
    generation?.model ?? current.model, generation?.promptVersion ?? current.promptVersion,
    generation ? now : current.generatedAt, generation ? 0 : 1, now, id, expected);
  const statements = [update];
  if (generation) statements.push(db.prepare(`INSERT INTO tracking_commentary_workspace(commentary_id,origin,evidence_json,search_json)
    SELECT id,'ai',?,? FROM research_commentary WHERE id=? AND updated_at=? AND changes()>0
    ON CONFLICT(commentary_id) DO UPDATE SET origin='ai',evidence_json=excluded.evidence_json,search_json=excluded.search_json`)
    .bind(JSON.stringify(generation.evidence), JSON.stringify(generation.search), id, now));
  const results = await db.batch(statements);
  if (!results[0]?.meta.changes) throw new PolicyRepositoryError(409, "点评已更新，本次内容未覆盖，请重新打开");
  return await getTrackingCommentary(db, id);
}
export async function trackingRevisions(db: Env["DB"], id: string): Promise<TrackingRevision[]> {
  const current = await getTrackingCommentary(db, id);
  const previous = await db.prepare(`SELECT saved_at, content_json FROM tracking_commentary_revision
    WHERE commentary_id=? ORDER BY saved_at DESC LIMIT 50`).bind(id).all<{ saved_at: string; content_json: string }>();
  return [{ savedAt: current.updatedAt, content: current }, ...previous.results.map((row: { saved_at: string; content_json: string }) => ({ savedAt: row.saved_at, content: JSON.parse(row.content_json) as TrackingCommentary }))];
}
