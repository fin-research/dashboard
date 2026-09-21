import type { IssuanceSnapshot } from '../lib/issuance-model';
import { colors, axisLabel, gridLine, tooltip } from './common';
import { setChart, setEmpty } from './charting';

export function issuanceFeatureName(name:string):string {
  const fixed:Record<string,string>={dr007:'DR007',dr007_vs_policy:'资金利率与政策利率差',r007_dr007_spread:'R007与DR007利差',shibor_3m:'SHIBOR 3M',gov_10y:'10年国债',term_spread:'期限利差',credit_spread:'信用利差',funding_credit_stress:'资金与信用压力',curve_curvature:'曲线曲率',short_term_spread:'短端期限利差',cdb_gov_spread:'国开与国债利差',decision_weekday:'决策星期',decision_month_end:'决策距月末',day_of_week:'报价星期',month:'月份',is_month_end:'月末',is_quarter_end:'季末',is_year_end:'年末',days_to_month_end:'距月末',days_to_quarter_end:'距季末',is_mlf_week:'MLF窗口'};
  if(fixed[name])return fixed[name];
  const curve=name.match(/^rate_(gov_1y|gov_3y|gov_10y|aaa_3y)_(level|change_\d+|deviation_\d+|volatility_\d+)$/);
  if(curve){const bond:Record<string,string>={gov_1y:'1年国债',gov_3y:'3年国债',gov_10y:'10年国债',aaa_3y:'3年AAA'};const suffix=curve[2].replace('level','收益率').replace(/change_(\d+)/,'$1期变化').replace(/deviation_(\d+)/,'$1期均值偏离').replace(/volatility_(\d+)/,'$1期波动');return `${bond[curve[1]]}·${suffix}`;}
  return name.replace('dr007','DR007').replace('credit_spread','信用利差').replace('term_spread','期限利差').replace('gov_10y','10年国债').replace('yield_vol','收益率波动').replace('pctile','分位').replace('vol','波动').replace('ma','均值').replace('chg','变化').replace('slope','斜率').replace('trend','趋势').replace('dev','偏离').replaceAll('_','·');
}
export function renderIssuanceForecast(host:HTMLElement,rows:IssuanceSnapshot['forecast']):void {
  if(!rows.length){setEmpty(host,'窗口内无发行日期');return;}
  setChart(host,{animationDuration:180,aria:{enabled:true},tooltip:{...tooltip,trigger:'axis'},legend:{top:0,textStyle:axisLabel},
    grid:{left:12,right:16,top:45,bottom:10,containLabel:true},
    xAxis:{type:'category',data:rows.map(r=>r.date),axisLabel:{...axisLabel,formatter:(v:string)=>v.slice(5)},axisTick:{show:false}},
    yAxis:[{type:'value',name:'票面 %',scale:true,axisLabel,splitLine:gridLine},{type:'value',name:'净节约 bp',axisLabel,splitLine:{show:false}}],
    series:[{name:'预计票面',type:'line',data:rows.map(r=>r.coupon_percent),itemStyle:{color:colors.brand}},
      {name:'区间下限',type:'line',data:rows.map(r=>r.coupon_low_percent),lineStyle:{type:'dashed',opacity:.5},symbol:'none',itemStyle:{color:colors.quiet}},
      {name:'区间上限',type:'line',data:rows.map(r=>r.coupon_high_percent),lineStyle:{type:'dashed',opacity:.5},symbol:'none',itemStyle:{color:colors.quiet}},
      {name:'净节约',type:'bar',yAxisIndex:1,data:rows.map(r=>r.net_saving_bp),itemStyle:{color:colors.green,opacity:.4}}]});
}
export function renderIssuanceMarket(host:HTMLElement,rows:IssuanceSnapshot['market_forecast']):void {
  setChart(host,{aria:{enabled:true},tooltip:{...tooltip,trigger:'axis'},grid:{left:12,right:16,top:30,bottom:10,containLabel:true},
    xAxis:{type:'category',data:rows.map(r=>r.date),axisLabel:{...axisLabel,formatter:(v:string)=>v.slice(5)}},
    yAxis:{type:'value',name:'AAA 3Y %',scale:true,axisLabel,splitLine:gridLine},
    series:[{name:'市场利率',type:'line',data:rows.map(r=>r.market_level_percent),symbol:'none',itemStyle:{color:colors.brand}}]});
}
