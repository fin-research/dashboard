import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBondLedgerAnalytics,
  calculateDailyAnnualizedReturn,
  calculateYtdAnnualizedReturn,
  weekRange,
} from "../src/lib/bond-ledger/analytics.ts";
import {
  calendarDays,
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
  deleteBondLedgerFile,
  listBondLedgerFiles,
} from "../src/lib/server/bond-ledger.ts";
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
    [header, Array(47).fill(null), performance],
    [POSITION_HEADERS, position],
  );

  assert.equal(result.date, "2026-08-20");
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

test("年初至今收益率按台账既有日历年化口径复核", () => {
  const row = performanceRow("2026-08-20", 71_268_981.61771776, 1);
  row.timeWeightedPrincipal = 4_585_525_788.793101;
  assert.ok(
    Math.abs(calculateYtdAnnualizedReturn(row) - 0.024557960551832805) < 1e-12,
  );
  assert.deepEqual(weekRange("2026-08-20"), {
    startDate: "2026-08-17",
    endDate: "2026-08-20",
  });
  row.principal = 1_000;
  row.dailyRevenue = 2;
  assert.equal(calculateDailyAnnualizedReturn(row), 0.73);
});

test("上传始终写入 R2，同日报表使用固定 key 覆盖", async () => {
  const body = new Blob(["xlsx-bytes"], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const request = uploadRequest(body);
  await assert.rejects(
    archiveBondLedgerRequest(request.clone(), undefined),
    (error) =>
      error instanceof BondLedgerUploadError && error.status === 503,
  );

  const calls = [];
  const bucket = {
    async put(key, value, options) {
      const bytes = await new Response(value).arrayBuffer();
      calls.push({ key, bytes: bytes.byteLength, options });
      return {
        key,
        size: bytes.byteLength,
        etag: "etag-test",
      };
    },
  };
  const production = await archiveBondLedgerRequest(request.clone(), bucket);
  assert.equal(production.stored, true);
  assert.equal(production.key, "daily/2026-08-20.xlsx");
  assert.equal(calls[0].bytes, body.size);
  assert.equal(calls[0].options.customMetadata.ledgerDate, "2026-08-20");
});

test("上传接口拒绝跨站请求", async () => {
  const body = new Blob(["xlsx-bytes"], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const request = uploadRequest(body, { Origin: "https://attacker.example" });
  await assert.rejects(
    archiveBondLedgerRequest(request, undefined),
    (error) =>
      error instanceof BondLedgerUploadError && error.status === 403,
  );
});

test("线上台账清单按日期排序并支持删除", async () => {
  const deleted = [];
  const bucket = {
    async list() {
      return {
        truncated: false,
        objects: [
          remoteObject("2026-08-20"),
          remoteObject("2026-08-18"),
        ],
      };
    },
    async head(key) {
      return key === "daily/2026-08-18.xlsx" ? remoteObject("2026-08-18") : null;
    },
    async delete(key) {
      deleted.push(key);
    },
  };
  const inventory = await listBondLedgerFiles(bucket);
  assert.deepEqual(
    inventory.files.map((file) => file.date),
    ["2026-08-18", "2026-08-20"],
  );
  assert.equal(inventory.availableStartDate, "2026-08-18");
  assert.equal(inventory.availableEndDate, "2026-08-20");
  await deleteBondLedgerFile(
    new Request("https://eastmoney.hasbai.xyz/api/bond-ledger?date=2026-08-18", {
      method: "DELETE",
    }),
    bucket,
    "2026-08-18",
  );
  assert.deepEqual(deleted, ["daily/2026-08-18.xlsx"]);
});

test("日期范围无台账时回退到线上实际区间", () => {
  assert.deepEqual(
    resolveAvailableRange(
      ["2026-08-18", "2026-08-20"],
      "2026-08-24",
      "2026-08-28",
    ),
    {
      startDate: "2026-08-18",
      endDate: "2026-08-20",
      fellBack: true,
    },
  );
  assert.equal(calendarDays("2026-08-01").length, 42);
  assert.equal(shiftMonth("2026-08-01", 1), "2026-09-01");
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
    code: overrides.code ?? "TEST.IB",
    market: "银行间",
    name: overrides.name ?? "测试债券",
    category: overrides.category ?? "国债",
    yieldChangeBp: 0,
    remainingYears: 2,
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
    realizedProfit: overrides.realizedProfit ?? null,
    dailyProfit: 1,
    ytdProfit: 2,
    fullPriceCost: 98,
  };
}

function remoteObject(date) {
  return {
    key: `daily/${date}.xlsx`,
    size: 1024,
    etag: `etag-${date}`,
    uploaded: new Date(`${date}T10:00:00Z`),
    customMetadata: {
      ledgerDate: date,
      originalName: `${date}.xlsx`,
      uploadedAt: `${date}T10:00:00Z`,
    },
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
      "X-Ledger-Date": "2026-08-20",
      "X-Ledger-Filename": encodeURIComponent("二级资金池台账20260820.xlsx"),
      "X-Ledger-Size": String(body.size),
      ...extraHeaders,
    },
    body,
  });
}
