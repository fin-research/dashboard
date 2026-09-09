/** The step schema has text fields only in answer paragraphs. Project those
 * strings from incomplete JSON; never stream IDs, quotes or tool decisions. */
export function creditDraftText(prefix: string): string {
  if (!/(?<!\\)"action"\s*:\s*"answer"/.test(prefix)) return "";
  const paragraphs: string[] = [];
  for (const match of prefix.matchAll(/(?<!\\)"text"\s*:\s*"((?:[^"\\]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*)/g)) {
    try { paragraphs.push(JSON.parse(`"${match[1]}"`) as string); } catch { /* Wait for a complete escape sequence. */ }
  }
  return paragraphs.join("\n\n");
}
