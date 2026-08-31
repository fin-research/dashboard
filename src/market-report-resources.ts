import type { ReportData } from "./types";

type Row = Record<string, unknown>;

const FUNDING_CODES = ["DR001", "DR007", "DIBO001", "DIBO007"] as const;
const GOVERNMENT_BOND_TARGETS = [
  ["国债", "1Y"],
  ["国债", "5Y"],
  ["国债", "10Y"],
  ["国债", "超长期限"],
  ["国开", "10Y"],
] as const;
const FUTURES_CODES = ["TL9999", "T9999", "TF9999", "TS9999"] as const;
const PRIMARY_ISSUE_ORDER = ["短融", "公募短债", "小公募", "次级债", "私募债"] as const;

export interface RawMarketReportResources {
  reportDate: string;
  generatedAt: string;
  previousPrimaryDate: string;
  omo: unknown;
  dr: unknown;
  dibo: unknown;
  governmentBonds: unknown;
  futures: unknown;
  stock: unknown;
  margin: unknown;
  industry: unknown;
  primary: unknown;
  todayTrades: unknown;
  favoriteQuotes: unknown;
  bondInfos: unknown;
}

export function dayOffset(date: string, offset: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function toFloat(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^\d.\-]/g, "");
  if (!cleaned || ["-", ".", "-."].includes(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoDate(value: unknown): string | null {
  const text = String(value ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === text
    ? text
    : null;
}

function record(value: unknown, label: string): Row {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label}响应格式无效`);
  }
  return value as Row;
}

function rows(value: unknown, label: string): Row[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => record(item, label));
}

function rowsFrom(payload: unknown, key: string, label: string): Row[] {
  return rows(record(payload, label)[key], label);
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeCompanyShortName(value: unknown): string {
  const text = String(value ?? "").replace(/\s+/g, "");
  return text === "安信证券" ? "国投证券" : text;
}

function normalizePrimaryIssuerName(value: unknown): string {
  let text = String(value ?? "").replace(/\s+/g, "");
  if (!text) return "";
  if (text === "中国国际金融股份有限公司") return "中金公司";
  if (text === "中国中金财富证券有限公司") return "中金财富";
  for (const suffix of ["股份有限公司", "有限责任公司", "有限公司"]) {
    if (text.endsWith(suffix)) {
      text = text.slice(0, -suffix.length);
      break;
    }
  }
  if (text.startsWith("中国中金")) text = text.slice(2);
  return [...text].slice(0, 4).join("");
}

function primaryIssuer(row: Row): string {
  for (const key of ["comShortName", "issuerShortName", "issuerShortNameCn"]) {
    const value = normalizePrimaryIssuerName(normalizeCompanyShortName(row[key]));
    if (value) return value;
  }
  return normalizePrimaryIssuerName(row.comFullName ?? row.issuerName);
}

function isPrivatePrimary(row: Row): boolean {
  return (
    String(row.publicOffering) === "2" ||
    [row.publicOfferingText, row.offeringType, row.issueWay, row.raisingMode].some(
      (value) => value != null && String(value).includes("私募"),
    )
  );
}

function primaryTenorLeOneYear(value: unknown): boolean {
  const match = /^([0-9]+(?:\.[0-9]+)?)([YD]).*/.exec(
    String(value ?? "").trim().toUpperCase(),
  );
  if (!match?.[1] || !match[2]) return false;
  const number = Number(match[1]);
  return match[2] === "Y" ? number <= 1 : number <= 365;
}

function classifyPrimary(row: Row): string {
  const bondType = String(row.bondTypeText ?? "");
  const bondName = String(row.bondShortName ?? "");
  if (isPrivatePrimary(row)) return "私募债";
  if (bondType.includes("短期融资券")) return "短融";
  if (bondType.includes("次级债")) return "次级债";
  if (primaryTenorLeOneYear(row.issueTenor) || /S\d+$/.test(bondName)) {
    return "公募短债";
  }
  return "小公募";
}

function primaryDateKey(row: Row): string {
  return isoDate(row.bidStartDate ?? row.issueStartDate) ?? "";
}

function primaryDateText(row: Row): string {
  const date = primaryDateKey(row);
  if (date) return `${date.slice(5, 7)}/${date.slice(8, 10)}`;
  const bidding = String(row.biddingTime ?? "");
  return /^\d{2}-\d{2}/.test(bidding)
    ? bidding.slice(0, 5).replace("-", "/")
    : "--/--";
}

function isEastmoney(value: unknown): boolean {
  const text = String(value ?? "");
  return text.includes("东财") || text.includes("东方财富");
}

function isEastmoneyPrimary(row: Row): boolean {
  return [
    row.bondShortName,
    row.issuer,
    row.comShortName,
    row.issuerShortName,
    row.issuerShortNameCn,
  ].some((value) => value != null && isEastmoney(value));
}

function formatPrimaryTenor(value: unknown): string {
  const text = String(value ?? "").trim().toUpperCase();
  let match = /^([0-9]+(?:\.[0-9]+)?)D$/.exec(text);
  if (match?.[1]) return `${Number(match[1])}天`;
  match = /^([0-9]+(?:\.[0-9]+)?)Y$/.exec(text);
  if (match?.[1]) {
    const years = Number(match[1]);
    return years < 1 ? `${Math.trunc(years * 365)}天` : `${years}年`;
  }
  match = /^([0-9]+(?:\.[0-9]+)?)\+N$/.exec(text);
  return match?.[1] ? `${Number(match[1])}+N年` : text || "-";
}

function primaryTenorDays(value: unknown): number {
  const text = String(value ?? "").trim().toUpperCase();
  const match = /^([0-9]+(?:\.[0-9]+)?)([YD])/.exec(text);
  if (match?.[1] && match[2]) {
    const number = Number(match[1]);
    return match[2] === "D" ? number : number * 365;
  }
  const perpetual = /^([0-9]+(?:\.[0-9]+)?)\+N$/.exec(text);
  return perpetual?.[1]
    ? Number(perpetual[1]) * 365
    : Number.POSITIVE_INFINITY;
}

function parseTenorYears(value: unknown): number | null {
  const text = String(value ?? "").trim().toUpperCase();
  const match = /^([\d.]+)\s*([YD])/.exec(text);
  if (match?.[1] && match[2]) {
    const number = Number(match[1]);
    return match[2] === "Y" ? number : number / 365;
  }
  const perpetual = /^([\d.]+)\s*\+\s*N$/.exec(text);
  return perpetual?.[1] ? Number(perpetual[1]) : null;
}

function aggregatePrimaryIssues(primaryRows: Row[]): ReportData["primary_issues"] {
  interface Leg {
    bondName: string;
    tenor: string;
    tenorDays: number;
    coupon: number | null;
  }
  interface Group {
    issueDate: string;
    issueDateKey: string;
    issuer: string;
    category: string;
    amount: number;
    legs: Leg[];
  }
  const groups = new Map<string, Group>();
  for (const row of primaryRows) {
    if (isEastmoneyPrimary(row)) continue;
    const issueDateKey = primaryDateKey(row);
    const issuer = primaryIssuer(row);
    const amount = toFloat(row.planIssueAmount);
    if (!issueDateKey || !issuer || amount === null) continue;
    const category = classifyPrimary(row);
    const key = `${issueDateKey}\u0000${category}\u0000${issuer}`;
    const group = groups.get(key) ?? {
      issueDate: primaryDateText(row),
      issueDateKey,
      issuer,
      category,
      amount: 0,
      legs: [],
    };
    group.amount += amount;
    group.legs.push({
      bondName: String(row.bondShortName ?? "--"),
      tenor: formatPrimaryTenor(row.issueTenor),
      tenorDays: primaryTenorDays(row.issueTenor),
      coupon: toFloat(row.issueCouponRate),
    });
    groups.set(key, group);
  }
  const order = new Map(
    PRIMARY_ISSUE_ORDER.map((category, index) => [category, index]),
  );
  return [...groups.values()]
    .map((group) => {
      group.legs.sort(
        (left, right) =>
          left.tenorDays - right.tenorDays ||
          left.bondName.localeCompare(right.bondName),
      );
      const unique: Leg[] = [];
      for (const leg of group.legs) {
        const previous = unique.at(-1);
        if (
          !previous ||
          previous.tenor !== leg.tenor ||
          previous.coupon !== leg.coupon
        ) {
          unique.push(leg);
        }
      }
      return {
        issue_date: group.issueDate,
        issue_date_key: group.issueDateKey,
        issuer: group.issuer,
        category: group.category,
        amount: group.amount,
        bond_names: group.legs.map((leg) => leg.bondName),
        tenors: unique.map((leg) => leg.tenor),
        coupons: unique.map((leg) => leg.coupon),
      };
    })
    .sort(
      (left, right) =>
        right.issue_date_key.localeCompare(left.issue_date_key) ||
        (order.get(left.category as (typeof PRIMARY_ISSUE_ORDER)[number]) ??
          order.size) -
          (order.get(right.category as (typeof PRIMARY_ISSUE_ORDER)[number]) ??
            order.size) ||
        left.issuer.localeCompare(right.issuer),
    );
}

function primaryReport(
  payload: unknown,
  reportDate: string,
  previousDate: string,
): Pick<ReportData, "primary_summary" | "primary_issues"> {
  const data = record(record(payload, "一级发行").data, "一级发行");
  const primaryRows = rows(data.list, "一级发行明细").filter((row) =>
    [previousDate, reportDate].includes(primaryDateKey(row)),
  );
  const amount = (date: string) =>
    primaryRows
      .filter(
        (row) =>
          primaryDateKey(row) === date &&
          !isEastmoneyPrimary(row) &&
          parseTenorYears(row.issueTenor) !== null &&
          toFloat(row.planIssueAmount) !== null,
      )
      .reduce((sum, row) => sum + (toFloat(row.planIssueAmount) ?? 0), 0);
  const current = amount(reportDate);
  const previous = amount(previousDate);
  return {
    primary_summary: {
      current_amount: current,
      change_amount: current - previous,
    },
    primary_issues: aggregatePrimaryIssues(primaryRows),
  };
}

function quoteYields(row: Row): readonly [number | null, number | null] {
  return [
    toFloat(row.bidYield) ?? toFloat(row.bidEntryPrice),
    toFloat(row.ofrYield) ?? toFloat(row.ofrEntryPrice),
  ];
}

function isPublicSecondaryBondName(value: unknown): boolean {
  const name = String(value ?? "").trim().split(" ")[0] ?? "";
  return Boolean(name) && (name.includes("G") || !/[A-Za-z]/.test(name));
}

function normalizeSecondary(rows: Row[]): ReportData["secondary_bonds"] {
  const result: ReportData["secondary_bonds"] = [];
  for (const row of rows) {
    const bondName = String(row.bondShortName ?? "").trim().split(" ")[0] ?? "";
    const issuer = normalizeCompanyShortName(row.comShortName);
    const tenorLabel = String(row.remainingTenor ?? "");
    const tenorYears = parseTenorYears(tenorLabel);
    const tradeYield = toFloat(row.tradeYield);
    if (
      !isPublicSecondaryBondName(bondName) ||
      isEastmoney(bondName) ||
      isEastmoney(issuer) ||
      tenorYears === null ||
      tenorYears > 5 ||
      tradeYield === null
    ) {
      continue;
    }
    result.push({
      bond_id: String(row.bondUniCode ?? bondName),
      bond_name: bondName,
      issuer: issuer || [...bondName].slice(2, 4).join("") || "未知",
      tenor_label: tenorLabel,
      tenor_years: tenorYears,
      valuation: toFloat(row.cbYte),
      trade_yield: tradeYield,
    });
  }
  return result;
}

function normalizeInventory(
  inventory: Row[],
  trades: Row[],
): ReportData["inventory_bonds"] {
  const tradeYieldByCode = new Map(
    trades
      .filter((row) => row.bondUniCode != null)
      .map((row) => [String(row.bondUniCode), toFloat(row.tradeYield)]),
  );
  const result: ReportData["inventory_bonds"] = [];
  for (const row of inventory) {
    const tenorDays = toFloat(row.remainingTenorDay);
    const tenorYears =
      tenorDays === null
        ? parseTenorYears(row.remainingTenor)
        : tenorDays / 365;
    const valuation = toFloat(row.cbYield);
    if (tenorYears === null || valuation === null) continue;
    const [bidYield, ofrYield] = quoteYields(row);
    result.push({
      bond_name: String(row.bondShortName ?? "--").trim(),
      tenor_label: String(row.remainingTenor ?? ""),
      tenor_years: tenorYears,
      valuation,
      trade_yield:
        toFloat(row.tradeEntryPrice) ??
        tradeYieldByCode.get(String(row.bondUniCode)) ??
        null,
      trade_spread_bp: toFloat(row.tradeYieldSubCb),
      bid_yield: bidYield,
      ofr_yield: ofrYield,
    });
  }
  return result.sort((left, right) => left.tenor_years - right.tenor_years);
}

function fundingRates(dr: Row[], dibo: Row[]): ReportData["funding_rates"] {
  const byCode = new Map(
    [...dr, ...dibo].map((row) => [
      String(row.bondCode ?? row.bondShortName ?? ""),
      row,
    ]),
  );
  return FUNDING_CODES.flatMap((code) => {
    const row = byCode.get(code);
    return row
      ? [
          {
            code,
            rate: toFloat(row.weightedYield),
            change_bp: toFloat(row.weightedYieldUpDownValueBp),
          },
        ]
      : [];
  });
}

function governmentBonds(rows: Row[]): ReportData["government_bonds"] {
  return GOVERNMENT_BOND_TARGETS.flatMap(([category, tenor]) => {
    const row = rows
      .filter(
        (candidate) =>
          candidate.ordinateName === category && candidate.abscissaName === tenor,
      )
      .sort(
        (left, right) =>
          (toFloat(right.tradeNum) ?? 0) - (toFloat(left.tradeNum) ?? 0),
      )[0];
    return row
      ? [
          {
            category,
            tenor,
            code: String(row.bondCode ?? "--"),
            yield_rate: toFloat(row.yield),
            change_bp: toFloat(row.yieldSubYtdCloseBp),
          },
        ]
      : [];
  });
}

function futures(rows: Row[]): ReportData["futures"] {
  const byCode = new Map(rows.map((row) => [String(row.contractCode ?? ""), row]));
  return FUTURES_CODES.flatMap((code) => {
    const row = byCode.get(code);
    return row
      ? [
          {
            code,
            last_price: toFloat(row.lastPrice),
            change_pct: toFloat(row.upDownValuePct),
          },
        ]
      : [];
  });
}

function margin(rows: Row[]): ReportData["margin"] {
  const current = rows[0] ?? {};
  const previous = rows[1] ?? {};
  const yi = (value: unknown) => {
    const parsed = toFloat(value);
    return parsed === null ? null : parsed / 1e8;
  };
  const change = (left: number | null, right: number | null) =>
    left === null || right === null ? null : left - right;
  const total = yi(current.TOTAL_RZRQYE);
  const previousTotal = yi(previous.TOTAL_RZRQYE);
  const financing = yi(current.TOTAL_RZYE);
  const previousFinancing = yi(previous.TOTAL_RZYE);
  const lending = yi(current.TOTAL_RQYE);
  const previousLending = yi(previous.TOTAL_RQYE);
  return {
    data_date: isoDate(current.DIM_DATE),
    total,
    total_change: change(total, previousTotal),
    financing,
    financing_change: change(financing, previousFinancing),
    securities_lending: lending,
    securities_lending_change: change(lending, previousLending),
  };
}

function omoOperations(rows: Row[]): ReportData["omo_operations"] {
  const dates = [
    ...new Set(
      rows
        .map((row) => isoDate(row.operationDate))
        .filter((value): value is string => value !== null),
    ),
  ]
    .sort()
    .slice(-10);
  const allowed = new Set(dates);
  return rows.flatMap((row) => {
    const operationDate = isoDate(row.operationDate);
    return operationDate && allowed.has(operationDate)
      ? [
          {
            operation_date: operationDate,
            operation_name: String(row.operationName ?? ""),
            duration: String(row.duration ?? ""),
            amount_yi: toFloat(row.operationAmount),
            interest_rate: toFloat(row.interestRate),
          },
        ]
      : [];
  });
}

function attachBondInfos(rows: Row[], infos: Row[], infoFirst: boolean): Row[] {
  const byCode = new Map(infos.map((row) => [String(row.bondUniCode), row]));
  return rows.map((row) => {
    const info = byCode.get(String(row.bondUniCode)) ?? {};
    return infoFirst ? { ...info, ...row } : { ...row, ...info };
  });
}

export function bondCodesFromPayloads(
  todayTrades: unknown,
  favoriteQuotes: unknown,
): string[] {
  return [
    ...new Set(
      [
        ...rowsFrom(todayTrades, "list", "今日成交"),
        ...rowsFrom(favoriteQuotes, "list", "收藏报价"),
      ]
        .map((row) => String(row.bondUniCode ?? ""))
        .filter((code) => code && code !== "0"),
    ),
  ];
}

export function previousTradingDate(
  industryPayload: unknown,
  reportDate: string,
): string {
  const previousDate = strings(
    record(industryPayload, "行业数据").tradingDates,
  )
    .filter((date) => date < reportDate)
    .sort()
    .at(-1);
  if (!previousDate) throw new Error("Choice 未返回足够的同业发行交易日");
  return previousDate;
}

export function buildReportData(resources: RawMarketReportResources): ReportData {
  const industry = record(resources.industry, "行业数据");
  const stock = record(resources.stock, "A股收评");
  const trades = rowsFrom(resources.todayTrades, "list", "今日成交");
  const quotes = rowsFrom(resources.favoriteQuotes, "list", "收藏报价");
  const infos = rowsFrom(resources.bondInfos, "data", "债券基础信息");
  const primary = primaryReport(
    resources.primary,
    resources.reportDate,
    resources.previousPrimaryDate,
  );
  const secondary = attachBondInfos(trades, infos, false);
  const inventory = attachBondInfos(quotes, infos, true);
  return {
    report_date: resources.reportDate,
    generated_at: resources.generatedAt,
    omo_operations: omoOperations(rowsFrom(resources.omo, "data", "公开市场操作")),
    funding_rates: fundingRates(
      rowsFrom(resources.dr, "cfetsCapitalTable", "DR资金利率"),
      rowsFrom(resources.dibo, "cfetsCapitalTable", "DIBO资金利率"),
    ),
    government_bonds: governmentBonds(
      rowsFrom(resources.governmentBonds, "data", "国债行情"),
    ),
    futures: futures(
      rowsFrom(
        resources.futures,
        "futuresContractLatestTradeProtoList",
        "国债期货",
      ),
    ),
    stock_paragraphs: strings(stock.paragraphs).slice(0, 2),
    margin: margin(rowsFrom(resources.margin, "data", "两融数据")),
    equities: rows(industry.equities, "主要指数").map((row) => ({
      name: String(row.name ?? ""),
      close: toFloat(row.close) ?? Number.NaN,
      change_pct: toFloat(row.change_pct) ?? Number.NaN,
    })),
    equity_data_time: null,
    turnover_yi: toFloat(industry.turnoverYi),
    turnover_change_yi: toFloat(industry.turnoverChangeYi),
    industries: rows(industry.industries, "行业数据").map((row) => ({
      name: String(row.name ?? ""),
      change_pct: toFloat(row.change_pct) ?? Number.NaN,
      market_cap_yuan: toFloat(row.market_cap_yuan) ?? Number.NaN,
    })),
    industry_data_date: String(industry.dataDate ?? ""),
    ...primary,
    secondary_bonds: normalizeSecondary(secondary),
    inventory_bonds: normalizeInventory(inventory, secondary),
  };
}
