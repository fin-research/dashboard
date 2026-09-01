export type ResearchContentBlock =
  | { kind: "heading"; level: 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] };

export function parseResearchContent(content: string): ResearchContentBlock[] {
  return content
    .replaceAll("\r\n", "\n")
    .trim()
    .split(/\n{2,}/)
    .map((rawBlock): ResearchContentBlock | null => {
      const block = rawBlock.trim();
      if (!block) return null;

      const heading = block.match(/^(#{1,6})\s+([^\n]+)$/);
      const headingMarker = heading?.[1];
      const headingText = heading?.[2];
      if (headingMarker && headingText) {
        return {
          kind: "heading",
          level: headingMarker.length <= 2 ? 2 : 3,
          text: headingText.trim(),
        };
      }

      const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
      const ordered = lines.length > 0 && lines.every((line) => /^\d+[.、]\s*/.test(line));
      const unordered = lines.length > 0 && lines.every((line) => /^[-*]\s+/.test(line));
      if (ordered || unordered) {
        return {
          kind: "list",
          ordered,
          items: lines.map((line) => line.replace(ordered ? /^\d+[.、]\s*/ : /^[-*]\s+/, "")),
        };
      }

      return { kind: "paragraph", text: block };
    })
    .filter((block): block is ResearchContentBlock => block !== null);
}
