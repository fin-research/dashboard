import { creditItemLabels, creditItemTypes, type CreditAmountChange, type CreditCalendarEvent,
  type CreditEventType, type CreditInstitutionUpdateResponse, type CreditInstitutionView,
  type CreditItemType, type CreditReportResponse, type CreditSummaryView,
  type CreditWeeklyNewsItem, type ParsedCreditWorkbook } from '../credit/types.ts';
import { toCreditDiffPatch, toCreditImportPatch } from '../credit/diff.ts';
import type { CreditInstitutionUpdateInput } from '../credit/update.ts';
import { compareCreditInstitutionOrder } from '../credit/presentation.ts';
import { creditCustomerSchema, type CreditCustomer } from '../credit-assistant/types.ts';
import type { DatabaseClient } from './postgres.ts';

const AMOUNT_TOLERANCE = 0.000001;
export class CreditDatabaseError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; this.name = 'CreditDatabaseError'; }
}

/** Resolve today's NDA flag from all prior diffs, never from one sparse row. */
export async function findCreditCustomers(client: DatabaseClient, query: string, exact = false): Promise<CreditCustomer[]> {
  const name = query.trim();
  if (!name || name.length > 200) return [];
  await client.query('BEGIN READ ONLY');
  try {
    const result = await client.query(`SELECT institution_name AS name, confidentiality_status AS "confidentialityStatus",
      to_char(effective_on,'YYYY-MM-DD') AS "reportDate", CURRENT_TIMESTAMP::text AS "checkedAt"
      FROM credit.state_as_of((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date)
      WHERE ($2::boolean AND institution_name=$1 OR NOT $2::boolean AND strpos(lower(institution_name),lower($1))>0)
      ORDER BY (institution_name=$1) DESC,institution_name LIMIT 20`, [name,exact]);
    const customers = result.rows.map(row => creditCustomerSchema.parse(row));
    await client.query('COMMIT'); return customers;
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
}

export interface PersistCreditImportInput { parsed: ParsedCreditWorkbook; createdBy?: string | null }
export interface PersistCreditImportResult {
  reportDate: string; institutionCount: number; approvedCount: number; totalLimit: number; totalUsed: number;
  totalAvailable: number; weeklyApprovedCount: number; weeklyTotalLimit: number; weeklyTotalUsed: number;
  weeklyTotalAvailable: number; addedDiffCount: number; replaced: boolean; warnings: string[];
}

export async function persistCreditWorkbook(client: DatabaseClient, input: PersistCreditImportInput): Promise<PersistCreditImportResult> {
  const { parsed } = input;
  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('credit.excel_import',0))");
    // Imports are observations: identical fields produce no row, including a same-day reimport.
    const inserted = await client.query(`SELECT credit.append_diff($1::date,row.name,row.patch,$3) AS id
      FROM jsonb_to_recordset($2::jsonb) AS row(name text,patch jsonb)`,
      [parsed.reportDate,JSON.stringify(parsed.institutions.map(institution => ({name:institution.institutionName,patch:toCreditImportPatch(institution)}))),input.createdBy ?? null]);
    const addedDiffCount = inserted.rows.filter(row => row.id != null).length;
    const report = await loadCreditReport(client, parsed.reportDate);
    const warnings = [...(parsed.warnings ?? [])];
    for (const institution of report.institutions) {
      const source = parsed.institutions.find(row => row.institutionName === institution.institutionName);
      if (!source) continue;
      for (const type of ['yield_certificate','interbank_lending'] as const) {
        const actual = institution.items.find(item => item.type === type)?.usedAmount;
        const imported = source.items.find(item => item.type === type)?.usedAmount;
        if (actual == null) warnings.push(`${institution.institutionName}：客户关联缺失，${creditItemLabels[type]}已用无法计算，请维护客户关联`);
        else if (different(actual,imported ?? 0)) warnings.push(`${institution.institutionName}：${creditItemLabels[type]}原表${imported ?? 0}亿元，融资台账${actual}亿元，差额${actual-(imported ?? 0)}亿元；使用融资台账金额`);
      }
    }
    await client.query('COMMIT');
    const s = report.summary;
    return { reportDate: parsed.reportDate,institutionCount:parsed.institutions.length,approvedCount:s.approvedCount,
      totalLimit:s.totalLimit,totalUsed:s.totalUsed,totalAvailable:s.totalAvailable,weeklyApprovedCount:s.approvedCount,
      weeklyTotalLimit:s.totalLimit,weeklyTotalUsed:s.totalUsed,weeklyTotalAvailable:s.totalAvailable,
      addedDiffCount,replaced:false,warnings };
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
}

type DiffRow = Record<string, unknown> & {
  id: number; institution_name: string; effective_on: string; created_at: string;
  created_by: string | null; updated_at: string | null; cleared_fields: string[];
};
type ClientLink = { institution_name: string; id: string; name: string };
type UsageRow = { date: string; institution_name: string; item_type: CreditItemType; amount: number };
const auditFields = new Set(['id','institution_name','effective_on','created_at','created_by','updated_at','cleared_fields']);

function statesAt(rows: DiffRow[], date: string): Map<string, DiffRow> {
  const result = new Map<string, DiffRow>();
  for (const row of rows) {
    if (row.effective_on > date) break;
    const state = result.get(row.institution_name) ?? {} as DiffRow;
    for (const [key,value] of Object.entries(row)) {
      if (auditFields.has(key) || value != null || row.cleared_fields.includes(key)) state[key] = value;
    }
    result.set(row.institution_name,state);
  }
  return result;
}

function institutionView(state: DiffRow, date: string, links: ClientLink[], usage: UsageRow[]): CreditInstitutionView {
  const clients = links.filter(row => row.institution_name === state.institution_name).map(({id,name}) => ({id,name}));
  const items = creditItemTypes.map(type => {
    const financing = type === 'yield_certificate' || type === 'interbank_lending';
    const limitAmount = nullableNumber(state[`${type}_limit`]);
    const usedAmount = financing ? (clients.length ? usage.find(row => row.date === date && row.institution_name === state.institution_name && row.item_type === type)?.amount ?? 0 : null)
      : nullableNumber(state[`${type}_used`]);
    return { type,limitAmount,usedAmount,remainingAmount:limitAmount == null || (financing && usedAmount == null) ? null : limitAmount-(usedAmount ?? 0),
      details: (state[`${type}_detail`] as string | null) ?? null,usageSource:financing ? 'financing' as const : 'credit' as const,linkedClientCount:clients.length };
  });
  const totalLimit = nullableNumber(state.total);
  const totalUsed = clients.length ? sumAmounts(items.map(item => item.usedAmount)) : null;
  const availableAmount = totalLimit == null || totalUsed == null ? null : totalLimit-totalUsed;
  return { reportDate:date,institutionName:state.institution_name,institutionType:state.institution_type as string,
    confidentialityStatus:state.confidentiality_status === true,status:state.status as CreditInstitutionView['status'],
    totalLimit,totalUsed,totalRemaining:availableAmount,availableAmount,utilization:totalLimit && totalUsed != null ? totalUsed/totalLimit*100 : null,
    effectiveDate:state.effective_date as string | null ?? null,expiryDate:state.expiry_date as string | null ?? null,
    bankOffice:state.bank_office as string | null ?? null,applyingDepartment:state.applying_department as string | null ?? null,
    handler:state.handler as string | null ?? null,detail:state.detail as string | null ?? null,notes:state.notes as string | null ?? null,
    bondPreference:state.bond_preference as string | null ?? null,updatedAt:state.updated_at ?? state.created_at,clients,items };
}

export async function loadCreditReport(client: DatabaseClient, requestedDate: string | null = null, calendarMonth?: string): Promise<CreditReportResponse> {
  const diffResult = await client.query<{ data: DiffRow }>(`SELECT to_jsonb(d) AS data FROM credit.diff d ORDER BY effective_on,created_at,id`);
  const rows = diffResult.rows.map(row => row.data);
  const availableDates = [...new Set(rows.map(row => row.effective_on))];
  const reportDate = requestedDate ?? new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const firstDate = availableDates[0];
  if (!firstDate || reportDate < firstDate) throw new CreditDatabaseError(404,requestedDate ? `${requestedDate} 授信记录不存在` : '暂无授信记录');
  const previousDate = addDays(reportDate,-7) >= firstDate ? addDays(reportDate,-7) : availableDates.filter(date => date < reportDate).at(-1) ?? null;
  const monthStart = `${calendarMonth ?? reportDate.slice(0,7)}-01`;
  const calendarStart = addDays(monthStart,-6);
  const calendarEnd = addDays(monthStart,41);
  const links = (await client.query<ClientLink>(`SELECT m.institution_name,c.id::text AS id,c.name
    FROM credit.institution_client m JOIN public.client c ON c.id=m.client_id ORDER BY m.institution_name,c.name`)).rows;
  const usageDates = (await client.query<{date:string}>(`SELECT DISTINCT to_char(v.date,'YYYY-MM-DD') AS date
    FROM financing.debt d JOIN credit.institution_client m ON m.client_id=d.client_id
    CROSS JOIN LATERAL (VALUES(d.activated_at),(d.maturity_date),(d.settled_at),(d.closed_at)) v(date)
    WHERE d.debt_type IN ('收益凭证','同业拆借') AND v.date BETWEEN $1::date AND $2::date ORDER BY date`,[calendarStart,calendarEnd])).rows.map(row => row.date);
  const eventDates = new Set(availableDates.filter(date => date <= reportDate || date >= calendarStart && date <= calendarEnd));
  for (const row of rows) if (row.expiry_date) eventDates.add(String(row.expiry_date));
  const snapshotDates = new Set([reportDate,...eventDates,...usageDates,...(previousDate ? [previousDate] : [])]);
  for (const date of [...eventDates,...usageDates]) snapshotDates.add(addDays(date,-1));
  const financeDates = [...new Set([reportDate,...(previousDate ? [previousDate] : []),
    ...[...snapshotDates].filter(date => date >= addDays(calendarStart,-1) && date <= calendarEnd)])].sort();
  const usage = (await client.query<UsageRow>(`SELECT to_char(d.date,'YYYY-MM-DD') AS date,m.institution_name,
    CASE u.debt_type WHEN '收益凭证' THEN 'yield_certificate' ELSE 'interbank_lending' END AS item_type,
    (sum(u.amount)/100000000)::float8 AS amount
    FROM unnest($1::date[]) d(date) CROSS JOIN LATERAL financing.credit_usage_as_of(d.date) u
    JOIN credit.institution_client m ON m.client_id=u.client_id GROUP BY d.date,m.institution_name,u.debt_type`,[financeDates])).rows;
  const cache = new Map<string,CreditInstitutionView[]>();
  const snapshot = (date:string) => {
    let value=cache.get(date);
    if (!value) { value=[...statesAt(rows,date).values()].map(state => institutionView(state,date,links,usage)); cache.set(date,value); }
    return value;
  };
  const current = snapshot(reportDate).sort(compareCreditInstitutionOrder);
  const previous = previousDate ? snapshot(previousDate) : [];
  const allNews: CreditWeeklyNewsItem[] = [];
  const calendarEvents: CreditCalendarEvent[] = [];
  for (const date of [...eventDates].sort()) {
    if (date < firstDate || date > reportDate && (date < calendarStart || date > calendarEnd)) continue;
    // The first import is a baseline, not 160 new approvals on the import date.
    if (date === firstDate) continue;
    const news = buildWeeklyCreditNews(snapshot(date),snapshot(addDays(date,-1)),date,addDays(date,-1));
    allNews.push(...news);
    if (date >= calendarStart && date <= calendarEnd) {
      const before = new Map(snapshot(addDays(date,-1)).map(row => [row.institutionName,row]));
      for (const row of snapshot(date)) {
        const prior = before.get(row.institutionName);
        if (!prior || row.status !== 'approved' || news.some(event => event.institutionName === row.institutionName)) continue;
        if (row.detail !== prior.detail || row.items.some(item => item.limitAmount !== prior.items.find(value => value.type === item.type)?.limitAmount)) {
          calendarEvents.push({id:`credit:amendment:${row.institutionName}:${date}`,date,type:'added',kind:'amendment',institutionName:row.institutionName,
            label:`授信调整 · ${formatCalendarAmount(row.totalLimit)}亿元`,...calendarState(date,reportDate,'amendment')});
        }
      }
    }
    if (date >= calendarStart && date <= calendarEnd) calendarEvents.push(...news.map(event => calendarCreditEvent(event,reportDate)));
  }
  // Baseline effective dates and future maturities are scheduled from the state valid on that date.
  for (const institution of current) {
    const dates: Array<[string | null,'new'|'expiry']> = [[institution.effectiveDate,'new'],[institution.expiryDate,'expiry']];
    for (const [date,kind] of dates) {
      if (!date || date < calendarStart || date > calendarEnd || institution.status !== 'approved') continue;
      if (kind === 'new' && date > firstDate || kind === 'expiry' && date > firstDate && date <= reportDate) continue;
      if (calendarEvents.some(event => event.date===date && event.institutionName===institution.institutionName && event.kind===kind)) continue;
      calendarEvents.push({id:`credit:${kind}:${institution.institutionName}:${date}`,date,type:kind==='expiry'?'expiry':'added',kind,
        institutionName:institution.institutionName,label:`${kind==='expiry'?'授信到期':'授信新增'} · ${formatCalendarAmount(institution.totalLimit)}亿元`,
        ...calendarState(date,reportDate,kind)});
    }
  }
  for (const date of [...new Set([...usageDates,...availableDates.filter(date => date>=calendarStart && date<=calendarEnd)])].sort()) {
    if (date <= firstDate) continue;
    const before = new Map(snapshot(addDays(date,-1)).map(row => [row.institutionName,row]));
    for (const institution of snapshot(date)) for (const item of institution.items) {
      const prior = before.get(institution.institutionName)?.items.find(row => row.type===item.type);
      // Missing client associations are unknown, not a zero balance.
      if (item.usedAmount == null || prior && prior.usedAmount == null) continue;
      const delta = item.usedAmount-(prior?.usedAmount ?? 0);
      if (Math.abs(delta)<=AMOUNT_TOLERANCE) continue;
      calendarEvents.push({id:`usage:${institution.institutionName}:${item.type}:${date}`,date,type:'usage',kind:'usage',institutionName:institution.institutionName,
        label:`${creditItemLabels[item.type]} · ${delta>=0?'+':'-'} ${formatCalendarAmount(Math.abs(delta))} 亿元`,
        ...calendarState(date,reportDate,'usage')});
    }
  }
  const weeklyNews=previousDate ? allNews.filter(event => event.reportDate>previousDate && event.reportDate<=reportDate) : [];
  const sixMonths = new Date(`${reportDate}T00:00:00Z`); sixMonths.setUTCMonth(sixMonths.getUTCMonth()-6);
  const recentApprovals=allNews.filter(event => event.reportDate>=sixMonths.toISOString().slice(0,10) && event.reportDate<=reportDate && isApprovalEvent(event)).reverse();
  const summary=toSummary(reportDate,current);
  return {availableDates,previousDate,summary,previousSummary:previousDate?toSummary(previousDate,previous):null,
    weeklySummary:{...summary,addedInstitutionCount:weeklyNews.filter(event=>event.eventType==='new').length,
      expiredInstitutionCount:weeklyNews.filter(event=>event.eventType==='expiry'||event.eventType==='revocation').length},
    previousWeeklySummary:previousDate?{...toSummary(previousDate,previous),addedInstitutionCount:0,expiredInstitutionCount:0}:null,
    institutions:current,weeklyNews,recentApprovals,limitChanges:weeklyNews.filter(isApprovalEvent).map(toLimitChange),
    usageChanges:previousDate?compareCreditSnapshots(current,previous,'usage'):[],
    calendarEvents:calendarEvents.sort((a,b)=>a.date.localeCompare(b.date)||a.institutionName.localeCompare(b.institutionName,'zh-CN')||a.id.localeCompare(b.id))};
}

export async function saveCreditInstitution(client: DatabaseClient,input: CreditInstitutionUpdateInput,createdBy: string | null = null,create = false): Promise<CreditInstitutionUpdateResponse> {
  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('credit.excel_import',0))");
    const existing = await client.query('SELECT id FROM credit.state_as_of($1::date) WHERE institution_name=$2',[input.reportDate,input.institutionName]);
    if (!create && !existing.rows.length) throw new CreditDatabaseError(404,'该授信记录不存在');
    if (create && existing.rows.length) throw new CreditDatabaseError(409,'该授信机构已存在，请在详情中维护');
    await client.query('SELECT credit.append_diff($1::date,$2,$3::jsonb,$4) AS id',
      [input.reportDate,input.institutionName,JSON.stringify(toCreditDiffPatch(input.changes)),createdBy]);
    const report=await loadCreditReport(client,input.reportDate);
    await client.query('COMMIT');
    return {institution:report.institutions.find(row=>row.institutionName===input.institutionName)!,summary:report.summary,
      weeklySummary:report.weeklySummary,weeklyNews:report.weeklyNews,recentApprovals:report.recentApprovals,
      limitChanges:report.limitChanges,usageChanges:report.usageChanges,calendarEvents:report.calendarEvents};
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>undefined);
    if (error instanceof Error && error.message === 'Credit expiry precedes effective date') throw new CreditDatabaseError(400,'授信到期日不能早于生效日');
    throw error;
  }
}

function addDays(date:string,days:number):string { const value=new Date(`${date}T00:00:00Z`);value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10); }
function formatCalendarAmount(value:number|null):string { return value == null ? '未登记' : Number(value.toFixed(6)).toString(); }
function calendarState(date:string,asOf:string,kind:string):Pick<CreditCalendarEvent,'status'|'statusLabel'> {
  return {status:date>asOf?'upcoming':date===asOf?'due':'completed',statusLabel:date>asOf?'待生效':kind==='expiry'?'已到期':'已生效'};
}
function calendarCreditEvent(event:CreditWeeklyNewsItem,asOf:string):CreditCalendarEvent {
  const labels:Record<CreditEventType,string>={new:'授信新增',renewal:'授信续作',increase:'授信扩额',decrease:'授信缩额',amendment:'授信调整',expiry:'授信到期',revocation:'授信撤销'};
  return {id:`credit:${event.eventType}:${event.institutionName}:${event.reportDate}`,date:event.reportDate,
    type:event.eventType==='expiry'||event.eventType==='revocation'?'expiry':'added',kind:event.eventType==='revocation'?'revoked':event.eventType,
    institutionName:event.institutionName,label:`${labels[event.eventType]} · ${formatCalendarAmount(event.currentAmount)}亿元`,
    ...calendarState(event.reportDate,asOf,event.eventType)};
}

export function compareCreditSnapshots(
  currentInstitutions: CreditInstitutionView[],
  previousInstitutions: CreditInstitutionView[],
  mode: "limit" | "usage",
): CreditAmountChange[] {
  if (mode === "limit") {
    return buildWeeklyCreditNews(currentInstitutions, previousInstitutions)
      .filter(isApprovalEvent)
      .map(toLimitChange);
  }

  const currentByName = new Map(
    currentInstitutions.map((institution) => [institution.institutionName, institution]),
  );
  const previousByName = new Map(
    previousInstitutions.map((institution) => [institution.institutionName, institution]),
  );
  const institutionNames = new Set([...currentByName.keys(), ...previousByName.keys()]);
  const changes: CreditAmountChange[] = [];

  for (const institutionName of institutionNames) {
    const current = currentByName.get(institutionName);
    const previous = previousByName.get(institutionName);
    const previousAmount = amountForMode(previous, mode);
    const currentAmount = amountForMode(current, mode);
    const details: string[] = [];
    if (different(previousAmount, currentAmount)) {
      details.push(`总已用 ${amountTransition(previousAmount, currentAmount)}`);
    }
    for (const type of creditItemTypes) {
      const previousItem = previous?.items.find((item) => item.type === type);
      const currentItem = current?.items.find((item) => item.type === type);
      const previousValue = previous?.status === "approved"
        ? previousItem?.usedAmount ?? 0
        : 0;
      const currentValue = current?.status === "approved"
        ? currentItem?.usedAmount ?? 0
        : 0;
      if (different(previousValue, currentValue)) {
        details.push(
          `${creditItemLabels[type]}已用 ${amountTransition(previousValue, currentValue)}`,
        );
      }
    }
    if (!previous && current && details.length > 0) {
      details.unshift("新增授信主体");
    }
    if (previous && !current && details.length > 0) {
      details.unshift("本期不再出现");
    }
    if (details.length === 0) continue;
    changes.push({
      institutionName,
      institutionType: current?.institutionType ?? previous?.institutionType ?? "未分类",
      kind: !previous ? "added" : !current ? "removed" : "changed",
      previousAmount,
      currentAmount,
      deltaAmount: currentAmount - previousAmount,
      details,
    });
  }

  return changes.sort(
    (left, right) =>
      Math.abs(right.deltaAmount) - Math.abs(left.deltaAmount) ||
      left.institutionName.localeCompare(right.institutionName, "zh-CN"),
  );
}

export function buildWeeklyCreditNews(
  currentInstitutions: CreditInstitutionView[],
  previousInstitutions: CreditInstitutionView[],
  reportDate = currentInstitutions[0]?.reportDate ?? "",
  previousReportDate = previousInstitutions[0]?.reportDate ?? "",
): CreditWeeklyNewsItem[] {
  const currentByName = new Map(
    currentInstitutions.map((institution) => [institution.institutionName, institution]),
  );
  const previousByName = new Map(
    previousInstitutions.map((institution) => [institution.institutionName, institution]),
  );
  const institutionNames = new Set([...currentByName.keys(), ...previousByName.keys()]);
  const news: CreditWeeklyNewsItem[] = [];

  for (const institutionName of institutionNames) {
    const current = currentByName.get(institutionName);
    const previous = previousByName.get(institutionName);
    const previousAmount = previous ? numberValue(previous.totalLimit) : 0;
    const currentAmount = current ? numberValue(current.totalLimit) : 0;
    const eventType = classifyInstitutionEvent(
      current,
      previous,
      currentAmount,
      previousAmount,
      reportDate,
      previousReportDate,
    );
    if (!eventType) continue;
    const detailSource = current ?? previous;

    news.push({
      reportDate,
      previousReportDate,
      institutionName,
      institutionType: current?.institutionType ?? previous?.institutionType ?? "未分类",
      eventType,
      previousStatus: previous?.status ?? null,
      currentStatus: current?.status ?? null,
      previousAmount,
      currentAmount,
      deltaAmount: currentAmount - previousAmount,
      previousEffectiveDate: previous?.effectiveDate ?? null,
      currentEffectiveDate: current?.effectiveDate ?? null,
      previousExpiryDate: previous?.expiryDate ?? null,
      currentExpiryDate: current?.expiryDate ?? null,
      creditDetails: (detailSource?.items ?? [])
        .filter((item) => item.limitAmount != null || Boolean(item.details?.trim()))
        .map((item) => ({
          type: item.type,
          limitAmount: item.limitAmount,
          details: item.details,
        })),
    });
  }

  return news;
}

function classifyInstitutionEvent(
  current: CreditInstitutionView | undefined,
  previous: CreditInstitutionView | undefined,
  currentAmount: number,
  previousAmount: number,
  reportDate: string,
  previousReportDate: string,
): CreditEventType | null {
  if (current && previous && current.status === "revoked" && previous.status !== "revoked") {
    return "revocation";
  }
  const hasApprovedPeriod = current?.status === "approved" || previous?.status === "approved";
  if (
    current &&
    previous &&
    hasApprovedPeriod &&
    currentAmount > previousAmount + AMOUNT_TOLERANCE
  ) {
    return "increase";
  }
  if (current && previous && hasApprovedPeriod && currentAmount < previousAmount - AMOUNT_TOLERANCE) return 'decrease';
  if (
    current &&
    previous &&
    hasApprovedPeriod &&
    current.expiryDate &&
    current.expiryDate !== previous.expiryDate
  ) {
    return "renewal";
  }
  if (current?.status === "approved" && previous?.status !== "approved") {
    return "new";
  }
  if (previous?.status !== "approved") return null;
  const expiryDate = current?.expiryDate ?? previous.expiryDate;
  if (!current) {
    return isDateInComparisonWindow(expiryDate, previousReportDate, reportDate)
      ? "expiry"
      : "revocation";
  }
  return isDateInComparisonWindow(expiryDate, previousReportDate, reportDate)
    ? "expiry"
    : null;
}

function toLimitChange(news: CreditWeeklyNewsItem): CreditAmountChange {
  const details: string[] = [];
  if (news.eventType === "new") {
    details.push("新增授信主体");
  }
  if (news.eventType === "increase") {
    details.push(`授信总额 ${amountTransition(news.previousAmount, news.currentAmount)}`);
  }
  if (news.eventType === "renewal") {
    details.push(
      `到期日 ${news.previousExpiryDate ?? "未登记"} → ${news.currentExpiryDate ?? "未登记"}`,
    );
  }
  return {
    institutionName: news.institutionName,
    institutionType: news.institutionType,
    kind: news.eventType === "new" ? "added" : "changed",
    previousAmount: news.previousAmount,
    currentAmount: news.currentAmount,
    deltaAmount: news.deltaAmount,
    details,
  };
}

function isApprovalEvent(news: CreditWeeklyNewsItem): boolean {
  return news.eventType === "new" || news.eventType === "renewal" || news.eventType === "increase";
}

function toSummary(
  reportDate: string,
  institutions: CreditInstitutionView[],
): CreditSummaryView {
  const approved = institutions.filter((institution) => institution.status === "approved");
  const totalLimit = sumAmounts(approved.map((institution) => institution.totalLimit));
  const totalUsed = sumAmounts(approved.map((institution) => institution.totalUsed));
  const totalAvailable = sumAmounts(
    approved.map((institution) => institution.availableAmount),
  );
  return {
    reportDate,
    institutionCount: institutions.filter((institution) => institution.status !== "revoked").length,
    approvedCount: approved.length,
    totalLimit,
    totalUsed,
    totalAvailable,
    utilization: totalLimit > 0 ? (totalUsed / totalLimit) * 100 : 0,
    expiringWithin30Days: approved.filter((institution) => {
      if (!institution.expiryDate) return false;
      const days = dayDifference(reportDate, institution.expiryDate);
      return days >= 0 && days <= 30;
    }).length,
  };
}

function amountForMode(
  institution: CreditInstitutionView | undefined,
  mode: "limit" | "usage",
): number {
  if (institution?.status !== "approved") return 0;
  return mode === "limit"
    ? institution.totalLimit ?? 0
    : institution.totalUsed ?? 0;
}

function amountTransition(previous: number, current: number): string {
  const delta = current - previous;
  return `${previous.toFixed(2)} → ${current.toFixed(2)} 亿元（${delta >= 0 ? "+" : ""}${delta.toFixed(2)}）`;
}

function different(left: number, right: number): boolean {
  return Math.abs(left - right) > AMOUNT_TOLERANCE;
}

function dayDifference(start: string, end: string): number {
  return Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
  );
}

function isDateInComparisonWindow(
  value: string | null | undefined,
  previousReportDate: string,
  reportDate: string,
): boolean {
  return Boolean(
    value &&
    previousReportDate &&
    reportDate &&
    value > previousReportDate &&
    value <= reportDate,
  );
}

function nullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberValue(value: unknown): number {
  return nullableNumber(value) ?? 0;
}

function sumAmounts(values: Array<number | null>): number {
  const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return Math.round(total * 1_000_000) / 1_000_000;
}
