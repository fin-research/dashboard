import assert from "node:assert/strict";
import test from "node:test";

import { formatOmoNetAmount } from "../src/formatters.ts";

test("OMO 汇总以正负号表示净投放和净回笼", () => {
  assert.equal(formatOmoNetAmount(20), "+20 亿");
  assert.equal(formatOmoNetAmount(-80), "−80 亿");
  assert.equal(formatOmoNetAmount(0), "0 亿");
});
