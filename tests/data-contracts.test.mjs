import assert from "node:assert/strict";
import test from "node:test";

import { todayTradesSchema } from "../src/data-contracts.ts";

test("今日成交缺少收益率时归一为 null，其他错型仍拒绝", () => {
  assert.deepEqual(todayTradesSchema.parse([{
    bondUniCode: "101",
    remainingTenor: "3Y",
  }]), [{
    bondUniCode: "101",
    remainingTenor: "3Y",
    tradeYield: null,
  }]);

  assert.throws(() => todayTradesSchema.parse([{
    bondUniCode: "101",
    remainingTenor: "3Y",
    tradeYield: "不是收益率",
  }]));
});
