import { compareCreditInstitutionOrder } from './presentation.ts';
import type { CreditInstitutionUpdateResponse, CreditReportResponse, CreditWeeklyNewsItem } from './types.ts';

/** Replace only this institution's confirmed data, preserving other rows and controls. */
export function applyCreditUpdate(report: CreditReportResponse, update: CreditInstitutionUpdateResponse,
  calendarMonth: string): CreditReportResponse {
  if (report.summary.reportDate !== update.viewDate || calendarMonth !== update.calendarMonth) return report;
  const replace = <T extends {institutionName:string}>(old:T[],next:T[]) =>
    [...old.filter(row=>row.institutionName!==update.institutionName),...next];
  const institutions = replace(report.institutions,update.institution ? [update.institution] : []).sort(compareCreditInstitutionOrder);
  const newsOrder = (a:CreditWeeklyNewsItem,b:CreditWeeklyNewsItem)=>a.reportDate.localeCompare(b.reportDate);
  const weeklyNews=(update.comparison?.weeklyNews ?? replace(report.weeklyNews,update.weeklyNews)).sort(newsOrder);
  const previousWeeklyNews=(update.comparison?.previousWeeklyNews ?? replace(report.previousWeeklyNews ?? [],update.previousWeeklyNews ?? [])).sort(newsOrder);
  const counts=(news:CreditWeeklyNewsItem[])=>({addedInstitutionCount:news.filter(row=>row.eventType==='new').length,
    expiredInstitutionCount:news.filter(row=>row.eventType==='expiry'||row.eventType==='revocation').length});
  const calendarEvents=[...new Map([...replace(report.calendarEvents,update.calendarEvents),...(update.calendarAdditions ?? [])]
    .filter(event=>!update.calendarRemovals?.includes(event.id)).map(event=>[event.id,event])).values()]
    .sort((a,b)=>a.date.localeCompare(b.date)||a.institutionName.localeCompare(b.institutionName,'zh-CN')||a.id.localeCompare(b.id));
  return { ...report,institutions,availableDates:update.availableDates,previousDate:update.previousDate,
    summary:update.summary,previousSummary:update.previousSummary,
    weeklySummary:{...update.summary,...counts(weeklyNews)},
    previousWeeklySummary:update.previousSummary ? {...update.previousSummary,...counts(previousWeeklyNews)} : null,
    weeklyNews,previousWeeklyNews,
    recentApprovals:replace(report.recentApprovals,update.recentApprovals).sort((a,b)=>newsOrder(b,a)),
    limitChanges:update.comparison?.limitChanges ?? replace(report.limitChanges,update.limitChanges),
    usageChanges:(update.comparison?.usageChanges ?? replace(report.usageChanges,update.usageChanges)).sort((a,b)=>Math.abs(b.deltaAmount)-Math.abs(a.deltaAmount)||a.institutionName.localeCompare(b.institutionName,'zh-CN')),
    calendarEvents };
}
