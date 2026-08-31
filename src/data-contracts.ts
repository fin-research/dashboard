import { z } from "zod";

const finiteNumber = z.number().finite();

export const omoOperationSchema = z.object({
  operationDate: z.string(),
  operationName: z.string(),
  duration: z.string(),
  interestRate: finiteNumber.nullable(),
  operationAmount: finiteNumber,
});
export const omoOperationsSchema = z.array(omoOperationSchema);

export const cfetsRateSchema = z.object({
  bondCode: z.string(),
  weightedYield: finiteNumber,
  weightedYieldUpDownValueBp: finiteNumber,
});
export const cfetsRatesSchema = z.array(cfetsRateSchema);

export const governmentBondSchema = z.object({
  ordinateName: z.string(),
  abscissaName: z.string(),
  bondCode: z.string(),
  tradeNum: finiteNumber,
  yield: finiteNumber,
  yieldSubYtdCloseBp: finiteNumber.nullable(),
});
export const governmentBondsSchema = z.array(governmentBondSchema);

export const futuresQuoteSchema = z.object({
  contractCode: z.string(),
  lastPrice: finiteNumber,
  upDownValuePct: finiteNumber,
});
export const futuresQuotesSchema = z.array(futuresQuoteSchema);

export const marginBalanceSchema = z.object({
  DIM_DATE: z.string(),
  TOTAL_RZRQYE: finiteNumber,
  TOTAL_RZYE: finiteNumber,
  TOTAL_RQYE: finiteNumber,
});
export const marginBalancesSchema = z.array(marginBalanceSchema);

export const primaryIssueSchema = z.object({
  bidStartDate: z.string().optional(),
  issueStartDate: z.string().optional(),
  biddingTime: z.string().optional(),
  comShortName: z.string().optional(),
  issuerShortName: z.string().optional(),
  issuerShortNameCn: z.string().optional(),
  comFullName: z.string().optional(),
  issuerName: z.string().optional(),
  publicOffering: z.union([z.string(), finiteNumber]).optional(),
  publicOfferingText: z.string().optional(),
  offeringType: z.string().optional(),
  issueWay: z.string().optional(),
  raisingMode: z.string().optional(),
  bondTypeText: z.string().optional(),
  bondShortName: z.string(),
  issueTenor: z.string().optional(),
  planIssueAmount: finiteNumber.optional(),
  issueCouponRate: finiteNumber.nullable().optional(),
});
export const primaryIssuesSchema = z.array(primaryIssueSchema);

export const todayTradeSchema = z.object({
  bondUniCode: z.string(),
  remainingTenor: z.string(),
  cbYte: finiteNumber.nullable().optional(),
  tradeYield: finiteNumber,
  tradeYieldSubCb: finiteNumber.nullable().optional(),
});
export const todayTradesSchema = z.array(todayTradeSchema);

export const favoriteQuoteSchema = z.object({
  bondUniCode: z.string(),
  bondShortName: z.string().optional(),
  remainingTenor: z.string(),
  remainingTenorDay: finiteNumber.optional(),
  cbYield: finiteNumber.nullable().optional(),
  bidYield: finiteNumber.nullable().optional(),
  bidEntryPrice: finiteNumber.nullable().optional(),
  ofrYield: finiteNumber.nullable().optional(),
  ofrEntryPrice: finiteNumber.nullable().optional(),
  tradeEntryPrice: finiteNumber.nullable().optional(),
  tradeYieldSubCb: finiteNumber.nullable().optional(),
});
export const favoriteQuotesSchema = z.array(favoriteQuoteSchema);

export const bondInfoSchema = z.object({
  bondUniCode: z.string(),
  bondShortName: z.string(),
  comShortName: z.string(),
  bondType: finiteNumber,
  bondOfferingType: finiteNumber,
});
export const bondInfosSchema = z.array(bondInfoSchema);

const equitySchema = z.object({
  name: z.string(),
  close: finiteNumber,
  change_pct: finiteNumber,
});
const industrySchema = z.object({
  name: z.string(),
  change_pct: finiteNumber,
  market_cap_yuan: finiteNumber,
});
export const industrySnapshotSchema = z.object({
  dataDate: z.string(),
  equities: z.array(equitySchema),
  industries: z.array(industrySchema),
  turnoverYi: finiteNumber.nullable(),
  turnoverChangeYi: finiteNumber.nullable(),
  tradingDates: z.array(z.string()),
});

export const stockSummarySchema = z.object({
  title: z.string(),
  time: z.string().nullable(),
  paragraphs: z.array(z.string()),
});

export type OmoOperation = z.infer<typeof omoOperationSchema>;
export type CfetsRate = z.infer<typeof cfetsRateSchema>;
export type GovernmentBond = z.infer<typeof governmentBondSchema>;
export type FuturesQuote = z.infer<typeof futuresQuoteSchema>;
export type MarginBalance = z.infer<typeof marginBalanceSchema>;
export type PrimaryIssue = z.infer<typeof primaryIssueSchema>;
export type TodayTrade = z.infer<typeof todayTradeSchema>;
export type FavoriteQuote = z.infer<typeof favoriteQuoteSchema>;
export type BondInfo = z.infer<typeof bondInfoSchema>;
export type IndustrySnapshot = z.infer<typeof industrySnapshotSchema>;
export type StockSummary = z.infer<typeof stockSummarySchema>;
