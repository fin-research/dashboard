import { error } from "@sveltejs/kit";

import {
  workbenchViews,
  type WorkbenchViewId,
} from "$lib/trading-research/demo-data";

export const ssr = false;

export function load({ params }: { params: { view: string } }): {
  view: WorkbenchViewId;
} {
  const view = workbenchViews.find((candidate) => candidate.id === params.view);
  if (!view || view.id === "overview") error(404, "工作台标签页不存在");
  return { view: view.id };
}
