export type FocusFormatCommand =
  | "bold"
  | "italic"
  | "underline"
  | "emphasis";

interface FocusShortcut {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export function focusFormatCommand(
  shortcut: FocusShortcut,
): FocusFormatCommand | null {
  if (!shortcut.ctrlKey && !shortcut.metaKey) return null;
  const key = shortcut.key.toLowerCase();
  if (key === "b" && !shortcut.shiftKey) return "bold";
  if (key === "i" && !shortcut.shiftKey) return "italic";
  if (key === "u" && !shortcut.shiftKey) return "underline";
  if (key === "h" && shortcut.shiftKey) return "emphasis";
  return null;
}

export function normalizeFocusText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function plainTextToFocusHtml(value: string): string {
  return escapeHtml(normalizeFocusText(value)).replace(/\n/g, "<br>");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
