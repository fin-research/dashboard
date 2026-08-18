// Derive the visual report's view objects from the unified /report raw rows.
// Both the visual panels and the text-report replica read the same fields;
// this layer only projects what the visual charts and tables need.

import {
  isEastmoneyText,
  isPublicBond,
  median,
  normalizeCompany,
  number,
  secondaryTenorYears,
  string,
} from "./rows.ts";
import { primaryIssueDetails } from "./primary-issues.ts";
import type {
  ComparablePoint,
  InventoryPoint,
  MarginSnapshot,
  MarketMetric,
  OmoPoint,
  PrimaryIssueDetail,
  ReportData,
  Row,
} from "./types";

export interface ReportDerived {
  omoHistory: OmoPoint[];
  funds: MarketMetric[];
  governmentBonds: MarketMetric[];
  margin: MarginSnapshot;
  primary: PrimaryIssueDetail[];
  comparable: ComparablePoint[];
  inventory: InventoryPoint[];
}

export function deriveReport(data: ReportData): ReportDerived {
  return {
    omoHistory: omoHistoryPoints(data.omo),
    funds: fundMetrics(data.rates),
    governmentBonds: governmentBondMetrics(data.rates.bonds),
    margin: marginSnapshot(data.margin),
    primary: primaryPoints(data.primary, data.report_date),
    comparable: comparablePoints(data.secondary),
    inventory: inventoryPoints(data.inventory),
  };
}

export function omoHistoryPoints(rows: Row[]): OmoPoint[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const day = string(row.operationDate).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const amount = number(row.operationAmount);
    if (amount === null) continue;
    totals.set(day, (totals.get(day) ?? 0) + amount);
  }
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-10)
    .map(([day, net_amount]) => ({ day, net_amount }));
}

export function fundMetrics(rates: ReportData["rates"]): MarketMetric[] {
  const picks: Array<[string, Row[]]> = [
    ["DR001", rates.dr],
    ["DR007", rates.dr],
    ["DIBO001", rates.dibo],
    ["DIBO007", rates.dibo],
  ];
  return picks.map(([label, rows]) => {
    const row =
      rows.find(
        (item) => item.bondCode === label || item.bondShortName === label,
      ) ?? {};
    return {
      label,
      value: number(row.weightedYield),
      change: number(row.weightedYieldUpDownValueBp),
      unit: "%",
    };
  });
}

export function governmentBondMetrics(rows: Row[]): MarketMetric[] {
  const picks: Array<[string, string]> = [
    ["1Y国债", "1Y"],
    ["5Y国债", "5Y"],
    ["10Y国债", "10Y"],
    ["30Y国债", "超长期限"],
  ];
  return picks.map(([label, axis]) => {
    const row = pickTopCase(rows, "国债", axis) ?? {};
    return {
      label,
      value: number(row.yield),
      change: number(row.yieldSubYtdCloseBp),
      unit: "%",
    };
  });
}

export function marginSnapshot(rows: Row[]): MarginSnapshot {
  if (!rows.length) return { data_date: null, total: null, total_change: null };
  const current = rows[0]!;
  const previous = rows[1];
  const currentTotal = number(current.TOTAL_RZRQYE);
  const previousTotal = previous ? number(previous.TOTAL_RZRQYE) : null;
  const text = string(current.DIM_DATE).slice(0, 10);
  return {
    data_date: /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null,
    total: currentTotal === null ? null : currentTotal / 1e8,
    total_change:
      currentTotal !== null && previousTotal !== null
        ? (currentTotal - previousTotal) / 1e8
        : null,
  };
}

export function primaryPoints(
  rows: Row[],
  reportDate: string,
): PrimaryIssueDetail[] {
  return primaryIssueDetails(rows, reportDate);
}

export function comparablePoints(rows: Row[]): ComparablePoint[] {
  const points: ComparablePoint[] = [];
  for (const row of rows) {
    const bond_name = string(row.bondShortName).trim().split(" ")[0] ?? "";
    const issuer =
      normalizeCompany(row.comShortName) || bond_name.slice(2, 4) || "未知";
    const trade_yield = number(row.tradeYield);
    const tenor_years = secondaryTenorYears(row.remainingTenor);
    if (
      isEastmoneyText(issuer) ||
      isEastmoneyText(bond_name) ||
      !isPublicBond(bond_name) ||
      trade_yield === null ||
      tenor_years === null ||
      tenor_years > 5
    ) {
      continue;
    }
    points.push({ issuer, bond_name, tenor_years, trade_yield });
  }
  return filterComparableOutliers(points).sort(
    (left, right) =>
      left.tenor_years - right.tenor_years ||
      left.bond_name.localeCompare(right.bond_name, "zh-CN"),
  );
}

export function inventoryPoints(rows: Row[]): InventoryPoint[] {
  const points: InventoryPoint[] = [];
  for (const row of rows) {
    const tenor_years = number(row.tenor_years);
    const valuation = number(row.valuation);
    if (tenor_years === null || valuation === null) continue;
    points.push({
      bond_name: string(row.bondShortName) || "--",
      tenor_years,
      valuation,
      trade_yield: number(row.trade_yield),
      bid_yield: number(row.bid_yield),
      ofr_yield: number(row.ofr_yield),
    });
  }
  return points.sort((left, right) => left.tenor_years - right.tenor_years);
}

function pickTopCase(
  rows: Row[],
  ordinate: string,
  abscissa: string,
): Row | undefined {
  return rows
    .filter(
      (row) =>
        row.ordinateName === ordinate && row.abscissaName === abscissa,
    )
    .sort(
      (left, right) =>
        (number(right.tradeNum) ?? 0) - (number(left.tradeNum) ?? 0),
    )[0];
}

function filterComparableOutliers(
  points: ComparablePoint[],
): ComparablePoint[] {
  if (points.length < 8) return points;
  const slopes: number[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const left = points[index]!;
    for (
      let rightIndex = index + 1;
      rightIndex < points.length;
      rightIndex += 1
    ) {
      const right = points[rightIndex]!;
      if (right.tenor_years !== left.tenor_years) {
        slopes.push(
          (right.trade_yield - left.trade_yield) /
            (right.tenor_years - left.tenor_years),
        );
      }
    }
  }
  if (!slopes.length) return points;
  const slope = median(slopes);
  const intercept = median(
    points.map((point) => point.trade_yield - slope * point.tenor_years),
  );
  const residuals = points.map(
    (point) => point.trade_yield - (intercept + slope * point.tenor_years),
  );
  const residualCenter = median(residuals);
  const residualMad = median(
    residuals.map((residual) => Math.abs(residual - residualCenter)),
  );
  const threshold = Math.max(0.05, 3.5 * 1.4826 * residualMad);
  return points.filter(
    (point, index) =>
      Math.abs(residuals[index]! - residualCenter) <= threshold,
  );
}
