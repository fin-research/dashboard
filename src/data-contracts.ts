import { z } from "zod";

const finiteNumber = z.number().finite();
const numericValue = z
  .union([
    finiteNumber,
    z.string().trim().regex(/^-?\d+(?:\.\d+)?$/),
  ])
  .transform(Number);
const nullableNumericValue = z.preprocess(
  (value) => value === undefined ? null : value,
  z
    .union([
      finiteNumber,
      z.string().trim().regex(/^-?\d+(?:\.\d+)?$/),
      z.literal("--"),
      z.literal(""),
      z.null(),
    ])
    .transform((value) => value === null || value === "--" || value === ""
      ? null
      : Number(value)),
);
const identifier = z
  .union([z.string().min(1), z.number().int().finite()])
  .transform(String);

function directOrLegacyList<T extends z.ZodType, L extends z.ZodType>(
  rows: z.ZodArray<T>,
  legacy: L,
  selectLegacy: (value: z.output<L>) => unknown,
): z.ZodType<z.output<typeof rows>> {
  return z.union([rows, legacy]).transform((value) =>
    rows.parse(Array.isArray(value) ? value : selectLegacy(value)),
  );
}

export const omoOperationSchema = z.object({
  operationDate: z.string(),
  operationName: z.string(),
  duration: z.string(),
  interestRate: nullableNumericValue,
  operationAmount: numericValue,
});
const omoRowsSchema = z.array(omoOperationSchema);
const legacyOmoSchema = z.object({ data: z.array(z.unknown()) });
export const omoOperationsSchema = directOrLegacyList(
  omoRowsSchema,
  legacyOmoSchema,
  (value) => value.data,
);

export const cfetsRateSchema = z.object({
  bondCode: z.string(),
  weightedYield: numericValue,
  weightedYieldUpDownValueBp: numericValue,
});
const cfetsRowsSchema = z.array(cfetsRateSchema);
const legacyCfetsSchema = z.object({ cfetsCapitalTable: z.array(z.unknown()) });
export const cfetsRatesSchema = directOrLegacyList(
  cfetsRowsSchema,
  legacyCfetsSchema,
  (value) => value.cfetsCapitalTable,
);

export const governmentBondSchema = z.object({
  ordinateName: z.string(),
  abscissaName: z.string(),
  bondCode: z.string(),
  tradeNum: numericValue,
  yield: numericValue,
  yieldSubYtdCloseBp: nullableNumericValue,
});
const governmentRowsSchema = z.array(governmentBondSchema);
const legacyGovernmentSchema = z.object({ data: z.array(z.unknown()) });
export const governmentBondsSchema = directOrLegacyList(
  governmentRowsSchema,
  legacyGovernmentSchema,
  (value) => value.data,
);

export const futuresQuoteSchema = z.object({
  contractCode: z.string(),
  lastPrice: nullableNumericValue,
  upDownValuePct: nullableNumericValue,
});
const futuresRowsSchema = z.array(futuresQuoteSchema);
const legacyFuturesSchema = z.object({
  futuresContractLatestTradeProtoList: z.array(z.unknown()),
});
export const futuresQuotesSchema = directOrLegacyList(
  futuresRowsSchema,
  legacyFuturesSchema,
  (value) => value.futuresContractLatestTradeProtoList,
);

export const marginBalanceSchema = z.object({
  DIM_DATE: z.string(),
  TOTAL_RZRQYE: numericValue,
  TOTAL_RZYE: numericValue,
  TOTAL_RQYE: numericValue,
});
const marginRowsSchema = z.array(marginBalanceSchema);
const legacyMarginSchema = z.object({ data: z.array(z.unknown()) });
export const marginBalancesSchema = directOrLegacyList(
  marginRowsSchema,
  legacyMarginSchema,
  (value) => value.data,
);

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
  planIssueAmount: numericValue.optional(),
  issueCouponRate: nullableNumericValue.optional(),
});
const primaryRowsSchema = z.array(primaryIssueSchema);
const legacyPrimarySchema = z.object({
  data: z.object({ list: z.array(z.unknown()) }),
});
export const primaryIssuesSchema = directOrLegacyList(
  primaryRowsSchema,
  legacyPrimarySchema,
  (value) => value.data.list,
);

export const todayTradeSchema = z.object({
  bondUniCode: identifier,
  remainingTenor: z.string(),
  cbYte: nullableNumericValue.optional(),
  tradeYield: numericValue,
  tradeYieldSubCb: nullableNumericValue.optional(),
});
const todayRowsSchema = z.array(todayTradeSchema);
const legacyTodaySchema = z.object({ list: z.array(z.unknown()) });
export const todayTradesSchema = directOrLegacyList(
  todayRowsSchema,
  legacyTodaySchema,
  (value) => value.list,
);

export const favoriteQuoteSchema = z.object({
  bondUniCode: identifier,
  bondShortName: z.string().optional(),
  remainingTenor: z.string(),
  remainingTenorDay: numericValue.optional(),
  cbYield: nullableNumericValue.optional(),
  bidYield: nullableNumericValue.optional(),
  bidEntryPrice: nullableNumericValue.optional(),
  ofrYield: nullableNumericValue.optional(),
  ofrEntryPrice: nullableNumericValue.optional(),
  tradeEntryPrice: nullableNumericValue.optional(),
  tradeYieldSubCb: nullableNumericValue.optional(),
});
const favoriteRowsSchema = z.array(favoriteQuoteSchema);
const legacyFavoriteSchema = z.object({ list: z.array(z.unknown()) });
export const favoriteQuotesSchema = directOrLegacyList(
  favoriteRowsSchema,
  legacyFavoriteSchema,
  (value) => value.list,
);

export const bondInfoSchema = z.object({
  bondUniCode: identifier,
  bondShortName: z.string(),
  comShortName: z.string(),
  bondType: numericValue,
  bondOfferingType: numericValue,
});
const bondInfoRowsSchema = z.array(bondInfoSchema);
const legacyBondInfoSchema = z.object({ data: z.array(z.unknown()) });
export const bondInfosSchema = directOrLegacyList(
  bondInfoRowsSchema,
  legacyBondInfoSchema,
  (value) => value.data,
);

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
