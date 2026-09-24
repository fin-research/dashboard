import type { BondDatabaseClient } from './postgres';

export type LiquidityMetric = {
  date: string;
  value_ratio: number;
  historical_percentile: number | null;
  sample_count: number;
};

export type IssuerSpreadMetric = {
  date: string;
  spread_bp: number | null;
  outstanding_bonds: number;
  balance_cny: number;
};

export type IssuanceBusinessMetrics = {
  lcr: LiquidityMetric | null;
  nsfr: LiquidityMetric | null;
  issuer_spread: IssuerSpreadMetric | null;
};

type BondQuote = {
  bond_code: string;
  chinabond_yield_pct: number | null;
  outstanding_balance_cny: number | null;
  remaining_term_years: number | null;
};
type CurveNode = { tenor_years: number; yield_pct: number };

const AAA_SECURITIES_CURVE = '5781a1ff7651967e0176978d957b7346';

function matchingYield(term: number, curve: CurveNode[]): number | null {
  if (!Number.isFinite(term) || term <= 0 || curve.length < 2) return null;
  if (term < curve[0]!.tenor_years || term > curve[curve.length - 1]!.tenor_years) return null;
  for (let index = 0; index < curve.length; index += 1) {
    const high = curve[index]!;
    if (term === high.tenor_years) return high.yield_pct;
    if (term < high.tenor_years && index > 0) {
      const low = curve[index - 1]!;
      const width = high.tenor_years - low.tenor_years;
      return width > 0 ? low.yield_pct + (term - low.tenor_years) / width * (high.yield_pct - low.yield_pct) : null;
    }
  }
  return null;
}

/** The issuer spread is absent unless every expected bond has a known balance
 * and every positive-balance bond has a same-day valuation and curve tenor. */
export function balanceWeightedIssuerSpread(bonds: BondQuote[], curve: CurveNode[]): Omit<IssuerSpreadMetric, 'date'> {
  const sorted = [...curve].sort((left, right) => left.tenor_years - right.tenor_years);
  let total = 0;
  let weighted = 0;
  let outstanding = 0;
  let complete = sorted.length >= 2 && sorted.every(row => Number.isFinite(row.tenor_years) && Number.isFinite(row.yield_pct));
  for (const bond of bonds) {
    const balance = bond.outstanding_balance_cny;
    if (balance === null || !Number.isFinite(balance) || balance < 0) {
      complete = false;
      continue;
    }
    if (balance === 0) continue;
    outstanding += 1;
    total += balance;
    const reference = bond.remaining_term_years === null ? null : matchingYield(bond.remaining_term_years, sorted);
    if (reference === null || bond.chinabond_yield_pct === null || !Number.isFinite(bond.chinabond_yield_pct)) {
      complete = false;
      continue;
    }
    weighted += balance * (bond.chinabond_yield_pct - reference) * 100;
  }
  return { spread_bp: complete && total > 0 ? weighted / total : null, outstanding_bonds: outstanding, balance_cny: total };
}

export async function loadIssuanceBusinessMetrics(
  client: BondDatabaseClient,
  issuer: string,
  marketDate: string,
): Promise<IssuanceBusinessMetrics> {
  const liquidity = await client.query<{
    field: 'lcr' | 'nsfr'; date: string; value_ratio: number; sample_count: number; rank_count: number;
  }>(`WITH latest AS (
      SELECT DISTINCT ON (field) field, observation_date, numeric_value
      FROM public.quant_input
      WHERE dataset='company' AND entity_key='' AND field=ANY($1::text[])
        AND source='local-workbook' AND numeric_value IS NOT NULL
        AND observation_date <= $2::date
      ORDER BY field, observation_date DESC
    )
    SELECT latest.field, latest.observation_date::text AS date,
      latest.numeric_value AS value_ratio,
      (SELECT count(*)::integer FROM public.quant_input history
       WHERE history.dataset='company' AND history.entity_key='' AND history.field=latest.field
         AND history.source='local-workbook' AND history.numeric_value IS NOT NULL
         AND history.observation_date <= $2::date) AS sample_count,
      (SELECT count(*)::integer FROM public.quant_input history
       WHERE history.dataset='company' AND history.entity_key='' AND history.field=latest.field
         AND history.source='local-workbook' AND history.numeric_value IS NOT NULL
         AND history.observation_date <= $2::date AND history.numeric_value <= latest.numeric_value) AS rank_count
    FROM latest`, [['lcr', 'nsfr'], marketDate]);
  const output: IssuanceBusinessMetrics = { lcr: null, nsfr: null, issuer_spread: null };
  for (const row of liquidity.rows) {
    const count = Number(row.sample_count);
    output[row.field] = {
      date: row.date,
      value_ratio: Number(row.value_ratio),
      historical_percentile: count >= 20 ? 100 * Number(row.rank_count) / count : null,
      sample_count: count,
    };
  }

  const quoteDate = await client.query<{ date: string | null }>(
    `SELECT max(curve.observation_date)::text AS date
     FROM public.bond_industry_curve curve
     WHERE curve.curve_code=$1 AND curve.observation_date <= $2::date
       AND EXISTS (SELECT 1 FROM public.bond_history history
                   WHERE history.valuation_date=curve.observation_date)`,
    [AAA_SECURITIES_CURVE, marketDate],
  );
  const date = quoteDate.rows[0]?.date;
  if (!date) return output;

  const [bonds, curve] = await Promise.all([
    client.query<BondQuote>(
      `SELECT issuance.bond_code, history.chinabond_yield_pct,
         history.outstanding_balance_cny, history.remaining_term_years
       FROM public.bond_issuance issuance
       LEFT JOIN public.bond_history history
         ON history.bond_code=issuance.bond_code AND history.valuation_date=$2::date
       WHERE issuance.issuer_name=$1 AND issuance.issuer_rating='AAA'
         AND issuance.bond_type='证券公司债' AND issuance.interest_rate_type='固息'
         AND issuance.has_option=false
         AND issuance.issue_date <= $2::date
         AND (issuance.original_tenor_years IS NULL
              OR issuance.issue_date + round(issuance.original_tenor_years * 365.25)::integer >= $2::date
              OR history.outstanding_balance_cny > 0)
       ORDER BY issuance.bond_code`,
      [issuer, date],
    ),
    client.query<CurveNode>(
      `SELECT tenor_years, yield_pct FROM public.bond_industry_curve
       WHERE curve_code=$1 AND observation_date=$2::date ORDER BY tenor_years`,
      [AAA_SECURITIES_CURVE, date],
    ),
  ]);
  output.issuer_spread = { date, ...balanceWeightedIssuerSpread(bonds.rows, curve.rows) };
  return output;
}
