import type {CreditItemType} from './types.ts';

export type CreditFactRow=Record<string,unknown>&{institution_name:string;effective_on:string;type:string;expiry_date?:string|null;updated_at?:string;created_at?:string};
export type CreditClientLink={institution_name:string;id:string;name:string};
export type CreditUsageRow={date:string;institution_name:string;item_type:CreditItemType;amount:number};
export type CreditDataState={date:string;data:Record<string,unknown>&{institution_name:string;created_at?:string;updated_at?:string};previous_period:{effectiveDate:string;expiryDate:string}|null};
/** Canonical database facts; no formatted report rows or derived totals. */
export interface CreditDataset {
  availableDates:string[];reportDate:string;previousDate:string|null;calendarMonth:string;
  calendarStart:string;calendarEnd:string;sixMonthStart:string;
  rows:CreditFactRow[];links:CreditClientLink[];usageEventRows:Array<{date:string;institution_name:string}>;
  usage:CreditUsageRow[];savedStates:CreditDataState[];
}

/** A scoped empty collection removes the institution's obsolete facts. */
export function applyCreditDataUpdate(current:CreditDataset,update:import('./types.ts').CreditInstitutionUpdateResponse,calendarMonth:string):CreditDataset {
  if(current.reportDate!==update.viewDate||calendarMonth!==update.calendarMonth)return current;
  if(update.scope==='context')return {...update.data,
    savedStates:[...current.savedStates.filter(r=>r.date===current.reportDate&&r.data.institution_name!==update.institutionName),...update.data.savedStates],
    usage:[...current.usage.filter(r=>r.date===current.reportDate&&r.institution_name!==update.institutionName),...update.data.usage]};
  const next=update.data;
  const replace=<T extends {institution_name:string}>(rows:T[],newRows:T[])=>[...rows.filter(r=>r.institution_name!==update.institutionName),...newRows];
  return {...next,rows:replace(current.rows,next.rows),links:replace(current.links,next.links),
    usageEventRows:replace(current.usageEventRows,next.usageEventRows),usage:replace(current.usage,next.usage),
    savedStates:[...current.savedStates.filter(r=>r.data.institution_name!==update.institutionName),...next.savedStates]};
}
