// Visual/DOM fixtures provide canonical facts to the real browser builder.
// This adapter is test-only; production never accepts assembled report DTOs.
export function creditDataFixture(report) {
  const reportDate=report.summary.reportDate,previousDate=report.previousDate;
  const month=reportDate.slice(0,7),shift=(date,n)=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
  const savedStates=[],usage=[],links=[],rows=[],usageEventRows=[];
  const states=new Map();
  const rowFor=(institution,date)=>{
    const state={institution_name:institution.institutionName,institution_type:institution.institutionType,
      status:institution.status,confidentiality_status:institution.confidentialityStatus,total:institution.totalLimit,
      effective_date:institution.effectiveDate,expiry_date:institution.expiryDate,last_changed_on:institution.lastChangedOn,
      bank_office:institution.bankOffice,applying_department:institution.applyingDepartment,handler:institution.handler,
      detail:institution.detail,notes:institution.notes,bond_preference:institution.bondPreference,
      updated_at:institution.updatedAt,created_at:institution.updatedAt,bond_investment_secondary_used:0};
    const items=institution.items?.length?institution.items:[{type:'other',usedAmount:institution.totalUsed,details:null}];
    for(const item of items){state[item.type+'_limit']=item.limitAmount;state[item.type+'_detail']=item.details;
      state[item.type+'_used']=item.usedAmount;if(item.type==='bond_investment')state.bond_investment_secondary_used=item.secondaryUsedAmount??0;
      if(['bond_investment','yield_certificate','interbank_lending'].includes(item.type))usage.push({date,institution_name:institution.institutionName,item_type:item.type,amount:item.primaryUsedAmount??(item.type==='bond_investment'?(item.usedAmount??0)-(item.secondaryUsedAmount??0):item.usedAmount??0)});
    }
    const record={date,data:state,previous_period:institution.previousPeriod??null};states.set(date+':'+institution.institutionName,record);return state;
  };
  const institutions=report.institutions;
  for(const institution of institutions){rowFor(institution,reportDate);if(previousDate)rowFor(report.previousInstitutions?.find(i=>i.institutionName===institution.institutionName)??institution,previousDate);
    for(const client of institution.clients??[])links.push({institution_name:institution.institutionName,id:client.id,name:client.name});
  }
  for(const event of [...(report.recentApprovals??[]),...(report.weeklyNews??[])]){
    const institution=institutions.find(i=>i.institutionName===event.institutionName)??{...institutions[0],institutionName:event.institutionName};
    const beforeDate=shift(event.reportDate,-1);
    if(!states.has(beforeDate+':'+institution.institutionName))rowFor({...institution,totalLimit:event.previousAmount,effectiveDate:event.previousEffectiveDate,expiryDate:event.previousExpiryDate},beforeDate);
    if(!states.has(event.reportDate+':'+institution.institutionName))rowFor({...institution,totalLimit:event.currentAmount,effectiveDate:event.currentEffectiveDate,expiryDate:event.currentExpiryDate},event.reportDate);
    if(!rows.some(r=>r.effective_on===event.reportDate&&r.institution_name===institution.institutionName))rows.push({institution_name:institution.institutionName,effective_on:event.reportDate,type:event.eventType,expiry_date:event.currentExpiryDate});
  }
  savedStates.push(...states.values());
  const sixMonths=new Date(reportDate+'T00:00:00Z');sixMonths.setUTCMonth(sixMonths.getUTCMonth()-6);
  return {reportDate,previousDate,calendarMonth:month,calendarStart:shift(month+'-01',-6),calendarEnd:shift(month+'-01',41),
    sixMonthStart:sixMonths.toISOString().slice(0,10),availableDates:[...report.availableDates].sort(),savedStates,usage,links,rows,usageEventRows};
}

export function creditDataPatch(report,input){
  const data=creditDataFixture(report),name=input.institutionName;
  for(const key of ['rows','links','usageEventRows','usage'])data[key]=data[key].filter(row=>row.institution_name===name);
  data.savedStates=data.savedStates.filter(row=>row.data.institution_name===name);
  return {institutionName:name,viewDate:input.viewDate,calendarMonth:input.calendarMonth,scope:'institution',data};
}
