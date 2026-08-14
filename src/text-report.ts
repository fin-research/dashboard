import {
  hasValue,
  isEastmoneyText,
  isPublicBond,
  normalizeCompany,
  number,
  parseTenorDays,
  secondaryTenorYears,
  strictNumber,
  string,
  type Row,
} from "./rows.ts";
import type { ReportData } from "./types";

const PRIMARY_ORDER = ["短融", "公募短债", "小公募", "公募次级债", "私募债"];
const FUTURES = [
  ["TL9999", "30年期主力合约", true],
  ["T9999", "10年期主力合约", false],
  ["TF9999", "5年期主力合约", false],
  ["TS9999", "2年期主力合约", false],
] as const;

export function buildTextReport(data: ReportData): string {
  return `${data.report_date.replaceAll("-", "")} 境内市场点评

【央行】
${briefOmo(data.omo, data.report_date)}

【利率】
${bondMarket(data.rates)}

【股市】
${stockMarket(data.stock_paragraphs)}

${marginTrading(data.margin)}

【一级发行】
可比证券公司发行情况:${" "}
${primaryIssue(data.primary)}

【二级行情】
可比证券公司债券成交：(公募债)
${secondaryMarket(data.secondary)}

东财存量债券:${" "}
${emBonds(data.inventory)}

【今日聚焦】

`;
}

export function briefOmo(rows: Row[], reportDate: string): string {
  const dayRows = rows.filter(
    (row) => string(row.operationDate).slice(0, 10) === reportDate,
  );
  const inject = dayRows
    .filter((row) => number(row.operationAmount)! > 0)
    .sort((left, right) => number(left.operationAmount)! - number(right.operationAmount)!);
  const drain = dayRows
    .filter((row) => number(row.operationAmount)! < 0)
    .sort((left, right) => number(right.operationAmount)! - number(left.operationAmount)!);
  let text = "中国央行今日开展";
  inject.forEach((row, index) => {
    if (index === 1) text += "，并开展";
    else if (index > 1) text += "、";
    text += `${string(row.duration).replaceAll("D", "天").replaceAll("M", "月").replaceAll("Y", "年")}期${string(row.operationName)}${compact(Math.abs(number(row.operationAmount)!))}亿元`;
    const interest = strictNumber(row.interestRate);
    if (interest !== null) text += `，操作利率为${fixed(interest, 2)}%`;
  });
  text += `；今日${drain.length ? "有" : "无逆回购到期"}`;
  drain.forEach((row, index) => {
    if (index > 0) text += "、";
    text += `${string(row.duration).replaceAll("D", "天").replaceAll("M", "月").replaceAll("Y", "年")}期${string(row.operationName)}${compact(Math.abs(number(row.operationAmount)!))}亿元`;
  });
  const net = dayRows.reduce((sum, row) => sum + number(row.operationAmount)!, 0);
  if (net > 0) text += `；净投放${compact(net)}亿元。`;
  else if (net < 0) text += `；净回笼${compact(Math.abs(net))}亿元。`;
  else text += "；净投放为零。";
  return text;
}

function bondMarket(rates: ReportData["rates"]): string {
  return [capitalBrief(rates.dr, rates.dibo), bondBrief(rates.bonds), futuresBrief(rates.futures)].join("\n\n");
}

function capitalBrief(dr: Row[], dibo: Row[]): string {
  const funds = [findCode(dr, "DR001"), findCode(dr, "DR007"), findCode(dibo, "DIBO001"), findCode(dibo, "DIBO007")];
  const summary = directionSummary(funds.map((row) => number(row.weightedYieldUpDownValueBp) ?? 0), "上行", "下行");
  return `今日银行间隔夜和7天期利率${summary}。\n截至17:00，${fundText(funds[0]!)}；${fundText(funds[1]!)}。\n同业拆借${fundText(funds[2]!)}；${fundText(funds[3]!)}。`;
}

function fundText(row: Row): string {
  return `${string(row.bondCode || row.bondShortName)}报${formatNumber(row.weightedYield, 4)}%，${formatChange(row.weightedYieldUpDownValueBp, "涨", "跌", "与前日持平", "bp")}`;
}

function bondBrief(rows: Row[]): string {
  const items: Record<string, Row | undefined> = {
    gov30: topCase(rows, "国债", "超长期限"), gov10: topCase(rows, "国债", "10Y"),
    gov5: topCase(rows, "国债", "5Y"), gov1: topCase(rows, "国债", "1Y"),
    cdb10: topCase(rows, "国开", "10Y"),
  };
  const govLines = [["30年期国债", items.gov30], ["10年期国债", items.gov10], ["5年期国债", items.gov5], ["1年期国债", items.gov1]]
    .flatMap(([label, row]) => row ? [bondText(label as string, row as Row)] : []);
  const cdbLine = items.cdb10 ? bondText("10年期国开债", items.cdb10) : "";
  if (!govLines.length && !cdbLine) return "今日利率债成交数据暂缺。";
  const parts = [`国债收益率${curveSummary(items)}。`];
  parts.push(govLines.length ? `截至17:00，${govLines.join("，")}。` : "截至17:00，国债成交数据暂缺。");
  parts.push(cdbLine ? `${cdbLine}。` : "10年期国开债成交数据暂缺。");
  return parts.join("\n");
}

function bondText(label: string, row: Row): string {
  return `${label}${string(row.bondCode || "--")}收益率${formatChange(row.yieldSubYtdCloseBp, "上行", "下行", "持平", "bp")}报${formatNumber(row.yield, 4)}%`;
}

function curveSummary(items: Record<string, Row | undefined>): string {
  const order = ["gov30", "gov10", "gov5", "gov1"];
  const signs = new Map(order.filter((key) => items[key]).map((key) => [key, sign(number(items[key]!.yieldSubYtdCloseBp) ?? 0)]));
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

function futuresBrief(rows: Row[]): string {
  const selected = FUTURES.flatMap(([code, label, includePrice]) => {
    const row = rows.find((item) => item.contractCode === code);
    return row ? [{ row, label, includePrice }] : [];
  });
  if (!selected.length) return "国债期货成交数据暂缺。";
  const values = selected.map(({ row }) => number(row.upDownValuePct) ?? 0);
  const summary = directionSummary(values, "上涨", "下跌");
  const lines = selected.map(({ row, label, includePrice }) => `${label}${formatChange(row.upDownValuePct, "涨", "跌", "持平", "%")}${includePrice ? `报${formatNumber(row.lastPrice, 4)}` : ""}`);
  return `国债期货${summary}，${lines.join("，")}。`;
}

function stockMarket(paragraphs: string[]): string {
  return paragraphs.length ? paragraphs.slice(0, 2).join("").trim() : "未找到今日收盘行情";
}

function marginTrading(rows: Row[]): string {
  const today = marginRow(rows[0]!); const yesterday = marginRow(rows[1]!);
  const change = (current: number, previous: number) => `${current >= previous ? "增加" : "减少"}${fixed(Math.abs(current - previous), 2)}亿元`;
  const date = new Date(`${today.date.slice(0, 10)}T00:00:00`);
  return `截至${date.getMonth() + 1}月${date.getDate()}日，沪深京三市融资融券余额合计${fixed(today.total, 2)}亿元，较前一交易日${change(today.total, yesterday.total)}；融资余额合计${fixed(today.financing, 2)}亿元，较前一交易日${change(today.financing, yesterday.financing)}；融券余额合计${fixed(today.lending, 2)}亿元，较前一交易日${change(today.lending, yesterday.lending)}。`;
}

function marginRow(row: Row) { return { date: string(row.DIM_DATE), total: number(row.TOTAL_RZRQYE)! / 1e8, financing: number(row.TOTAL_RZYE)! / 1e8, lending: number(row.TOTAL_RQYE)! / 1e8 }; }

function primaryIssue(rows: Row[]): string {
  const groups = new Map(PRIMARY_ORDER.map((category) => [category, [] as Row[]]));
  for (const row of rows) {
    if (isEastmoneyIssue(row) || !hasValue(row.issueCouponRate)) continue;
    groups.get(primaryCategory(row))!.push(row);
  }
  const lines: string[] = [];
  for (const category of PRIMARY_ORDER) {
    const group = groups.get(category)!;
    if (!group.length) continue;
    lines.push(`${category}:`);
    group.sort(primaryCompare).forEach((row) => lines.push(`${primaryDate(row)}-${primaryIssuer(row)}-${transformPrimaryTenor(row.issueTenor)}-${compactDecimal(row.planIssueAmount)}亿-${compactDecimal(row.issueCouponRate)}%`));
  }
  if (lines.length === 1) lines.push("今日暂无。");
  return lines.join("\n");
}

function secondaryMarket(rows: Row[]): string {
  const candidates = rows.flatMap((row) => {
    const bond = string(row.bondShortName).trim().split(" ")[0] ?? "";
    const valuation = number(row.cbYte); const trade = number(row.tradeYield); const tenor = secondaryTenorYears(row.remainingTenor);
    return isPublicBond(bond) && !isEastmoneyText(row.comShortName) && !isEastmoneyText(row.bondShortName) && valuation !== null && trade !== null && tenor !== null ? [{ row, bondShortName: bond, cbYte: valuation, tradeYield: trade, tenorYears: tenor }] : [];
  });
  const selected: unknown[] = [];
  for (const target of [3, 2, 1]) {
    const remaining = candidates.filter((item) => !selected.includes(item.row.bondUniCode));
    if (!remaining.length) break;
    const nearest = remaining.reduce((best, row) => Math.abs(row.tenorYears - target) < Math.abs(best.tenorYears - target) ? row : best);
    selected.push(nearest.row.bondUniCode);
  }
  const lines = selected.map((code) => candidates.find((item) => item.row.bondUniCode === code)!).map((item) => {
    const issuer = normalizeCompany(item.row.comShortName) || string(item.bondShortName).slice(2, 4) || "未知";
    return `${formatSecondaryTenor(item.row.remainingTenor)}-${issuer}(${item.bondShortName})-估值${compact(item.cbYte)}%-成交${compact(item.tradeYield)}%`;
  });
  if (lines.length === 1) lines.push("今日暂无。");
  return lines.join("\n");
}

function emBonds(rows: Row[]): string {
  const candidates = rows.flatMap((row) => {
    const valuation = number(row.cbYield); if (valuation === null) return [];
    return [{ row, cbYield: valuation, tenorDays: number(row.remainingTenorDay) || parseTenorDays(row.remainingTenor) }];
  }).sort((left, right) => left.tenorDays - right.tenorDays);
  const lines = candidates.map((item) => {
    let line = `${string(item.row.remainingTenor || "--").replaceAll("D", "天").replaceAll("Y", "年")}-${string(item.row.bondShortName).trim() || "--"}-估值${compact(item.cbYield)}%`;
    const trade = emTradeText(item.row); if (trade) line += `-${trade}`; return line;
  });
  if (lines.length === 1) lines.push("今日暂无。");
  return lines.join("\n");
}

function emTradeText(row: Row): string {
  const trade = number(row.tradeEntryPrice);
  if (trade !== null) { const bp = number(row.tradeYieldSubCb); return `成交${compact(trade)}%${bp === null ? "" : `(${bp >= 0 ? "+" : ""}${fixed(bp, 2)}bp)`}`; }
  const bid = number(row.bidYield) ?? number(row.bidEntryPrice); const ofr = number(row.ofrYield) ?? number(row.ofrEntryPrice);
  return [bid === null ? "" : `Bid${compact(bid)}%`, ofr === null ? "" : `Ofr${compact(ofr)}%`].filter(Boolean).join("-");
}

function topCase(rows: Row[], ordinate: string, abscissa: string): Row | undefined { return rows.filter((row) => row.ordinateName === ordinate && row.abscissaName === abscissa).sort((a, b) => number(b.tradeNum || 0)! - number(a.tradeNum || 0)!)[0]; }
function findCode(rows: Row[], code: string): Row { const row = rows.find((item) => item.bondCode === code || item.bondShortName === code); if (!row) throw new Error(`Missing capital row: ${code}`); return row; }
function directionSummary(values: number[], upWord: string, downWord: string): string { if (!values.length) return "数据暂缺"; if (values.every((v) => v >= 0)) return `全面${upWord}`; if (values.every((v) => v <= 0)) return `全面${downWord}`; const up = values.filter((v) => v > 0).length; const down = values.filter((v) => v < 0).length; return up > down ? `多数${upWord}` : down > up ? `多数${downWord}` : "涨跌不一"; }
function formatChange(value: unknown, up: string, down: string, unchanged: string, unit: "bp" | "%"): string { const parsed = number(value); if (parsed === null || parsed === 0) return unchanged; return `${parsed < 0 ? down : up}${fixed(Math.abs(parsed), 2)}${unit}`; }
function groupDirection(signs: Map<string, number>, keys: string[]): string { const values = keys.flatMap((key) => signs.has(key) ? [signs.get(key)!] : []); if (!values.length) return ""; if (values.some((v) => v > 0) && values.some((v) => v < 0)) return "分化"; if (values.some((v) => v > 0)) return "上行"; if (values.some((v) => v < 0)) return "下行"; return "持平"; }
function curvePart(label: string, direction: string): string { return direction === "分化" ? `${label}分化` : `${label}${direction}`; }
function primaryCategory(row: Row): string { if (string(row.publicOffering) === "2" || [row.publicOfferingText, row.offeringType, row.issueWay, row.raisingMode].some((v) => v != null && string(v).includes("私募"))) return "私募债"; if (string(row.bondTypeText).includes("短期融资券")) return "短融"; if (string(row.bondTypeText).includes("次级债")) return "公募次级债"; if (primaryTenorLeOne(row.issueTenor) || /S\d+$/.test(string(row.bondShortName))) return "公募短债"; return "小公募"; }
function primaryTenorLeOne(value: unknown): boolean { const match = string(value).trim().toUpperCase().match(/^([0-9]+(?:\.[0-9]+)?)([YD]).*$/); return !!match && (match[2] === "Y" ? Number(match[1]) <= 1 : Number(match[1]) <= 365); }
function primaryIssuer(row: Row): string { for (const key of ["comShortName", "issuerShortName", "issuerShortNameCn"]) { const value = normalizePrimary(normalizeCompany(row[key])); if (value) return value; } return normalizePrimary(row.comFullName || row.issuerName); }
function normalizePrimary(value: unknown): string { let text = string(value).replace(/\s+/g, ""); if (!text) return ""; if (text === "中国国际金融股份有限公司") return "中金公司"; if (text === "中国中金财富证券有限公司") return "中金财富"; for (const suffix of ["股份有限公司", "有限责任公司", "有限公司"]) if (text.endsWith(suffix)) { text = text.slice(0, -suffix.length); break; } if (text.startsWith("中国中金")) text = text.slice(2); return [...text].slice(0, 4).join(""); }
function primaryCompare(a: Row, b: Row): number { return compare(primaryIssuer(a), primaryIssuer(b)) || primaryTenorDays(a.issueTenor) - primaryTenorDays(b.issueTenor) || compare(primaryDate(a), primaryDate(b)) || compare(string(a.bondShortName), string(b.bondShortName)); }
function primaryDate(row: Row): string { const value = row.bidStartDate || row.issueStartDate; if (hasValue(value)) { const text = string(value); return `${text.slice(5, 7)}/${text.slice(8, 10)}`; } const bidding = string(row.biddingTime); return /^\d{2}-\d{2}/.test(bidding) ? bidding.slice(0, 5).replace("-", "/") : "--/--"; }
function isEastmoneyIssue(row: Row): boolean {
  return (
    isEastmoneyText(row.bondShortName) ||
    isEastmoneyText(row.issuer) ||
    isEastmoneyText(row.comShortName) ||
    isEastmoneyText(row.issuerShortName) ||
    isEastmoneyText(row.issuerShortNameCn)
  );
}
function transformPrimaryTenor(value: unknown): string { const text = string(value).trim(); if (text.startsWith("0.") && text.toUpperCase().endsWith("Y")) { const parsed = Number(text.slice(0, -1)); if (Number.isFinite(parsed)) return `${Math.trunc(parsed * 365)}D`; } return text; }
function primaryTenorDays(value: unknown): number { const match = string(value).trim().toUpperCase().match(/^([0-9]+(?:\.[0-9]+)?)([YD])/); return match ? Number(match[1]) * (match[2] === "D" ? 1 : 365) : Infinity; }
function formatSecondaryTenor(value: unknown): string { const years = secondaryTenorYears(value); return years === null ? string(value || "--") : years >= 1 ? `${fixed(years, 1)}年` : `${fixed(years * 365, 0)}天`; }
function compactDecimal(value: unknown): string { if (!hasValue(value)) return "--"; const parsed = Number(string(value).trim()); return Number.isNaN(parsed) ? string(value).trim() : compact(parsed); }
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
function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
