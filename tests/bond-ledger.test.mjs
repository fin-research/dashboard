import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBondLedgerAnalytics,
  calculateBusinessAnnualizedReturn,
  calculateBusinessAnnualizedReturnTrend,
  weekRange,
} from "../src/lib/bond-ledger/analytics.ts";
import {
  calendarDays,
  calendarDaysWithLedgerStatus,
  resolveAvailableRange,
  shiftMonth,
} from "../src/lib/bond-ledger/calendar.ts";
import {
  BondLedgerParseError,
  parseBondLedgerMatrices,
} from "../src/lib/bond-ledger/parser.ts";
import {
  archiveBondLedgerRequest,
  BondLedgerUploadError,
  workflowStatus,
} from "../src/lib/server/bond-ledger.ts";
import {
  listBondLedgerInventory,
  persistParsedBondLedger,
} from "../src/lib/server/bond-ledger-repository.ts";
import { GET as redirectLegacyBondLedger } from "../src/routes/bond-ledger/+server.ts";
import {
  readPreferences,
  savePreferences,
} from "../src/lib/preferences.ts";

const POSITION_HEADERS = [
  "报表日期",
  "团队",
  "投资经理",
  "账户",
  "债券代码",
  "交易市场",
  "债券名称",
  "债券分类",
  "收益率变动(BP)",
  "剩余期限（年）",
  "起息日",
  "到期日",
  "今日持仓量",
  "昨日持仓量",
  "当日买量",
  "当日卖量",
  "当日到期量",
  "票面利率",
  "今日估值收益率",
  "含免税报表收益率",
  "估值全价",
  "DV01",
  "全价市值",
  "票息收入",
  "免税收入",
  "资本利得",
  "当日损益",
  "全年损益",
  "全价成本",
];

test("解析标准台账前两张表并统一日期与数值", () => {
  const header = Array(47).fill(null);
  header[0] = "日期";
  header[2] = "业务本金";
  header[9] = "持仓规模";
  header[12] = "杠杆率";
  header[19] = "修正久期";
  const performance = Array(47).fill(null);
  performance[0] = "2026/08/20";
  performance[2] = 6_500_000_000;
  performance[5] = 4_500_000_000;
  performance[9] = 6_400_000_000;
  performance[12] = 0.985;
  performance[19] = 1.46;
  performance[20] = 380_000;
  performance[30] = 71_000_000;
  performance[37] = 0.0245;
  performance[43] = 0.0229;
  const cachedFuturePerformance = [...performance];
  cachedFuturePerformance[0] = "2026/08/21";
  const position = Array(29).fill(null);
  position[0] = "2026/8/20";
  position[4] = "260306.IB";
  position[5] = "银行间";
  position[6] = "26进出06";
  position[7] = "政策性银行债";
  position[8] = -0.5;
  position[9] = 2.3;
  position[11] = "2028/12/1";
  position[12] = 11_000_000;
  position[14] = 11_000_000;
  position[19] = 1.43;
  position[21] = 30_000;
  position[22] = 1_100_000_000;
  position[25] = -3400.000000000342;
  position[26] = 50_000;
  position[27] = 500_000;

  const result = parseBondLedgerMatrices(
    [header, Array(47).fill(null), performance, cachedFuturePerformance],
    [POSITION_HEADERS, position],
  );

  assert.equal(result.date, "2026-08-20");
  assert.deepEqual(result.performance.map((row) => row.date), ["2026-08-20"]);
  assert.equal(result.performance[0].marketValue, 6_400_000_000);
  assert.equal(result.positions[0].buyQuantity, 11_000_000);
  assert.equal(result.positions[0].reportYield, 1.43);
  assert.equal(result.positions[0].realizedProfit, -3400.000000000342);
});

test("拒绝缺少标准字段的台账", () => {
  assert.throws(
    () => parseBondLedgerMatrices([["日期"]], [["报表日期"]]),
    (error) =>
      error instanceof BondLedgerParseError &&
      error.message.includes("业务本金"),
  );
});

test("区间收益、类型加权收益率与成交方向统一派生", () => {
  const before = performanceRow("2026-08-14", 100, 1_000);
  const monday = performanceRow("2026-08-17", 110, 1_000);
  const tuesday = performanceRow("2026-08-18", 130, 1_000);
  const ledger17 = ledger("2026-08-17", [before, monday], [
    positionRow({ code: "BOND-1", category: "国债", marketValue: 100, reportYield: 1, buyQuantity: 2 }),
  ]);
  const ledger18 = ledger("2026-08-18", [before, monday, tuesday], [
    positionRow({ code: "BOND-1", category: "国债", marketValue: 300, reportYield: 3, sellQuantity: 3 }),
    positionRow({ code: "BOND-2", category: "债券ETF", marketValue: 200, reportYield: 0 }),
  ]);

  const result = buildBondLedgerAnalytics(
    [ledger17, ledger18],
    "2026-08-17",
    "2026-08-18",
  );

  assert.equal(result.rangeProfit, 30);
  assert.equal(result.rangeAnnualizedReturn, (30 / 1_000) * (365 / 2));
  assert.equal(result.holdingTypes[0].category, "国债");
  assert.equal(result.holdingTypes[0].weightedYield, 3);
  assert.equal(result.holdingTypes[1].weightedYield, null);
  assert.equal(result.maturityBuckets.length, 8);
  assert.equal(result.currentPositions[0].rangeProfit, 2);
  assert.deepEqual(
    result.transactions.map(({ side, faceAmount }) => ({ side, faceAmount })),
    [
      { side: "卖出", faceAmount: 300 },
      { side: "买入", faceAmount: 200 },
    ],
  );
});

test("业务收益率按交易日单日收益率算术平均乘 252 年化", () => {
  const monday = performanceRow("2026-08-17", 0, 1_000);
  monday.dailyRevenue = 0.08;
  const tuesday = performanceRow("2026-08-18", 0, 2_000);
  tuesday.dailyRevenue = 0.2511111111111111;
  const performance = [monday, tuesday];
  const expected = ((0.08 / 1_000 + 0.2511111111111111 / 2_000) / 2) * 252;

  assert.ok(
    Math.abs(calculateBusinessAnnualizedReturn(performance) - expected) < 1e-12,
  );
  assert.equal(Number((expected * 100).toFixed(2)), 2.59);
  assert.deepEqual(
    calculateBusinessAnnualizedReturnTrend(performance).map(({ value }) => value),
    [0.00008 * 252, expected],
  );
  assert.deepEqual(weekRange("2026-08-20"), {
    startDate: "2026-08-17",
    endDate: "2026-08-20",
  });
});

test("上传先写入不可变 R2 key，再启动 Workflow", async () => {
  const body = new Blob(["xlsx-bytes"], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const request = uploadRequest(body);
  await assert.rejects(
    archiveBondLedgerRequest(request.clone(), undefined, undefined),
    (error) =>
      error instanceof BondLedgerUploadError && error.status === 503,
  );

  const calls = [];
  const workflows = [];
  const bucket = {
    async put(key, value, options) {
      const bytes = await new Response(value).arrayBuffer();
      calls.push({ key, value, bytes: bytes.byteLength, options });
      return {
        key,
        size: bytes.byteLength,
        etag: "etag-test",
      };
    },
  };
  const workflow = {
    async create(options) {
      workflows.push(options);
      return { id: options.id };
    },
  };
  const productionRequest = request.clone();
  const requestBody = productionRequest.body;
  const production = await archiveBondLedgerRequest(
    productionRequest,
    bucket,
    workflow,
  );
  assert.equal(production.accepted, true);
  assert.match(production.key, /^uploads\/[0-9a-f-]{36}\.xlsx$/);
  assert.equal(calls[0].value, requestBody);
  assert.equal(calls[0].bytes, body.size);
  assert.equal(calls[0].options.customMetadata.originalName, "二级资金池台账20260820.xlsx");
  assert.equal(workflows[0].id, production.workflowId);
  assert.equal(workflows[0].params.r2Key, production.key);
  assert.equal(workflows[0].locationHint, "apac");
});

test("上传接口要求可信的请求体长度", async () => {
  const body = new Blob(["xlsx-bytes"], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  await assert.rejects(
    archiveBondLedgerRequest(
      uploadRequest(body, { "Content-Length": "" }),
      { put: async () => assert.fail("长度缺失时不应写入 R2") },
      { create: async () => assert.fail("长度缺失时不应启动 Workflow") },
    ),
    (error) =>
      error instanceof BondLedgerUploadError && error.status === 400,
  );
  await assert.rejects(
    archiveBondLedgerRequest(
      uploadRequest(body, { "Content-Length": String(body.size + 1) }),
      { put: async () => assert.fail("长度不一致时不应写入 R2") },
      { create: async () => assert.fail("长度不一致时不应启动 Workflow") },
    ),
    (error) =>
      error instanceof BondLedgerUploadError && error.status === 400,
  );
});

test("上传接口拒绝跨站请求", async () => {
  const body = new Blob(["xlsx-bytes"], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const request = uploadRequest(body, { Origin: "https://attacker.example" });
  await assert.rejects(
    archiveBondLedgerRequest(request, undefined, undefined),
    (error) =>
      error instanceof BondLedgerUploadError && error.status === 403,
  );
});

test("Workflow 启动失败时回滚本次 R2 文件", async () => {
  const body = new Blob(["xlsx-bytes"], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const calls = [];
  const bucket = {
    async put(key) {
      calls.push(["put", key]);
      return { key, size: body.size, etag: "etag-test" };
    },
    async delete(key) {
      calls.push(["delete", key]);
    },
  };
  const workflow = {
    async create() {
      calls.push(["workflow"]);
      throw new Error("workflow unavailable");
    },
  };

  await assert.rejects(
    archiveBondLedgerRequest(uploadRequest(body), bucket, workflow),
    (error) =>
      error instanceof BondLedgerUploadError &&
      error.message.includes("已回滚本次 R2 文件"),
  );
  assert.deepEqual(calls.map(([action]) => action), ["put", "workflow", "delete"]);
});

test("数据库导入先获取全局锁再获取同日报表锁", async () => {
  const queries = [];
  const client = {
    async query(text) {
      queries.push(text);
      if (text.includes("FROM bond.ledger_upload")) return { rows: [] };
      if (text.includes("max(source_report_date)")) {
        return { rows: [{ latest_source_date: null }] };
      }
      if (text.includes("FROM bond.transaction_record")) {
        return { rows: [{ count: 0 }] };
      }
      return { rows: [], rowCount: 1 };
    },
  };
  const performance = performanceRow("2026-08-20", 1, 100);

  await persistParsedBondLedger(client, {
    uploadId: "00000000-0000-4000-8000-000000000001",
    workflowInstanceId: "00000000-0000-4000-8000-000000000001",
    r2Key: "uploads/test.xlsx",
    r2Etag: "etag-test",
    originalName: "test.xlsx",
    fileSize: 100,
    expectedDate: "2026-08-20",
    uploadedAt: "2026-08-20T10:00:00.000Z",
    parsed: {
      date: "2026-08-20",
      performance: [performance],
      positions: [],
    },
  });

  assert.equal(queries[0], "BEGIN");
  assert.match(queries[1], /bond\.ledger_import/);
  assert.match(queries[2], /hashtextextended\(\$1, 0\)/);
  assert.equal(queries.at(-1), "COMMIT");
});

test("台账日状态从持仓数据库读取而不是按 R2 文件推断", async () => {
  const queries = [];
  const client = {
    async query(text) {
      queries.push(text);
      if (text.includes("FROM bond.daily_position")) {
        return {
          rows: [{ date: "2026-08-20" }, { date: "2026-08-21" }],
        };
      }
      return {
        rows: [
          {
            date: "2026-08-21",
            file_name: "二级资金池台账20260821.xlsx",
            r2_key: "uploads/example.xlsx",
            file_size: 170704,
            r2_etag: "etag",
            uploaded_at: "2026-08-24T01:54:23.034Z",
          },
        ],
      };
    },
  };

  const inventory = await listBondLedgerInventory(client);

  assert.deepEqual(inventory.databaseDates, ["2026-08-20", "2026-08-21"]);
  assert.equal(inventory.files.length, 1);
  assert.equal(inventory.availableStartDate, "2026-08-20");
  assert.equal(inventory.availableEndDate, "2026-08-21");
  assert.match(queries[0], /FROM bond\.ledger_upload/);
  assert.match(queries[1], /FROM bond\.daily_position/);
});

test("Workflow 状态统一映射为处理中、成功或失败", async () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const binding = (status) => ({
    async get() {
      return { async status() { return status; } };
    },
  });
  assert.equal(
    (await workflowStatus(binding({ status: "running" }), id)).status,
    "processing",
  );
  assert.equal(
    (await workflowStatus(binding({ status: "complete", output: { reportDate: "2026-08-20" } }), id)).status,
    "succeeded",
  );
  assert.equal(
    (await workflowStatus(binding({ status: "errored", error: { message: "bad workbook" } }), id)).error,
    "bad workbook",
  );
});

test("日期范围无台账时只回退到本周已有台账区间", () => {
  assert.deepEqual(
    resolveAvailableRange(
      ["2026-06-30", "2026-08-18", "2026-08-20"],
      "2026-09-01",
      "2026-09-04",
      "2026-08-17",
      "2026-08-23",
    ),
    {
      startDate: "2026-08-18",
      endDate: "2026-08-20",
      fellBack: true,
    },
  );
  assert.equal(
    resolveAvailableRange(
      ["2026-06-30", "2026-08-14"],
      "2026-09-01",
      "2026-09-04",
      "2026-08-17",
      "2026-08-23",
    ),
    null,
  );
  assert.equal(calendarDays("2026-08-01").length, 42);
  assert.equal(shiftMonth("2026-08-01", 1), "2026-09-01");
});

test("数据库日期首次载入后立即派生日历台账状态", () => {
  const days = calendarDaysWithLedgerStatus("2026-08-01", [
    "2026-08-20",
    "2026-08-21",
  ]);

  assert.equal(days.find((day) => day.date === "2026-08-19")?.hasLedger, false);
  assert.equal(days.find((day) => day.date === "2026-08-20")?.hasLedger, true);
  assert.equal(days.find((day) => day.date === "2026-08-21")?.hasLedger, true);
});

test("旧二级池页面地址永久跳转到 /bond", () => {
  assert.throws(redirectLegacyBondLedger, (error) => {
    assert.equal(error.status, 308);
    assert.equal(error.location, "/bond");
    return true;
  });
});

test("个性化颜色逻辑默认红涨绿跌并写入本地存储", () => {
  const values = new Map();
  const storage = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
  assert.equal(readPreferences(storage).marketColorConvention, "red-up-green-down");
  savePreferences({ marketColorConvention: "green-up-red-down" }, storage);
  assert.equal(readPreferences(storage).marketColorConvention, "green-up-red-down");
});

function performanceRow(date, cumulativeProfit, principal) {
  return {
    date,
    principal,
    timeWeightedPrincipal: principal,
    marketValue: principal,
    leverage: 1,
    modifiedDuration: 1,
    dailyRevenue: 0,
    cumulativeProfit,
    ytdAnnualizedReturn: null,
    ytdExTaxAnnualizedReturn: null,
  };
}

function positionRow(overrides = {}) {
  return {
    reportDate: "2026-08-18",
    rowNumber: 1,
    team: "资金管理部",
    investmentManager: "测试经理",
    account: "交易户",
    code: overrides.code ?? "TEST.IB",
    market: "银行间",
    name: overrides.name ?? "测试债券",
    category: overrides.category ?? "国债",
    yieldChangeBp: 0,
    remainingYears: 2,
    interestStartDate: "2025-08-18",
    maturityDate: "2028-08-18",
    currentQuantity: 1,
    previousQuantity: 1,
    buyQuantity: overrides.buyQuantity ?? 0,
    sellQuantity: overrides.sellQuantity ?? 0,
    maturityQuantity: overrides.maturityQuantity ?? 0,
    couponRate: 2,
    valuationYield: overrides.reportYield ?? 2,
    reportYield: overrides.reportYield ?? 2,
    fullPrice: 100,
    dv01: 1,
    marketValue: overrides.marketValue ?? 100,
    couponIncome: 0,
    taxExemptIncome: 0,
    realizedProfit: overrides.realizedProfit ?? null,
    dailyProfit: 1,
    ytdProfit: 2,
    fullPriceCost: 98,
  };
}

function ledger(date, performance, positions) {
  return {
    date,
    performance,
    positions: positions.map((position) => ({ ...position, reportDate: date })),
    fileName: `${date}.xlsx`,
    fileSize: 1,
    fileBlob: new Blob(["x"]),
    uploadedAt: `${date}T10:00:00Z`,
    cloudStored: false,
    cloudKey: null,
  };
}

function uploadRequest(body, extraHeaders = {}) {
  return new Request("https://eastmoney.hasbai.xyz/api/bond-ledger", {
    method: "POST",
    headers: {
      "Content-Type": body.type,
      "X-Ledger-Filename": encodeURIComponent("二级资金池台账20260820.xlsx"),
      "X-Ledger-Size": String(body.size),
      "Content-Length": String(body.size),
      ...extraHeaders,
    },
    body,
  });
}
