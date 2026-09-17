import { renderCommentaryPdf, commentaryPdfKey } from "../research-commentary-pdf.ts";
import { getTrackingCommentary } from "./tracking-commentary-repository.ts";
import { PolicyRepositoryError } from "./policy-repository.ts";
import type { CommentaryPdfArchive } from "../tracking-commentary.ts";

export async function getCommentaryPdfArchive(db: Env["DB"], id: string, version: string): Promise<CommentaryPdfArchive | null> {
  return await db.prepare(`SELECT revision_at AS revisionAt, r2_key AS key, file_name AS fileName,
    sha256, byte_size AS size, archived_at AS archivedAt FROM research_commentary_pdf WHERE commentary_id=? AND revision_at=?`)
    .bind(id,version).first<CommentaryPdfArchive>();
}
export async function archiveCommentaryPdf(env: Env, id: string, expectedVersion: string): Promise<CommentaryPdfArchive> {
  if (!env.EASTMONEY) throw new PolicyRepositoryError(503,"PDF 归档存储尚未配置");
  const commentary = await getTrackingCommentary(env.DB,id);
  if (commentary.updatedAt !== expectedVersion) throw new PolicyRepositoryError(409,"点评已更新，请重新打开后归档");
  const existing = await getCommentaryPdfArchive(env.DB,id,expectedVersion);
  if (existing) return existing;
  if (!commentary.commentary.trim()) throw new PolicyRepositoryError(422,"请先完成点评正文");
  const bytes = renderCommentaryPdf(commentary), key = commentaryPdfKey(commentary);
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),b=>b.toString(16).padStart(2,"0")).join("");
  const fileName = `${commentary.commentaryDate || "日期未注明"}-${commentary.eventName.replace(/[\\/\x00-\x1f]/g," ")}.pdf`;
  const now = new Date().toISOString();
  const object = await env.EASTMONEY.put(key, bytes, { httpMetadata:{contentType:"application/pdf",cacheControl:"private, no-store"},
    customMetadata:{commentaryId:id,revisionAt:expectedVersion,sha256} });
  if (!object) throw new PolicyRepositoryError(503,"PDF 归档失败");
  await env.DB.prepare(`INSERT INTO research_commentary_pdf(commentary_id,revision_at,r2_key,file_name,sha256,byte_size,archived_at)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(commentary_id,revision_at) DO NOTHING`).bind(id,expectedVersion,key,fileName,sha256,bytes.length,now).run();
  return (await getCommentaryPdfArchive(env.DB,id,expectedVersion))!;
}
export async function downloadCommentaryPdf(env: Env, id: string): Promise<Response> {
  if (!env.EASTMONEY) throw new PolicyRepositoryError(503,"PDF 归档存储尚未配置");
  const commentary = await getTrackingCommentary(env.DB,id);
  const archive = await getCommentaryPdfArchive(env.DB,id,commentary.updatedAt);
  if (!archive) throw new PolicyRepositoryError(404,"当前点评版本尚未归档 PDF");
  // Object keys come only from the archive table, never a user-supplied bucket path.
  if (!archive.key.startsWith("research-commentary/")) throw new PolicyRepositoryError(500,"PDF 归档路径无效");
  const object = await env.EASTMONEY.get(archive.key);
  if (!object) throw new PolicyRepositoryError(404,"PDF 归档文件不存在");
  return new Response(object.body,{headers:{"Content-Type":"application/pdf","Cache-Control":"private, no-store",
    "Content-Disposition":`attachment; filename="commentary.pdf"; filename*=UTF-8''${encodeURIComponent(archive.fileName)}`,
    "X-Content-Type-Options":"nosniff","Content-Security-Policy":"sandbox",ETag:object.httpEtag}});
}
