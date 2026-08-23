import type {
  LedgerPerformanceRow,
  LedgerPositionRow,
  ParsedBondLedger,
} from "./types";

const PERFORMANCE_COLUMNS = {
  date: 0,
  principal: 2,
  timeWeightedPrincipal: 5,
  marketValue: 9,
  leverage: 12,
  modifiedDuration: 19,
  dailyRevenue: 20,
  cumulativeProfit: 30,
  ytdAnnualizedReturn: 37,
  ytdExTaxAnnualizedReturn: 43,
} as const;

const REQUIRED_POSITION_HEADERS = [
  "报表日期",
  "债券代码",
  "交易市场",
  "债券名称",
  "债券分类",
  "收益率变动(BP)",
  "剩余期限（年）",
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
  "当日损益",
  "全年损益",
  "全价成本",
] as const;

type Matrix = unknown[][];

export class BondLedgerParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BondLedgerParseError";
  }
}

export async function parseBondLedgerFile(file: File): Promise<ParsedBondLedger> {
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    throw new BondLedgerParseError("仅支持 .xlsx 标准台账");
  }
  const { read, utils } = await import("xlsx");
  return parseBondLedgerWorkbook(read(await file.arrayBuffer(), {
    cellDates: true,
    cellFormula: false,
    sheets: [0, 1],
  }), utils);
}

export async function parseBondLedgerBuffer(
  buffer: ArrayBuffer,
): Promise<ParsedBondLedger> {
  const { read, utils } = await import("xlsx");
  return parseBondLedgerWorkbook(read(buffer, {
    cellDates: true,
    cellFormula: false,
    sheets: [0, 1],
  }), utils);
}

function parseBondLedgerWorkbook(
  workbook: import("xlsx").WorkBook,
  utils: typeof import("xlsx").utils,
): ParsedBondLedger {
  if (workbook.SheetNames.length < 2) {
    throw new BondLedgerParseError("台账至少需要前两张工作表");
  }
  const performanceSheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
  const positionSheet = workbook.Sheets[workbook.SheetNames[1] ?? ""];
  if (!performanceSheet || !positionSheet) {
    throw new BondLedgerParseError("无法读取台账前两张工作表");
  }
  const matrixOptions = { header: 1 as const, raw: true, defval: null };
  return parseBondLedgerMatrices(
    utils.sheet_to_json(performanceSheet, matrixOptions) as Matrix,
    utils.sheet_to_json(positionSheet, matrixOptions) as Matrix,
  );
}

export function parseBondLedgerMatrices(
  performanceMatrix: Matrix,
  positionMatrix: Matrix,
): ParsedBondLedger {
  validatePerformanceHeader(performanceMatrix);
  const performance = parsePerformanceRows(performanceMatrix.slice(2));
  const positions = parsePositionRows(positionMatrix);
  if (!performance.length) {
    throw new BondLedgerParseError("第一张表没有可用的逐日收益数据");
  }
  if (!positions.length) {
    throw new BondLedgerParseError("第二张表没有可用的当日持仓数据");
  }
  const dates = new Set(positions.map((row) => row.reportDate));
  if (dates.size !== 1) {
    throw new BondLedgerParseError("第二张表必须只包含一个报表日期");
  }
  const date = positions[0]?.reportDate ?? "";
  if (!performance.some((row) => row.date === date)) {
    throw new BondLedgerParseError("两张表的报表日期不一致");
  }
  return {
    date,
    performance: performance.filter((row) => row.date <= date),
    positions,
  };
}

function validatePerformanceHeader(matrix: Matrix): void {
  const first = matrix[0] ?? [];
  const checks: Array<[number, string]> = [
    [PERFORMANCE_COLUMNS.date, "日期"],
    [PERFORMANCE_COLUMNS.principal, "业务本金"],
    [PERFORMANCE_COLUMNS.marketValue, "持仓规模"],
    [PERFORMANCE_COLUMNS.leverage, "杠杆率"],
    [PERFORMANCE_COLUMNS.modifiedDuration, "修正久期"],
  ];
  for (const [index, expected] of checks) {
    if (!normalizeHeader(first[index]).includes(normalizeHeader(expected))) {
      throw new BondLedgerParseError(`第一张表缺少标准列“${expected}”`);
    }
  }
}

function parsePerformanceRows(rows: Matrix): LedgerPerformanceRow[] {
  const parsed: LedgerPerformanceRow[] = [];
  for (const row of rows) {
    const date = toIsoDate(row[PERFORMANCE_COLUMNS.date]);
    if (!date) continue;
    const principal = toNumber(row[PERFORMANCE_COLUMNS.principal]);
    const marketValue = toNumber(row[PERFORMANCE_COLUMNS.marketValue]);
    if (principal === null || marketValue === null) continue;
    parsed.push({
      date,
      principal,
      timeWeightedPrincipal:
        toNumber(row[PERFORMANCE_COLUMNS.timeWeightedPrincipal]) ?? principal,
      marketValue,
      leverage: toNumber(row[PERFORMANCE_COLUMNS.leverage]) ?? 0,
      modifiedDuration:
        toNumber(row[PERFORMANCE_COLUMNS.modifiedDuration]) ?? 0,
      dailyRevenue: toNumber(row[PERFORMANCE_COLUMNS.dailyRevenue]) ?? 0,
      cumulativeProfit:
        toNumber(row[PERFORMANCE_COLUMNS.cumulativeProfit]) ?? 0,
      ytdAnnualizedReturn: toNumber(
        row[PERFORMANCE_COLUMNS.ytdAnnualizedReturn],
      ),
      ytdExTaxAnnualizedReturn: toNumber(
        row[PERFORMANCE_COLUMNS.ytdExTaxAnnualizedReturn],
      ),
    });
  }
  return parsed.sort((left, right) => left.date.localeCompare(right.date));
}

function parsePositionRows(matrix: Matrix): LedgerPositionRow[] {
  const headers = matrix[0] ?? [];
  const columns = new Map<string, number>();
  headers.forEach((header, index) => columns.set(normalizeHeader(header), index));
  for (const expected of REQUIRED_POSITION_HEADERS) {
    if (!columns.has(normalizeHeader(expected))) {
      throw new BondLedgerParseError(`第二张表缺少标准列“${expected}”`);
    }
  }
  const column = (name: (typeof REQUIRED_POSITION_HEADERS)[number]) =>
    columns.get(normalizeHeader(name)) as number;
  const optionalColumn = (name: string) => columns.get(normalizeHeader(name));
  const realizedProfitColumn = optionalColumn("资本利得");
  const result: LedgerPositionRow[] = [];
  for (const [index, row] of matrix.slice(1).entries()) {
    const reportDate = toIsoDate(row[column("报表日期")]);
    const code = toText(row[column("债券代码")]);
    const name = toText(row[column("债券名称")]);
    if (!reportDate || (!code && !name)) continue;
    result.push({
      reportDate,
      rowNumber: index + 1,
      team: toText(row[optionalColumn("团队") ?? -1]),
      investmentManager: toText(row[optionalColumn("投资经理") ?? -1]),
      account: toText(row[optionalColumn("账户") ?? -1]),
      code,
      market: toText(row[column("交易市场")]),
      name,
      category: toText(row[column("债券分类")]) || "未分类",
      yieldChangeBp: toNumber(row[column("收益率变动(BP)")]),
      remainingYears: toNumber(row[column("剩余期限（年）")]),
      interestStartDate: toIsoDate(row[optionalColumn("起息日") ?? -1]),
      maturityDate: toIsoDate(row[column("到期日")]),
      currentQuantity: toNumber(row[column("今日持仓量")]) ?? 0,
      previousQuantity: toNumber(row[column("昨日持仓量")]) ?? 0,
      buyQuantity: toNumber(row[column("当日买量")]) ?? 0,
      sellQuantity: toNumber(row[column("当日卖量")]) ?? 0,
      maturityQuantity: toNumber(row[column("当日到期量")]) ?? 0,
      couponRate: toNumber(row[column("票面利率")]),
      valuationYield: toNumber(row[column("今日估值收益率")]),
      reportYield: toNumber(row[column("含免税报表收益率")]),
      fullPrice: toNumber(row[column("估值全价")]),
      dv01: toNumber(row[column("DV01")]) ?? 0,
      marketValue: toNumber(row[column("全价市值")]) ?? 0,
      couponIncome: toNumber(row[optionalColumn("票息收入") ?? -1]) ?? 0,
      taxExemptIncome: toNumber(row[optionalColumn("免税收入") ?? -1]) ?? 0,
      realizedProfit:
        realizedProfitColumn === undefined
          ? null
          : toNumber(row[realizedProfitColumn]),
      dailyProfit: toNumber(row[column("当日损益")]) ?? 0,
      ytdProfit: toNumber(row[column("全年损益")]) ?? 0,
      fullPriceCost: toNumber(row[column("全价成本")]) ?? 0,
    });
  }
  return result;
}

function normalizeHeader(value: unknown): string {
  return toText(value)
    .replaceAll("\n", "")
    .replaceAll(" ", "")
    .replaceAll("（", "(")
    .replaceAll("）", ")")
    .toUpperCase();
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replaceAll(",", "").replaceAll("%", "").trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIsoDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return [value.getFullYear(), value.getMonth() + 1, value.getDate()]
      .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0"))
      .join("-");
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    epoch.setUTCDate(epoch.getUTCDate() + Math.floor(value));
    return epoch.toISOString().slice(0, 10);
  }
  const text = toText(value);
  if (!text || text === "0") return null;
  const match = text.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (!match) return null;
  const iso = `${match[1]}-${match[2]?.padStart(2, "0")}-${match[3]?.padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(parsed.valueOf()) || !parsed.toISOString().startsWith(iso)
    ? null
    : iso;
}
