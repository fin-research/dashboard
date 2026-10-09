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
  if(typeof payload.reportDate!=='string'||!Array.isArray(payload.savedStates)||!Array.isArray(payload.usage)||!Array.isArray(payload.rows)||!Array.isArray(payload.availableDates))throw new Error('授信接口返回的数据结构无效');
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
  if(!payload.institutionName||typeof payload.viewDate!=='string'||typeof payload.calendarMonth!=='string'||!['institution','context'].includes(payload.scope??'')||!payload.data||!Array.isArray(payload.data.savedStates)||!Array.isArray(payload.data.usage))throw new Error('授信保存接口返回的数据结构无效');
  return payload as CreditInstitutionUpdateResponse;
}
