export interface MarketMetric {
  label: string;
  value: number | null;
  change: number | null;
  unit: string;
}

export interface OmoPoint {
  day: string;
  net_amount: number;
}

export interface EquityPoint {
  name: string;
  close: number;
  change_pct: number;
}

export interface IndustryPoint {
  name: string;
  change_pct: number;
  market_cap_yuan: number;
}

export interface PrimaryPoint {
  issue_date: string;
  issuer: string;
  bond_name: string;
  category: string;
  tenor_years: number;
  amount: number;
  coupon: number;
}

export interface PrimarySummary {
  current_amount: number;
  change_amount: number | null;
}

export interface ComparablePoint {
  issuer: string;
  bond_name: string;
  tenor_years: number;
  trade_yield: number;
}

export interface InventoryPoint {
  bond_name: string;
  tenor_years: number;
  valuation: number;
  trade_yield: number | null;
  bid_yield?: number | null;
  ofr_yield?: number | null;
}

export interface MarginSnapshot {
  data_date: string | null;
  total: number | null;
  total_change: number | null;
}

export interface ReportData {
  report_date: string;
  generated_at: string;
  omo_history: OmoPoint[];
  funds: MarketMetric[];
  government_bonds: MarketMetric[];
  equities: EquityPoint[];
  equity_data_time: string | null;
  turnover_yi: number | null;
  turnover_change_yi: number | null;
  margin: MarginSnapshot;
  industries: IndustryPoint[];
  industry_data_date: string;
  primary_summary: PrimarySummary;
  primary: PrimaryPoint[];
  comparable: ComparablePoint[];
  inventory: InventoryPoint[];
}

export interface ApiConfig {
  defaultDate: string;
}

export interface MarketBriefing {
  report_date: string;
  content: string;
  news_count: number;
}
