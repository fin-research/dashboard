import assert from "node:assert/strict";
import test from "node:test";

import { currentReportDate } from "../src/report-date.ts";

test("报告默认日期按上海时区取页面打开时的当天", () => {
  assert.equal(
    currentReportDate(new Date("2026-08-17T16:30:00.000Z")),
    "2026-08-18",
  );
});
