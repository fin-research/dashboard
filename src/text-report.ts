import { number } from "./rows.ts";
import {
  formatPrimaryAmount,
  formatPrimaryCoupons,
} from "./primary-issues.ts";
import type {
  FundingRate,
  GovernmentBond,
  InventoryPoint,
  MarginSnapshot,
  OmoOperation,
  PrimaryIssueDetail,
  ReportData,
  SecondaryBond,
} from "./types";

const FUTURES = [
  ["TL9999", "30年期主力合约", true],
  ["T9999", "10年期主力合约", false],
  ["TF9999", "5年期主力合约", false],
  ["TS9999", "2年期主力合约", false],
] as const;

export function buildTextReport(data: ReportData, focusText = ""): string {
  return `${data.report_date.replaceAll("-", "")} 境内市场点评

【央行】
${briefOmo(data.omo_operations, data.report_date)}

【利率】
${bondMarket(data)}

【股市】
${stockMarket(data.stock_paragraphs)}

${marginTrading(data.margin)}

【一级发行】
可比证券公司发行情况:${" "}
${primaryIssue(data.primary_issues)}

【二级行情】
可比证券公司债券成交：(公募债)
${secondaryMarket(data.secondary_bonds)}

东财存量债券:${" "}
${emBonds(data.inventory_bonds)}

【今日聚焦】
${focusText}
`;
}

export function briefOmo(rows: OmoOperation[], reportDate: string): string {
  const dayRows = rows.filter(
    (row) => row.operation_date === reportDate,
  );
  const inject = dayRows
    .filter((row) => (row.amount_yi ?? 0) > 0)
    .sort((left, right) => left.amount_yi! - right.amount_yi!);
  const drain = dayRows
    .filter((row) => (row.amount_yi ?? 0) < 0)
    .sort((left, right) => right.amount_yi! - left.amount_yi!);
  let text = "中国央行今日开展";
  inject.forEach((row, index) => {
    if (index === 1) text += "，并开展";
    else if (index > 1) text += "、";
    text += `${row.duration.replaceAll("D", "天").replaceAll("M", "月").replaceAll("Y", "年")}期${row.operation_name}${compact(Math.abs(row.amount_yi!))}亿元`;
    const interest = row.interest_rate;
    if (interest !== null) text += `，操作利率为${fixed(interest, 2)}%`;
  });
  text += `；今日${drain.length ? "有" : "无逆回购到期"}`;
  drain.forEach((row, index) => {
    if (index > 0) text += "、";
    text += `${row.duration.replaceAll("D", "天").replaceAll("M", "月").replaceAll("Y", "年")}期${row.operation_name}${compact(Math.abs(row.amount_yi!))}亿元`;
  });
  const net = dayRows.reduce((sum, row) => sum + (row.amount_yi ?? 0), 0);
  if (net > 0) text += `；净投放${compact(net)}亿元。`;
  else if (net < 0) text += `；净回笼${compact(Math.abs(net))}亿元。`;
  else text += "；净投放为零。";
  return text;
}

function bondMarket(data: ReportData): string {
  return [capitalBrief(data.funding_rates), bondBrief(data.government_bonds), futuresBrief(data.futures)].join("\n\n");
}

function capitalBrief(rows: FundingRate[]): string {
  const funds = ["DR001", "DR007", "DIBO001", "DIBO007"].map((code) => rows.find((row) => row.code === code) ?? { code, rate: null, change_bp: null });
  const summary = directionSummary(funds.map((row) => row.change_bp ?? 0), "上行", "下行");
  return `今日银行间隔夜和7天期利率${summary}。\n截至17:00，${fundText(funds[0]!)}；${fundText(funds[1]!)}。\n同业拆借${fundText(funds[2]!)}；${fundText(funds[3]!)}。`;
}

function fundText(row: FundingRate): string {
  return `${row.code}报${formatNumber(row.rate, 4)}%，${formatChange(row.change_bp, "涨", "跌", "与前日持平", "bp")}`;
}

function bondBrief(rows: GovernmentBond[]): string {
  const find = (category: string, tenor: string) => rows.find((row) => row.category === category && row.tenor === tenor);
  const items: Record<string, GovernmentBond | undefined> = {
    gov30: find("国债", "超长期限"), gov10: find("国债", "10Y"),
    gov5: find("国债", "5Y"), gov1: find("国债", "1Y"),
    cdb10: find("国开", "10Y"),
  };
  const govLines = [["30年期国债", items.gov30], ["10年期国债", items.gov10], ["5年期国债", items.gov5], ["1年期国债", items.gov1]]
    .flatMap(([label, row]) => row ? [bondText(label as string, row as GovernmentBond)] : []);
  const cdbLine = items.cdb10 ? bondText("10年期国开债", items.cdb10) : "";
  if (!govLines.length && !cdbLine) return "今日利率债成交数据暂缺。";
  const parts = [`国债收益率${curveSummary(items)}。`];
  parts.push(govLines.length ? `截至17:00，${govLines.join("，")}。` : "截至17:00，国债成交数据暂缺。");
  parts.push(cdbLine ? `${cdbLine}。` : "10年期国开债成交数据暂缺。");
  return parts.join("\n");
}

function bondText(label: string, row: GovernmentBond): string {
  return `${label}${row.code || "--"}收益率${formatChange(row.change_bp, "上行", "下行", "持平", "bp")}报${formatNumber(row.yield_rate, 4)}%`;
}

function curveSummary(items: Record<string, GovernmentBond | undefined>): string {
  const order = ["gov30", "gov10", "gov5", "gov1"];
  const signs = new Map(order.filter((key) => items[key]).map((key) => [key, sign(items[key]!.change_bp ?? 0)]));
  const values = [...signs.values()];
  if (!values.length) return "成交数据暂缺";
  if (values.every((value) => value >= 0)) return "全面上行";
  if (values.every((value) => value <= 0)) return "全面下行";
  const patterns: [string, string[], string, string[]][] = [
    ["长短端", ["gov30", "gov10", "gov1"], "中端", ["gov5"]],
    ["中长端", ["gov30", "gov10", "gov5"], "短端", ["gov1"]],
    ["长端", ["gov30", "gov10"], "中短端", ["gov5", "gov1"]],
  ];
  for (const [labelA, keysA, labelB, keysB] of patterns) {
    if (![...signs.keys()].every((key) => keysA.includes(key) || keysB.includes(key))) continue;
    const a = groupDirection(signs, keysA); const b = groupDirection(signs, keysB);
    if ([a, b].every((value) => value === "上行" || value === "下行") && a !== b) return `${curvePart(labelA, a)}，${curvePart(labelB, b)}`;
  }
  const parts: string[] = [];
  const long = groupDirection(signs, ["gov30", "gov10"]);
  const midShort = groupDirection(signs, ["gov5", "gov1"]);
  if (long) parts.push(curvePart("长端", long));
  if (midShort === "上行" || midShort === "下行") parts.push(curvePart("中短端", midShort));
  else for (const [key, label] of [["gov5", "中端"], ["gov1", "短端"]] as const) { const value = groupDirection(signs, [key]); if (value) parts.push(curvePart(label, value)); }
  return parts.join("，") || "涨跌不一";
}

function futuresBrief(rows: ReportData["futures"]): string {
  const selected = FUTURES.flatMap(([code, label, includePrice]) => {
    const row = rows.find((item) => item.code === code);
    return row ? [{ row, label, includePrice }] : [];
  });
  if (!selected.length) return "国债期货成交数据暂缺。";
  const values = selected.map(({ row }) => row.change_pct ?? 0);
  const summary = directionSummary(values, "上涨", "下跌");
  const lines = selected.map(({ row, label, includePrice }) => `${label}${formatChange(row.change_pct, "涨", "跌", "持平", "%")}${includePrice ? `报${formatNumber(row.last_price, 4)}` : ""}`);
  return `国债期货${summary}，${lines.join("，")}。`;
}

function stockMarket(paragraphs: string[]): string {
  return paragraphs.length ? paragraphs.slice(0, 2).join("").trim() : "未找到今日收盘行情";
}

function marginTrading(snapshot: MarginSnapshot): string {
  if (!snapshot.data_date || snapshot.total === null) return "融资融券数据暂缺。";
  const change = (value: number | null) => value === null ? "数据暂缺" : `${value >= 0 ? "增加" : "减少"}${fixed(Math.abs(value), 2)}亿元`;
  const date = new Date(`${snapshot.data_date}T00:00:00`);
  return `截至${date.getMonth() + 1}月${date.getDate()}日，沪深京三市融资融券余额合计${fixed(snapshot.total, 2)}亿元，较前一交易日${change(snapshot.total_change)}；融资余额合计${formatNumber(snapshot.financing, 2)}亿元，较前一交易日${change(snapshot.financing_change)}；融券余额合计${formatNumber(snapshot.securities_lending, 2)}亿元，较前一交易日${change(snapshot.securities_lending_change)}。`;
}

function primaryIssue(issues: PrimaryIssueDetail[]): string {
  const lines: string[] = [];
  let section = "";
  for (const issue of issues) {
    const nextSection = `${issue.issue_date_key}:${issue.category}`;
    if (section !== nextSection) {
      section = nextSection;
      lines.push(`${issue.category}:`);
    }
    lines.push(
      `${issue.issue_date}-${issue.issuer}-${issue.tenors.join("/")}-` +
        `${formatPrimaryAmount(issue.amount)}-${formatPrimaryCoupons(issue.coupons)}`,
    );
  }
  return lines.length ? lines.join("\n") : "今日暂无。";
}

function secondaryMarket(rows: SecondaryBond[]): string {
  const candidates = rows.filter((row) => row.valuation !== null);
  const selected: string[] = [];
  for (const target of [3, 2, 1]) {
    const remaining = candidates.filter((item) => !selected.includes(item.bond_id));
    if (!remaining.length) break;
    const nearest = remaining.reduce((best, row) => Math.abs(row.tenor_years - target) < Math.abs(best.tenor_years - target) ? row : best);
    selected.push(nearest.bond_id);
  }
  const lines = selected.map((code) => candidates.find((item) => item.bond_id === code)!).map((item) => {
    return `${item.tenor_label.replaceAll("D", "天").replaceAll("Y", "年")}-${item.issuer}(${item.bond_name})-估值${compact(item.valuation!)}%-成交${compact(item.trade_yield)}%`;
  });
  if (lines.length === 1) lines.push("今日暂无。");
  return lines.join("\n");
}

function emBonds(rows: InventoryPoint[]): string {
  const candidates = [...rows].sort((left, right) => left.tenor_years - right.tenor_years);
  const lines = candidates.map((item) => {
    let line = `${item.tenor_label.replaceAll("D", "天").replaceAll("Y", "年")}-${item.bond_name || "--"}-估值${compact(item.valuation)}%`;
    const trade = emTradeText(item); if (trade) line += `-${trade}`; return line;
  });
  if (lines.length === 1) lines.push("今日暂无。");
  return lines.join("\n");
}

function emTradeText(row: InventoryPoint): string {
  const trade = row.trade_yield;
  if (trade !== null) { const bp = row.trade_spread_bp; return `成交${compact(trade)}%${bp === null ? "" : `(${bp >= 0 ? "+" : ""}${fixed(bp, 2)}bp)`}`; }
  const bid = row.bid_yield ?? null; const ofr = row.ofr_yield ?? null;
  return [bid === null ? "" : `Bid${compact(bid)}%`, ofr === null ? "" : `Ofr${compact(ofr)}%`].filter(Boolean).join("-");
}

function directionSummary(values: number[], upWord: string, downWord: string): string { if (!values.length) return "数据暂缺"; if (values.every((v) => v >= 0)) return `全面${upWord}`; if (values.every((v) => v <= 0)) return `全面${downWord}`; const up = values.filter((v) => v > 0).length; const down = values.filter((v) => v < 0).length; return up > down ? `多数${upWord}` : down > up ? `多数${downWord}` : "涨跌不一"; }
function formatChange(value: unknown, up: string, down: string, unchanged: string, unit: "bp" | "%"): string { const parsed = number(value); if (parsed === null || parsed === 0) return unchanged; return `${parsed < 0 ? down : up}${fixed(Math.abs(parsed), 2)}${unit}`; }
function groupDirection(signs: Map<string, number>, keys: string[]): string { const values = keys.flatMap((key) => signs.has(key) ? [signs.get(key)!] : []); if (!values.length) return ""; if (values.some((v) => v > 0) && values.some((v) => v < 0)) return "分化"; if (values.some((v) => v > 0)) return "上行"; if (values.some((v) => v < 0)) return "下行"; return "持平"; }
function curvePart(label: string, direction: string): string { return direction === "分化" ? `${label}分化` : `${label}${direction}`; }
function formatNumber(value: unknown, digits: number): string { const parsed = number(value); return parsed === null ? "--" : fixed(parsed, digits); }
function fixed(value: number, digits: number): string {
  const fraction = floatFraction(value);
  const scaled = fraction.numerator * 10n ** BigInt(digits);
  const rounded = divideHalfEven(scaled, fraction.denominator);
  const text = rounded.toString().padStart(digits + 1, "0");
  const body = digits ? `${text.slice(0, -digits)}.${text.slice(-digits)}` : text;
  return fraction.negative ? `-${body}` : body;
}
function compact(value: number): string {
  const fraction = floatFraction(value);
  if (fraction.numerator === 0n) return fraction.negative ? "-0" : "0";
  const absolute = Math.abs(value);
  let exponent = Math.floor(Math.log10(absolute));
  while (absolute < 10 ** exponent) exponent -= 1;
  while (absolute >= 10 ** (exponent + 1)) exponent += 1;
  const scale = 5 - exponent;
  const numerator = scale >= 0
    ? fraction.numerator * 10n ** BigInt(scale)
    : fraction.numerator;
  const denominator = scale >= 0
    ? fraction.denominator
    : fraction.denominator * 10n ** BigInt(-scale);
  let rounded = divideHalfEven(numerator, denominator);
  if (rounded >= 1_000_000n) {
    rounded /= 10n;
    exponent += 1;
  }
  const digits = rounded.toString().padStart(6, "0");
  let body: string;
  if (exponent < -4 || exponent >= 6) {
    const tail = digits.slice(1).replace(/0+$/, "");
    const mantissa = tail ? `${digits[0]}.${tail}` : digits[0]!;
    body = `${mantissa}e${exponent >= 0 ? "+" : "-"}${Math.abs(exponent).toString().padStart(2, "0")}`;
  } else if (exponent >= 0) {
    const integer = digits.slice(0, exponent + 1);
    const decimal = digits.slice(exponent + 1).replace(/0+$/, "");
    body = decimal ? `${integer}.${decimal}` : integer;
  } else {
    const decimal = `${"0".repeat(-exponent - 1)}${digits}`.replace(/0+$/, "");
    body = `0.${decimal}`;
  }
  return fraction.negative ? `-${body}` : body;
}
function floatFraction(value: number): { negative: boolean; numerator: bigint; denominator: bigint } {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, false);
  const bits = view.getBigUint64(0, false);
  const negative = (bits >> 63n) === 1n;
  const exponentBits = Number((bits >> 52n) & 0x7ffn);
  const fractionBits = bits & ((1n << 52n) - 1n);
  const mantissa = exponentBits === 0 ? fractionBits : (1n << 52n) | fractionBits;
  const exponent = exponentBits === 0 ? -1074 : exponentBits - 1023 - 52;
  return exponent >= 0
    ? { negative, numerator: mantissa << BigInt(exponent), denominator: 1n }
    : { negative, numerator: mantissa, denominator: 1n << BigInt(-exponent) };
}
function divideHalfEven(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const doubled = remainder * 2n;
  if (doubled > denominator || (doubled === denominator && quotient % 2n === 1n)) return quotient + 1n;
  return quotient;
}
function sign(value: number): number { return value > 0 ? 1 : value < 0 ? -1 : 0; }
