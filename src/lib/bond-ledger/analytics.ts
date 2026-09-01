import type {
  BondLedgerAnalytics,
  BondLedgerReport,
  BondLedgerSource,
  HoldingTypeStat,
  LedgerPerformanceRow,
  LedgerPositionDetail,
  LedgerPositionRow,
  LedgerTransaction,
  LedgerTransactionSide,
  MaturityBucketStat,
  ReturnRiskMetrics,
} from "./types";

const DAY_MS = 86_400_000;
const BUSINESS_TRADING_DAYS = 252;
const TRANSACTION_SIDES: Array<{
  side: LedgerTransactionSide;
  field: "buyQuantity" | "sellQuantity" | "maturityQuantity";
}> = [
  { side: "买入", field: "buyQuantity" },
  { side: "卖出", field: "sellQuantity" },
  { side: "到期", field: "maturityQuantity" },
];

const MATURITY_BUCKETS = [
  { bucket: "0-3月", min: 0, max: 0.25 },
  { bucket: "3-6月", min: 0.25, max: 0.5 },
  { bucket: "6-12月", min: 0.5, max: 1 },
  { bucket: "1-2年", min: 1, max: 2 },
  { bucket: "2-3年", min: 2, max: 3 },
  { bucket: "3-5年", min: 3, max: 5 },
  { bucket: "5-10年", min: 5, max: 10 },
  { bucket: "10年以上", min: 10, max: Number.POSITIVE_INFINITY },
] as const;

export function buildBondLedgerAnalytics(
  ledgers: BondLedgerSource[],
  startDate: string,
  endDate: string,
  storedTransactions?: LedgerTransaction[],
): BondLedgerAnalytics {
  const selectedLedgers = ledgers
    .filter((ledger) => ledger.date >= startDate && ledger.date <= endDate)
    .sort((left, right) => left.date.localeCompare(right.date));
  const latestLedger = selectedLedgers.at(-1) ?? null;
  if (!latestLedger) return emptyAnalytics(selectedLedgers);

  const currentPerformance =
    latestLedger.performance.find((row) => row.date === latestLedger.date) ??
    latestLedger.performance.filter((row) => row.date <= latestLedger.date).at(-1) ??
    null;
  const effectiveEndDate = currentPerformance?.date ?? latestLedger.date;
  const effectiveStartDate = startDate <= effectiveEndDate ? startDate : null;
  const rangePerformance = effectiveStartDate
    ? latestLedger.performance.filter(
        (row) => row.date >= effectiveStartDate && row.date <= effectiveEndDate,
      )
    : [];
  const currentPositionRows = latestLedger.positions.filter(
    (row) => row.currentQuantity > 0 || row.marketValue > 0,
  );
  const currentPositions = addRangeProfit(
    currentPositionRows,
    selectedLedgers,
  );
  const detailMarketValue = sum(currentPositions.map((row) => row.marketValue));
  const transactions = (storedTransactions
    ? storedTransactions.filter(
        (transaction) =>
          transaction.date >= startDate && transaction.date <= endDate,
      )
    : selectedLedgers.flatMap((ledger) => transactionsForLedger(ledger)))
    .sort((left, right) => {
      const dateOrder = right.date.localeCompare(left.date);
      return dateOrder || right.faceAmount - left.faceAmount;
    });
  const transactionTotals = transactionTotalMap(transactions);
  const rangeProfit = effectiveStartDate
    ? calculateRangeProfit(
        latestLedger.performance,
        effectiveStartDate,
        effectiveEndDate,
      )
    : null;
  const rangeAnnualizedReturn =
    effectiveStartDate && rangeProfit !== null
      ? calculateRangeAnnualizedReturn(
          latestLedger.performance,
          effectiveStartDate,
          effectiveEndDate,
          rangeProfit,
        )
      : null;
  const ytdAnnualizedReturn = calculateBusinessAnnualizedReturn(
    latestLedger.performance,
    effectiveEndDate,
  );
  const returnRiskMetrics = effectiveStartDate
    ? calculateReturnRiskMetrics(
        latestLedger.performance,
        effectiveStartDate,
        effectiveEndDate,
      )
    : emptyReturnRiskMetrics();
  const comparisonStartDate = effectiveStartDate
    ? addDays(effectiveStartDate, -7)
    : null;
  const comparisonEndDate = addDays(effectiveEndDate, -7);
  const previousPerformance = comparisonEndDate
    ? latestLedger.performance
        .filter((row) => row.date <= comparisonEndDate)
        .at(-1) ?? null
    : null;
  const previousRangeProfit =
    comparisonStartDate && comparisonEndDate
      ? calculateRangeProfit(
          latestLedger.performance,
          comparisonStartDate,
          comparisonEndDate,
        )
      : null;
  const previousTransactions =
    comparisonStartDate && comparisonEndDate
      ? storedTransactions
        ? storedTransactions.filter(
            (transaction) =>
              transaction.date >= comparisonStartDate &&
              transaction.date <= comparisonEndDate,
          )
        : ledgers
            .filter(
              (ledger) =>
                ledger.date >= comparisonStartDate &&
                ledger.date <= comparisonEndDate,
            )
            .flatMap((ledger) => transactionsForLedger(ledger))
      : [];
  const transactionCount = uniqueTransactionCount(transactions);
  const previousTransactionCount = uniqueTransactionCount(previousTransactions);

  return {
    selectedLedgers,
    latestLedger,
    currentPerformance,
    performanceTrend: latestLedger.performance.filter(
      (row) => row.date <= effectiveEndDate,
    ),
    rangePerformance,
    currentPositions: currentPositions.sort(
      (left, right) => right.marketValue - left.marketValue,
    ),
    holdingTypes: aggregateHoldingTypes(currentPositions, detailMarketValue),
    maturityBuckets: aggregateMaturityBuckets(
      currentPositions,
      detailMarketValue,
    ),
    transactions,
    transactionTotals,
    rangeProfit,
    rangeAnnualizedReturn,
    ytdAnnualizedReturn,
    returnRiskMetrics,
    transactionCount,
    metricDeltas: {
      marketValue: difference(
        currentPerformance?.marketValue,
        previousPerformance?.marketValue,
      ),
      leverage: difference(
        currentPerformance?.leverage,
        previousPerformance?.leverage,
      ),
      modifiedDuration: difference(
        currentPerformance?.modifiedDuration,
        previousPerformance?.modifiedDuration,
      ),
      ytdAnnualizedReturn: difference(
        ytdAnnualizedReturn,
        comparisonEndDate
          ? calculateBusinessAnnualizedReturn(
              latestLedger.performance,
              comparisonEndDate,
            )
          : null,
      ),
      rangeProfit: difference(rangeProfit, previousRangeProfit),
      transactionCount:
        previousTransactions.length || transactionCount
          ? transactionCount - previousTransactionCount
          : null,
    },
    detailMarketValue,
    reconciliationGap:
      currentPerformance && currentPerformance.marketValue !== 0
        ? (detailMarketValue - currentPerformance.marketValue) /
          currentPerformance.marketValue
        : null,
    effectiveStartDate,
    effectiveEndDate,
  };
}

export function toBondLedgerReport(
  analytics: BondLedgerAnalytics,
): BondLedgerReport {
  return {
    hasData: analytics.latestLedger !== null,
    currentPerformance: analytics.currentPerformance,
    performanceTrend: analytics.performanceTrend,
    holdingTypes: analytics.holdingTypes,
    maturityBuckets: analytics.maturityBuckets,
    transactions: analytics.transactions,
    transactionTotals: analytics.transactionTotals,
    rangeProfit: analytics.rangeProfit,
    rangeAnnualizedReturn: analytics.rangeAnnualizedReturn,
    ytdAnnualizedReturn: analytics.ytdAnnualizedReturn,
    returnRiskMetrics: analytics.returnRiskMetrics,
    transactionCount: analytics.transactionCount,
    metricDeltas: analytics.metricDeltas,
    effectiveStartDate: analytics.effectiveStartDate,
    effectiveEndDate: analytics.effectiveEndDate,
  };
}

export function emptyBondLedgerReport(): BondLedgerReport {
  return toBondLedgerReport(emptyAnalytics([]));
}

export function weekRange(referenceDate: string): {
  startDate: string;
  endDate: string;
} {
  const date = parseIsoDate(referenceDate);
  const weekday = date.getUTCDay() || 7;
  const monday = new Date(date.valueOf() - (weekday - 1) * DAY_MS);
  return {
    startDate: monday.toISOString().slice(0, 10),
    endDate: referenceDate,
  };
}

export function previousBusinessWeekRange(referenceDate: string): {
  startDate: string;
  endDate: string;
} {
  const currentWeek = weekRange(referenceDate);
  return {
    startDate: addDays(currentWeek.startDate, -7),
    endDate: addDays(currentWeek.startDate, -3),
  };
}

export function calculateBusinessAnnualizedReturn(
  performance: LedgerPerformanceRow[],
  throughDate?: string,
): number | null {
  return calculateBusinessAnnualizedReturnTrend(performance, throughDate)
    .map((point) => point.value)
    .filter((value): value is number => value !== null)
    .at(-1) ?? null;
}

export function calculateBusinessAnnualizedReturnTrend(
  performance: LedgerPerformanceRow[],
  throughDate?: string,
): Array<{ date: string; value: number | null }> {
  let dailyReturnSum = 0;
  let tradingDayCount = 0;
  let activeYear = "";
  return performance
    .filter((row) => !throughDate || row.date <= throughDate)
    .map((row) => {
      const year = row.date.slice(0, 4);
      if (year !== activeYear) {
        activeYear = year;
        dailyReturnSum = 0;
        tradingDayCount = 0;
      }
      if (row.principal > 0 && Number.isFinite(row.dailyRevenue)) {
        dailyReturnSum += row.dailyRevenue / row.principal;
        tradingDayCount += 1;
      }
      return {
        date: row.date,
        value:
          tradingDayCount > 0
            ? (dailyReturnSum / tradingDayCount) * BUSINESS_TRADING_DAYS
            : null,
      };
    });
}

export function calculateReturnRiskMetrics(
  performance: LedgerPerformanceRow[],
  startDate: string,
  endDate: string,
): ReturnRiskMetrics {
  const dailyReturns = performance
    .filter((row) => row.date >= startDate && row.date <= endDate)
    .sort((left, right) => left.date.localeCompare(right.date))
    .flatMap((row) => {
      if (row.principal <= 0 || !Number.isFinite(row.dailyRevenue)) return [];
      const value = row.dailyRevenue / row.principal;
      return Number.isFinite(value) && value > -1
        ? [{ date: row.date, value }]
        : [];
    });
  if (!dailyReturns.length) return emptyReturnRiskMetrics();

  const validDayCount = dailyReturns.length;
  const meanDailyReturn =
    sum(dailyReturns.map(({ value }) => value)) / validDayCount;
  const periodReturn = dailyReturns.reduce(
    (wealth, { value }) => wealth * (1 + value),
    1,
  ) - 1;
  const annualizedVolatility =
    validDayCount >= 2
      ? sampleStandardDeviation(
          dailyReturns.map(({ value }) => value),
          meanDailyReturn,
        ) * Math.sqrt(BUSINESS_TRADING_DAYS)
      : null;
  const returnVolatilityRatio =
    annualizedVolatility !== null && annualizedVolatility > 0
      ? (meanDailyReturn * BUSINESS_TRADING_DAYS) / annualizedVolatility
      : null;

  let wealth = 1;
  let peak = 1;
  let peakDate: string | null = null;
  let maxDrawdown = 0;
  let maxDrawdownPeakDate: string | null = null;
  let maxDrawdownTroughDate: string | null = null;
  for (const point of dailyReturns) {
    wealth *= 1 + point.value;
    if (wealth >= peak) {
      peak = wealth;
      peakDate = point.date;
      continue;
    }
    const drawdown = (peak - wealth) / peak;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownPeakDate = peakDate;
      maxDrawdownTroughDate = point.date;
    }
  }

  return {
    periodReturn,
    annualizedVolatility,
    maxDrawdown,
    returnVolatilityRatio,
    positiveDayRatio:
      dailyReturns.filter(({ value }) => value > 0).length / validDayCount,
    validDayCount,
    maxDrawdownPeakDate,
    maxDrawdownTroughDate,
  };
}

function calculateRangeProfit(
  performance: LedgerPerformanceRow[],
  startDate: string,
  endDate: string,
): number | null {
  const end = performance.filter((row) => row.date <= endDate).at(-1);
  if (!end || end.date < startDate) return null;
  const base = performance.filter((row) => row.date < startDate).at(-1);
  return end.cumulativeProfit - (base?.cumulativeProfit ?? 0);
}

function calculateRangeAnnualizedReturn(
  performance: LedgerPerformanceRow[],
  startDate: string,
  endDate: string,
  rangeProfit: number,
): number | null {
  const dayCount = daysBetween(startDate, endDate) + 1;
  if (dayCount <= 0) return null;
  const capitalDays = calculateCapitalDays(performance, startDate, endDate);
  if (capitalDays <= 0) return null;
  const averagePrincipal = capitalDays / dayCount;
  return (rangeProfit / averagePrincipal) * (365 / dayCount);
}

function calculateCapitalDays(
  performance: LedgerPerformanceRow[],
  startDate: string,
  endDate: string,
): number {
  let capitalDays = 0;
  let cursor = parseIsoDate(startDate);
  const last = parseIsoDate(endDate);
  let rowIndex = Math.max(
    0,
    performance.findIndex((row) => row.date >= startDate),
  );
  if (rowIndex > 0 && (performance[rowIndex]?.date ?? "") > startDate) {
    rowIndex -= 1;
  }
  while (cursor <= last) {
    const iso = cursor.toISOString().slice(0, 10);
    while (
      rowIndex + 1 < performance.length &&
      (performance[rowIndex + 1]?.date ?? "") <= iso
    ) {
      rowIndex += 1;
    }
    const row = performance[rowIndex];
    if (row && row.date <= iso) capitalDays += row.principal;
    cursor = new Date(cursor.valueOf() + DAY_MS);
  }
  return capitalDays;
}

function aggregateHoldingTypes(
  positions: LedgerPositionRow[],
  totalMarketValue: number,
): HoldingTypeStat[] {
  const groups = new Map<
    string,
    {
      marketValue: number;
      yieldValue: number;
      yieldWeight: number;
      remainingValue: number;
      remainingWeight: number;
      dv01: number;
      dailyProfit: number;
      ytdProfit: number;
      positionCount: number;
    }
  >();
  for (const row of positions) {
    const group = groups.get(row.category) ?? {
      marketValue: 0,
      yieldValue: 0,
      yieldWeight: 0,
      remainingValue: 0,
      remainingWeight: 0,
      dv01: 0,
      dailyProfit: 0,
      ytdProfit: 0,
      positionCount: 0,
    };
    group.marketValue += row.marketValue;
    group.dv01 += row.dv01;
    group.dailyProfit += row.dailyProfit;
    group.ytdProfit += row.ytdProfit;
    group.positionCount += 1;
    if (row.reportYield !== null && row.reportYield > 0 && row.marketValue > 0) {
      group.yieldValue += row.reportYield * row.marketValue;
      group.yieldWeight += row.marketValue;
    }
    if (
      row.remainingYears !== null &&
      row.remainingYears >= 0 &&
      row.marketValue > 0
    ) {
      group.remainingValue += row.remainingYears * row.marketValue;
      group.remainingWeight += row.marketValue;
    }
    groups.set(row.category, group);
  }
  return [...groups.entries()]
    .map(([category, group]) => ({
      category,
      marketValue: group.marketValue,
      share: totalMarketValue > 0 ? group.marketValue / totalMarketValue : 0,
      weightedYield:
        group.yieldWeight > 0 ? group.yieldValue / group.yieldWeight : null,
      weightedRemainingYears:
        group.remainingWeight > 0
          ? group.remainingValue / group.remainingWeight
          : null,
      dv01: group.dv01,
      dailyProfit: group.dailyProfit,
      ytdProfit: group.ytdProfit,
      positionCount: group.positionCount,
    }))
    .sort((left, right) => right.marketValue - left.marketValue);
}

function aggregateMaturityBuckets(
  positions: LedgerPositionRow[],
  totalMarketValue: number,
): MaturityBucketStat[] {
  return MATURITY_BUCKETS.map(({ bucket, min, max }) => {
    const members = positions.filter((row) => {
      const remaining = row.remainingYears;
      return remaining !== null && remaining >= min && remaining < max;
    });
    const marketValue = sum(members.map((row) => row.marketValue));
    const yieldMembers = members.filter(
      (row) => row.reportYield !== null && row.reportYield > 0 && row.marketValue > 0,
    );
    const yieldWeight = sum(yieldMembers.map((row) => row.marketValue));
    return {
      bucket,
      marketValue,
      share: totalMarketValue > 0 ? marketValue / totalMarketValue : 0,
      weightedYield:
        yieldWeight > 0
          ? sum(
              yieldMembers.map(
                (row) => (row.reportYield as number) * row.marketValue,
              ),
            ) / yieldWeight
          : null,
      positionCount: members.length,
    };
  });
}

function transactionsForLedger(ledger: BondLedgerSource): LedgerTransaction[] {
  const transactions: LedgerTransaction[] = [];
  for (const row of ledger.positions) {
    for (const { side, field } of TRANSACTION_SIDES) {
      const quantity = row[field];
      if (quantity <= 0) continue;
      transactions.push({
        date: ledger.date,
        side,
        code: row.code,
        name: row.name,
        category: row.category,
        quantity,
        faceAmount: quantity * 100,
        realizedProfit: side === "买入" ? null : row.realizedProfit,
      });
    }
  }
  return transactions.sort((left, right) => {
    const dateOrder = right.date.localeCompare(left.date);
    return dateOrder || right.faceAmount - left.faceAmount;
  });
}

function transactionTotalMap(
  transactions: LedgerTransaction[],
): Record<LedgerTransactionSide, number> {
  const totals: Record<LedgerTransactionSide, number> = {
    买入: 0,
    卖出: 0,
    到期: 0,
  };
  for (const transaction of transactions) {
    totals[transaction.side] += transaction.faceAmount;
  }
  return totals;
}

function emptyAnalytics(
  selectedLedgers: BondLedgerSource[],
): BondLedgerAnalytics {
  return {
    selectedLedgers,
    latestLedger: null,
    currentPerformance: null,
    performanceTrend: [],
    rangePerformance: [],
    currentPositions: [],
    holdingTypes: [],
    maturityBuckets: [],
    transactions: [],
    transactionTotals: { 买入: 0, 卖出: 0, 到期: 0 },
    rangeProfit: null,
    rangeAnnualizedReturn: null,
    ytdAnnualizedReturn: null,
    returnRiskMetrics: emptyReturnRiskMetrics(),
    transactionCount: 0,
    metricDeltas: {
      marketValue: null,
      leverage: null,
      modifiedDuration: null,
      ytdAnnualizedReturn: null,
      rangeProfit: null,
      transactionCount: null,
    },
    detailMarketValue: 0,
    reconciliationGap: null,
    effectiveStartDate: null,
    effectiveEndDate: null,
  };
}

function emptyReturnRiskMetrics(): ReturnRiskMetrics {
  return {
    periodReturn: null,
    annualizedVolatility: null,
    maxDrawdown: null,
    returnVolatilityRatio: null,
    positiveDayRatio: null,
    validDayCount: 0,
    maxDrawdownPeakDate: null,
    maxDrawdownTroughDate: null,
  };
}

function addRangeProfit(
  positions: LedgerPositionRow[],
  ledgers: BondLedgerSource[],
): LedgerPositionDetail[] {
  const profits = new Map<string, number>();
  for (const ledger of ledgers) {
    for (const row of ledger.positions) {
      const key = positionKey(row);
      profits.set(key, (profits.get(key) ?? 0) + row.dailyProfit);
    }
  }
  return positions.map((position) => ({
    ...position,
    rangeProfit: profits.get(positionKey(position)) ?? 0,
  }));
}

function uniqueTransactionCount(transactions: LedgerTransaction[]): number {
  return new Set(
    transactions.map((transaction) => transaction.code || transaction.name),
  ).size;
}

function positionKey(position: LedgerPositionRow): string {
  return position.code || position.name;
}

function difference(
  current: number | null | undefined,
  previous: number | null | undefined,
): number | null {
  return current === null ||
    current === undefined ||
    previous === null ||
    previous === undefined
    ? null
    : current - previous;
}

function addDays(value: string, days: number): string {
  return new Date(parseIsoDate(value).valueOf() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function parseIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function daysBetween(start: string, end: string): number {
  return Math.round(
    (parseIsoDate(end).valueOf() - parseIsoDate(start).valueOf()) / DAY_MS,
  );
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function sampleStandardDeviation(values: number[], mean: number): number {
  return Math.sqrt(
    values.reduce((total, value) => total + (value - mean) ** 2, 0) /
      (values.length - 1),
  );
}
