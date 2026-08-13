import assert from "node:assert/strict";
import test from "node:test";

import {
  pathnameForReportView,
  reportViewFromPathname,
} from "../src/report-route.ts";

test("报告 URL 映射到对应视图", () => {
  assert.equal(reportViewFromPathname("/dashboard"), "visual");
  assert.equal(reportViewFromPathname("/dashboard/"), "visual");
  assert.equal(reportViewFromPathname("/dashboard/text"), "text");
  assert.equal(reportViewFromPathname("/dashboard/text/"), "text");
});

test("报告视图生成稳定的无尾斜杠 URL", () => {
  assert.equal(pathnameForReportView("visual"), "/dashboard");
  assert.equal(pathnameForReportView("text"), "/dashboard/text");
});
