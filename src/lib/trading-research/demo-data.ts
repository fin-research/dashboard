export type WorkbenchViewId =
  | "overview"
  | "trading"
  | "credit"
  | "research"
  | "workflow"
  | "bond"
  | "financing-model";

export type WorkbenchIconName =
  | WorkbenchViewId
  | "calendar"
  | "check"
  | "database"
  | "funds"
  | "menu"
  | "search"
  | "sidebar"
  | "warning";

export const workbenchViews: Array<{
  id: WorkbenchViewId;
  label: string;
  title: string;
  context: string;
  icon: WorkbenchIconName;
}> = [
  {
    id: "overview",
    label: "总览",
    title: "总览",
    context: "交易、授信、研究与流程的多基准日快照",
    icon: "overview",
  },
  {
    id: "trading",
    label: "交易管理",
    title: "交易管理",
    context: "同业拆借（纯信用）与拆出（质押式回购）",
    icon: "trading",
  },
  {
    id: "credit",
    label: "授信管理",
    title: "授信管理",
    context: "授信周报发布范围与额度风险快照",
    icon: "credit",
  },
  {
    id: "research",
    label: "研究辅助",
    title: "研究辅助",
    context: "货币市场、存单与国债曲线快照",
    icon: "research",
  },
  {
    id: "workflow",
    label: "流程中心",
    title: "流程中心",
    context: "交易流程与授信周报流程",
    icon: "workflow",
  },
  {
    id: "bond",
    label: "二级池周报",
    title: "二级池周报",
    context: "逐日收益、持仓结构与成交复盘",
    icon: "bond",
  },
  {
    id: "financing-model",
    label: "融资择时模型",
    title: "融资择时模型",
    context: "融资成本、发行窗口与卖方观点",
    icon: "financing-model",
  },
];

export function normalizeWorkbenchView(
  value: string | null | undefined,
): WorkbenchViewId {
  return workbenchViews.some((view) => view.id === value)
    ? (value as WorkbenchViewId)
    : "overview";
}

export function workbenchViewPath(view: WorkbenchViewId): string {
  return view === "overview"
    ? "/trading-research"
    : `/trading-research/${view}`;
}

export const demoMeta = {
  importedAt: "2026-08-25",
  tradingAsOf: "2026-08-07 15:00",
  creditAsOf: "2026-08-21",
  researchStart: "2026-08-10",
  researchEnd: "2026-08-14",
  creditSnapshotId: "credit-20260821-6096d604b537",
  researchSnapshotId: "market-20260814-ebd1924910cc",
} as const;

export type DemoTrade = {
  id: string;
  time: string;
  direction: "融入" | "融出";
  product: "同业拆借" | "质押式回购";
  counterparty: string;
  amount: number;
  term: string;
  rate: number;
  collateral: string;
  status: "已成交" | "待确认";
};

export const demoTrades: DemoTrade[] = [
  { id: "T20260807001", time: "09:32", direction: "融入", product: "同业拆借", counterparty: "招商银行", amount: 5, term: "7D", rate: 1.85, collateral: "—", status: "已成交" },
  { id: "T20260807002", time: "09:45", direction: "融入", product: "同业拆借", counterparty: "工商银行", amount: 3, term: "14D", rate: 1.92, collateral: "—", status: "已成交" },
  { id: "T20260807003", time: "10:10", direction: "融出", product: "质押式回购", counterparty: "中信证券", amount: 2, term: "隔夜", rate: 1.65, collateral: "国债", status: "已成交" },
  { id: "T20260807004", time: "10:28", direction: "融入", product: "同业拆借", counterparty: "建设银行", amount: 8, term: "7D", rate: 1.83, collateral: "—", status: "已成交" },
  { id: "T20260807005", time: "10:55", direction: "融出", product: "同业拆借", counterparty: "华泰证券", amount: 1.5, term: "7D", rate: 1.88, collateral: "—", status: "已成交" },
  { id: "T20260807006", time: "11:05", direction: "融出", product: "质押式回购", counterparty: "农业银行", amount: 10, term: "1M", rate: 1.95, collateral: "利率债", status: "待确认" },
  { id: "T20260807007", time: "11:22", direction: "融入", product: "同业拆借", counterparty: "交通银行", amount: 4, term: "隔夜", rate: 1.62, collateral: "—", status: "已成交" },
  { id: "T20260807008", time: "13:15", direction: "融出", product: "质押式回购", counterparty: "国泰君安", amount: 3, term: "14D", rate: 1.9, collateral: "国债", status: "已成交" },
  { id: "T20260807009", time: "14:02", direction: "融入", product: "同业拆借", counterparty: "兴业银行", amount: 6, term: "7D", rate: 1.86, collateral: "—", status: "已成交" },
  { id: "T20260807010", time: "14:30", direction: "融出", product: "质押式回购", counterparty: "浦发银行", amount: 2.5, term: "隔夜", rate: 1.6, collateral: "信用债", status: "待确认" },
];

export function computeTradingSummary(trades: DemoTrade[]) {
  const totalAmount = trades.reduce((sum, trade) => sum + trade.amount, 0);
  const interbankAmount = trades
    .filter((trade) => trade.product === "同业拆借")
    .reduce((sum, trade) => sum + trade.amount, 0);
  const repoLendAmount = trades
    .filter((trade) => trade.product === "质押式回购" && trade.direction === "融出")
    .reduce((sum, trade) => sum + trade.amount, 0);
  const weightedRate = totalAmount
    ? trades.reduce((sum, trade) => sum + trade.amount * trade.rate, 0) /
      totalAmount
    : 0;

  return {
    tradeCount: trades.length,
    totalAmount,
    interbankAmount,
    repoLendAmount,
    interbankShare: totalAmount ? (interbankAmount / totalAmount) * 100 : 0,
    weightedRate,
    pendingCount: trades.filter((trade) => trade.status === "待确认").length,
  };
}

export const tradingSummary = computeTradingSummary(demoTrades);

export const fundingOverview = {
  borrowTotal: 185.2,
  lendTotal: 142.8,
  total: 328,
} as const;

export type DemoAlert = {
  id: string;
  level: "critical" | "high" | "medium" | "low";
  category: "交易" | "授信" | "市场";
  owner: string;
  eventAt: string;
  text: string;
};

export const overviewAlerts: DemoAlert[] = [
  { id: "ALR-002", level: "high", category: "交易", owner: "资金交易岗", eventAt: "2026-08-07 14:35", text: "质押式回购拆出待确认2笔、合计12.5亿元，需完成押券准入与估值折算复核" },
  { id: "CREDIT-EXPIRY-80", level: "high", category: "授信", owner: "授信管理岗", eventAt: "2026-08-21 09:00", text: "天津滨海农商行授信到期日为2026-08-27，剩余6天，需关注续作" },
  { id: "CREDIT-USAGE-12", level: "high", category: "授信", owner: "授信管理岗", eventAt: "2026-08-21 09:00", text: "工银理财额度使用率达98.8%，超过80%预警线" },
  { id: "CREDIT-USAGE-83", level: "high", category: "授信", owner: "授信管理岗", eventAt: "2026-08-21 09:00", text: "浙江三门农商行额度使用率达100.0%，超过80%预警线" },
];

export const creditSummary = {
  total: 3448.35,
  used: 1022.5955,
  available: 2425.7545,
  utilization: 29.6546,
  count: 120,
  expiring30: 5,
  mainTableTotal: 3450.35,
  scopeAdjustment: -2,
  validationStatus: "pass",
} as const;

export type DemoCreditLine = {
  bank: string;
  bankType: string;
  creditType: string;
  total: number;
  used: number;
  available: number;
  utilization: number;
  expiry: string | null;
};

export const demoCreditLines: DemoCreditLine[] = [
  { bank: "浙江三门农商行", bankType: "农商行", creditType: "同业授信", total: 3, used: 3, available: 0, utilization: 100, expiry: "2027-06-20" },
  { bank: "工银理财", bankType: "国有银行", creditType: "综合授信", total: 8, used: 7.9, available: 0.1, utilization: 98.75, expiry: "2027-03-11" },
  { bank: "平安银行", bankType: "股份行", creditType: "同业授信", total: 49, used: 47, available: 2, utilization: 95.9184, expiry: "2027-02-03" },
  { bank: "上海银行", bankType: "城商行", creditType: "同业授信", total: 63, used: 50.4, available: 12.6, utilization: 80, expiry: "2026-12-26" },
  { bank: "苏银理财", bankType: "城商行", creditType: "综合授信", total: 15, used: 10.1, available: 4.9, utilization: 67.3333, expiry: null },
  { bank: "民生理财", bankType: "股份行", creditType: "综合授信", total: 50, used: 32.8, available: 17.2, utilization: 65.6, expiry: "2027-11-19" },
  { bank: "民生银行", bankType: "股份行", creditType: "同业授信", total: 80, used: 50.7, available: 29.3, utilization: 63.375, expiry: "2027-06-12" },
  { bank: "光大理财", bankType: "股份行", creditType: "综合授信", total: 15, used: 9.4, available: 5.6, utilization: 62.6667, expiry: "2026-11-18" },
  { bank: "昆仑银行", bankType: "城商行", creditType: "同业授信", total: 8, used: 5, available: 3, utilization: 62.5, expiry: "2027-07-31" },
  { bank: "湖南昭阳农商行", bankType: "农商行", creditType: "同业授信", total: 1.6, used: 1, available: 0.6, utilization: 62.5, expiry: "2026-12-18" },
  { bank: "湖南衡南农商行", bankType: "农商行", creditType: "同业授信", total: 1.6, used: 1, available: 0.6, utilization: 62.5, expiry: "2027-06-25" },
  { bank: "招商银行", bankType: "股份行", creditType: "同业授信", total: 160, used: 97.5, available: 62.5, utilization: 60.9375, expiry: "2026-11-05" },
];

export const creditAlerts: DemoAlert[] = [
  { id: "CREDIT-EXPIRY-80", level: "high", category: "授信", owner: "授信管理岗", eventAt: "2026-08-21 09:00", text: "天津滨海农商行授信到期日为2026-08-27，剩余6天，需关注续作" },
  { id: "CREDIT-USAGE-12", level: "high", category: "授信", owner: "授信管理岗", eventAt: "2026-08-21 09:00", text: "工银理财额度使用率达98.8%，超过80%预警线" },
  { id: "CREDIT-USAGE-27", level: "high", category: "授信", owner: "授信管理岗", eventAt: "2026-08-21 09:00", text: "平安银行额度使用率达95.9%，超过80%预警线" },
  { id: "CREDIT-USAGE-36", level: "high", category: "授信", owner: "授信管理岗", eventAt: "2026-08-21 09:00", text: "上海银行额度使用率达80.0%，超过80%预警线" },
  { id: "CREDIT-USAGE-83", level: "high", category: "授信", owner: "授信管理岗", eventAt: "2026-08-21 09:00", text: "浙江三门农商行额度使用率达100.0%，超过80%预警线" },
];

export type DemoRate = {
  label: string;
  value: number;
  previous: number;
  changeBp: number;
};

export const researchSnapshot = {
  validation: {
    status: "pass",
    passedChecks: 10,
    mode: "规则模板",
    ruleVersion: "研究规则 0.1",
    reviewStatus: "待复核",
  },
  rates: [
    { label: "DR001", value: 1.3611, previous: 1.3634, changeBp: -0.23 },
    { label: "DR007", value: 1.3858, previous: 1.3917, changeBp: -0.59 },
    { label: "R001", value: 1.3813, previous: 1.3827, changeBp: -0.14 },
    { label: "R007", value: 1.4119, previous: 1.4206, changeBp: -0.87 },
    { label: "GC001", value: 0.957, previous: 1.27, changeBp: -31.3 },
    { label: "GC007", value: 1.391, previous: 1.411, changeBp: -2 },
  ] satisfies DemoRate[],
  history: {
    dates: ["08-03", "08-04", "08-05", "08-06", "08-07", "08-10", "08-11", "08-12", "08-13", "08-14"],
    dr007: [1.4204, 1.3816, 1.3738, 1.3816, 1.3881, 1.3953, 1.3925, 1.3959, 1.3917, 1.3858],
    r007: [1.4395, 1.4196, 1.4181, 1.4122, 1.4092, 1.4132, 1.4181, 1.4262, 1.4206, 1.4119],
    gc001: [1.506, 1.45, 1.366, 1.321, 1.015, 1.446, 1.421, 1.405, 1.27, 0.957],
  },
  cdCurve: [
    { tenor: "1月", value: 1.385, changeBp: -0.5 },
    { tenor: "3月", value: 1.425, changeBp: 0 },
    { tenor: "6月", value: 1.455, changeBp: 0.42 },
    { tenor: "9月", value: 1.4725, changeBp: 0.11 },
    { tenor: "1年", value: 1.48, changeBp: 0.2 },
  ],
  govCurve: [
    { tenor: "1年", value: 1.2065, changeBp: 0.22 },
    { tenor: "3年", value: 1.2607, changeBp: -0.81 },
    { tenor: "5年", value: 1.3935, changeBp: -1.38 },
    { tenor: "7年", value: 1.523, changeBp: -1.38 },
    { tenor: "10年", value: 1.6964, changeBp: -1.5 },
    { tenor: "30年", value: 2.1644, changeBp: -1.37 },
  ],
  unavailable: [
    { label: "SHIBOR 曲线", reason: "当前底稿未提供可核验 SHIBOR 曲线" },
    { label: "公开市场操作", reason: "当前底稿未提供逐日 OMO 操作明细" },
    { label: "政策卡片", reason: "当前底稿未提供政策原文及来源" },
    { label: "国内高频指标", reason: "当前底稿未覆盖高频宏观指标" },
    { label: "海外市场指标", reason: "当前底稿未覆盖海外市场指标" },
  ],
} as const;

export const workflowDemos = [
  {
    id: "FLOW-T20260807001",
    type: "交易流程",
    title: "招商银行 7D 同业拆借",
    businessKey: "T20260807001",
    detail: "2026年8月7日，与招商银行开展5亿元7天同业拆借，利率1.85%。",
    state: "投资经理复核",
    currentStep: 1,
    steps: ["交易员提交", "投资经理复核", "合规复核", "部门负责人复核", "交易员归档"],
  },
  {
    id: "FLOW-CREDIT-20260821",
    type: "授信周报",
    title: "授信周报（截至2026-08-21）",
    businessKey: "CREDIT-20260821",
    detail: "授信总额度3448.35亿元，已使用1022.5955亿元，可用额度2425.7545亿元。",
    state: "授信主管复核",
    currentStep: 1,
    steps: ["授信专员提交", "授信主管复核", "周报待导出", "已导出"],
  },
] as const;
