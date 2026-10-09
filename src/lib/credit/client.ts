import type {
  CreditInstitutionUpdateResponse,
  CreditReportResponse,
} from "./types.ts";
import type { CreditInstitutionUpdateInput } from "./update.ts";

import {buildCreditReport} from './build-report.ts';
import type {CreditDataset} from './data.ts';

export async function fetchCreditData(
  reportDate: string | null = null,
  fetcher: typeof fetch = fetch,
  month?: string,
): Promise<CreditDataset> {
  const params = new URLSearchParams();
  if (reportDate) params.set('date',reportDate);
  if (month) params.set('month',month);
  const query = params.size ? `?${params}` : '';
  const response = await fetcher(`/api/credit${query}`, {
    headers: { Accept: "application/json" },
  });
  const payload=await response.json().catch(()=>({})) as Partial<CreditDataset>&{error?:string;detail?:string};
  if(!response.ok)throw new Error(payload.error||payload.detail||'授信数据加载失败');
  if(!isCreditDataset(payload))throw new Error('授信接口返回的数据结构无效');
  return payload as CreditDataset;
}

export async function fetchCreditReport(reportDate:string|null=null,fetcher:typeof fetch=fetch,month?:string):Promise<CreditReportResponse>{
  return buildCreditReport(await fetchCreditData(reportDate,fetcher,month));
}

export async function updateCreditInstitution(
  input: CreditInstitutionUpdateInput,
  fetcher: typeof fetch = fetch,
  create = false,
): Promise<CreditInstitutionUpdateResponse> {
  const response = await fetcher("/api/credit", {
    method: create ? "POST" : "PATCH",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({})) as
    Partial<CreditInstitutionUpdateResponse> & { error?: string; detail?: string };
  if (!response.ok) {
    throw new Error(payload.error || payload.detail || "授信数据保存失败");
  }
  if(typeof payload.institutionName!=='string'||!payload.institutionName||typeof payload.viewDate!=='string'||typeof payload.calendarMonth!=='string'||!['institution','context'].includes(payload.scope??'')||!isCreditDataset(payload.data)||payload.data.reportDate!==payload.viewDate||payload.data.calendarMonth!==payload.calendarMonth)throw new Error('授信保存接口返回的数据结构无效');
  const data=payload.data,name=payload.institutionName;
  if(payload.scope==='institution'&&(![...data.rows,...data.links,...data.usageEventRows,...data.usage].every(row=>row.institution_name===name)||!data.savedStates.every(row=>row.data.institution_name===name))
    ||payload.scope==='context'&&(!data.usage.filter(row=>row.date===data.reportDate).every(row=>row.institution_name===name)||!data.savedStates.filter(row=>row.date===data.reportDate).every(row=>row.data.institution_name===name)))throw new Error('授信保存接口返回的数据范围无效');
  return payload as CreditInstitutionUpdateResponse;
}

function isCreditDataset(value:unknown):value is CreditDataset {
  if(!value||typeof value!=='object')return false;
  const p=value as Record<string,unknown>;
  const date=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v);
  const object=(v:unknown):v is Record<string,unknown>=>Boolean(v)&&typeof v==='object';
  return date(p.reportDate)&&(p.previousDate===null||date(p.previousDate))&&date(p.calendarStart)&&date(p.calendarEnd)&&date(p.sixMonthStart)
    &&typeof p.calendarMonth==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(p.calendarMonth)
    &&Array.isArray(p.availableDates)&&p.availableDates.length>0&&p.availableDates.every(date)
    &&Array.isArray(p.rows)&&p.rows.every(r=>object(r)&&typeof r.institution_name==='string'&&date(r.effective_on)&&typeof r.type==='string')
    &&Array.isArray(p.links)&&p.links.every(r=>object(r)&&typeof r.institution_name==='string'&&typeof r.id==='string'&&typeof r.name==='string')
    &&Array.isArray(p.usageEventRows)&&p.usageEventRows.every(r=>object(r)&&date(r.date)&&typeof r.institution_name==='string')
    &&Array.isArray(p.usage)&&p.usage.every(r=>object(r)&&date(r.date)&&typeof r.institution_name==='string'&&typeof r.item_type==='string'&&typeof r.amount==='number'&&Number.isFinite(r.amount))
    &&Array.isArray(p.savedStates)&&p.savedStates.every(r=>object(r)&&date(r.date)&&object(r.data)&&typeof r.data.institution_name==='string'
      &&(r.previous_period===null||object(r.previous_period)&&date(r.previous_period.effectiveDate)&&date(r.previous_period.expiryDate)));
}
