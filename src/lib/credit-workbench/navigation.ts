import type { WorkbenchIconName } from "../trading-research/demo-data.ts";

export type CreditWorkbenchViewId = "overview" | "calendar" | "weekly" | "assistant";
export const creditWorkbenchViews: Array<{ id: CreditWorkbenchViewId; label: string; icon: WorkbenchIconName; href: string }> = [
  { id: "overview", label: "授信一览表", icon: "credit", href: "/credit-workbench" },
  { id: "calendar", label: "授信日历", icon: "calendar", href: "/credit-workbench/calendar" },
  { id: "weekly", label: "授信周报", icon: "file", href: "/credit-workbench/weekly" },
  { id: "assistant", label: "授信助手", icon: "chat", href: "/credit-workbench/assistant" },
];
