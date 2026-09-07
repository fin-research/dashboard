import { error, redirect } from "@sveltejs/kit";
import { creditWorkbenchViews } from "$lib/credit-workbench/navigation";

export const ssr = false;

export function load({ params, url }: { params: { view?: string }; url: URL }) {
  if (params.view === "overview") redirect(307, "/credit-workbench" + url.search);
  const view = creditWorkbenchViews.find(candidate => candidate.id === (params.view ?? "overview"));
  if (!view) error(404, "授信工作台标签页不存在");
  return { view: view.id };
}
