import assert from "node:assert/strict";
import test from "node:test";

import {
  currentReportDate,
  shouldWarnUnfinalizedReport,
} from "../src/report-date.ts";

test("报告默认日期按上海时区取页面打开时的当天", () => {
  assert.equal(
    currentReportDate(new Date("2026-08-17T16:30:00.000Z")),
    "2026-08-18",
  );
});

test("只有历史日期无定稿时提示 warning", () => {
  assert.equal(
    shouldWarnUnfinalizedReport("2026-08-17", null, "2026-08-18"),
    true,
  );
  assert.equal(
    shouldWarnUnfinalizedReport("2026-08-18", null, "2026-08-18"),
    false,
  );
  assert.equal(
    shouldWarnUnfinalizedReport(
      "2026-08-17",
      "2026-08-17T16:00:00+08:00",
      "2026-08-18",
    ),
    false,
  );
});
