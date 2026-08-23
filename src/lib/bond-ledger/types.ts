export interface LedgerPerformanceRow {
  date: string;
  principal: number;
  timeWeightedPrincipal: number;
  marketValue: number;
  leverage: number;
  modifiedDuration: number;
  dailyRevenue: number;
  cumulativeProfit: number;
  ytdAnnualizedReturn: number | null;
  ytdExTaxAnnualizedReturn: number | null;
}

export interface LedgerPositionRow {
  reportDate: string;
  rowNumber: number;
  team: string;
  investmentManager: string;
  account: string;
  code: string;
  market: string;
  name: string;
  category: string;
  yieldChangeBp: number | null;
  remainingYears: number | null;
  interestStartDate: string | null;
  maturityDate: string | null;
  currentQuantity: number;
  previousQuantity: number;
  buyQuantity: number;
  sellQuantity: number;
  maturityQuantity: number;
  couponRate: number | null;
  valuationYield: number | null;
  reportYield: number | null;
  fullPrice: number | null;
  dv01: number;
  marketValue: number;
  couponIncome: number;
  taxExemptIncome: number;
  realizedProfit: number | null;
  dailyProfit: number;
  ytdProfit: number;
  fullPriceCost: number;
}

export interface ParsedBondLedger {
  date: string;
  performance: LedgerPerformanceRow[];
  positions: LedgerPositionRow[];
}

export interface BondLedgerImportParams {
  uploadId: string;
  r2Key: string;
  r2Etag: string | null;
  originalName: string;
  fileSize: number;
  expectedDate: string | null;
  uploadedAt: string;
}

export type BondLedgerSource = ParsedBondLedger;

export type LedgerTransactionSide = "买入" | "卖出" | "到期";

export interface LedgerTransaction {
  date: string;
  side: LedgerTransactionSide;
  code: string;
  name: string;
  category: string;
  quantity: number;
  faceAmount: number;
  realizedProfit: number | null;
}

export interface LedgerPositionDetail extends LedgerPositionRow {
  rangeProfit: number;
}

export interface HoldingTypeStat {
  category: string;
  marketValue: number;
  share: number;
  weightedYield: number | null;
  weightedRemainingYears: number | null;
  dv01: number;
  dailyProfit: number;
  ytdProfit: number;
  positionCount: number;
}

export interface MaturityBucketStat {
  bucket: string;
  marketValue: number;
  share: number;
  weightedYield: number | null;
  positionCount: number;
}

export interface BondLedgerAnalytics {
  selectedLedgers: BondLedgerSource[];
  latestLedger: BondLedgerSource | null;
  currentPerformance: LedgerPerformanceRow | null;
  performanceTrend: LedgerPerformanceRow[];
  rangePerformance: LedgerPerformanceRow[];
  currentPositions: LedgerPositionDetail[];
  holdingTypes: HoldingTypeStat[];
  maturityBuckets: MaturityBucketStat[];
  transactions: LedgerTransaction[];
  transactionTotals: Record<LedgerTransactionSide, number>;
  rangeProfit: number | null;
  rangeAnnualizedReturn: number | null;
  ytdAnnualizedReturn: number | null;
  transactionCount: number;
  metricDeltas: {
    marketValue: number | null;
    leverage: number | null;
    modifiedDuration: number | null;
    ytdAnnualizedReturn: number | null;
    rangeProfit: number | null;
    transactionCount: number | null;
  };
  detailMarketValue: number;
  reconciliationGap: number | null;
  effectiveStartDate: string | null;
  effectiveEndDate: string | null;
}

export interface BondLedgerReport {
  hasData: boolean;
  currentPerformance: LedgerPerformanceRow | null;
  performanceTrend: LedgerPerformanceRow[];
  holdingTypes: HoldingTypeStat[];
  maturityBuckets: MaturityBucketStat[];
  transactions: LedgerTransaction[];
  transactionTotals: Record<LedgerTransactionSide, number>;
  rangeProfit: number | null;
  rangeAnnualizedReturn: number | null;
  ytdAnnualizedReturn: number | null;
  transactionCount: number;
  metricDeltas: BondLedgerAnalytics["metricDeltas"];
  effectiveStartDate: string | null;
  effectiveEndDate: string | null;
}
