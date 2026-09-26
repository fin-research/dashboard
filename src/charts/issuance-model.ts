import type { IssuanceSnapshot } from '../lib/issuance-model';
import { colors, axisLabel, gridLine, tooltip, escapeHtml } from './common';
import { setChart, setEmpty } from './charting';

export function issuanceFeatureName(name:string):string {
  const fixed:Record<string,string>={dr007:'DR007',dr007_vs_policy:'资金利率与政策利率差',r007_dr007_spread:'R007与DR007利差',shibor_3m:'SHIBOR 3M',gov_10y:'10年国债',term_spread:'期限利差',credit_spread:'信用利差',credit_spread_pctile_60d:'信用利差P60',funding_credit_stress:'资金与信用压力',curve_curvature:'曲线曲率',short_term_spread:'短端期限利差',cdb_gov_spread:'国开与国债利差',decision_weekday:'决策星期',decision_month_end:'决策距月末',day_of_week:'报价星期',month:'月份',is_month_end:'月末',is_quarter_end:'季末',is_year_end:'年末',days_to_month_end:'距月末',days_to_quarter_end:'距季末',is_mlf_week:'MLF窗口',net_financing_zscore:'净融资Z值'};
  if(fixed[name])return fixed[name];
  const macro=name.match(/^macro_(GDP|CPI|PPI|PMI|SOCIAL_FINANCE|M2)_(level|change_1m|change_3m|release_age_days)$/);
  if(macro){const title=macro[1]==='SOCIAL_FINANCE'?'社融':macro[1];const part:Record<string,string>={level:'水平',change_1m:'1月变化',change_3m:'3月变化',release_age_days:'发布天数'};return `${title}·${part[macro[2]!]}`;}
  const primary=name.match(/^(supply|issue_count|net_financing|weighted_cost|maturity_wall|redemption_pressure)(?:_(5d_zscore|20d_zscore|5d|20d|zscore|chg_5d|chg_20d))?$/);
  if(primary){const title:Record<string,string>={supply:'发行额',issue_count:'发行只数',net_financing:'净融资额',weighted_cost:'加权融资成本',maturity_wall:'到期偿还',redemption_pressure:'偿付压力'};const part=primary[2]?.replace('5d','5日').replace('20d','20日').replace('zscore','标准分').replace('chg_','变化·');return `${title[primary[1]!]}${part?`·${part}`:''}`;}
  const secondary:Record<string,string>={bond_volume_20d_avg:'债券成交量·20日均值',bond_volume_chg_5d:'债券成交量·5日变化',bond_volume_pctile_60d:'债券成交量·60日分位',credit_bond_volume_ratio:'信用债成交比',credit_volume_chg_5d:'信用债成交量·5日变化',rate_credit_volume_ratio:'利率/信用成交比'};
  if(secondary[name])return secondary[name];
  const curve=name.match(/^rate_(gov_1y|gov_3y|gov_10y|aaa_3y)_(level|change_\d+|deviation_\d+|volatility_\d+)$/);
  if(curve){const bond:Record<string,string>={gov_1y:'1年国债',gov_3y:'3年国债',gov_10y:'10年国债',aaa_3y:'券商AAA3年'};const suffix=curve[2]!.replace('level','收益率').replace(/change_(\d+)/,'变化率').replace(/deviation_(\d+)/,'偏离').replace(/volatility_(\d+)/,'波动率');return `${bond[curve[1]!]}${suffix}`;}
  return name.replace('dr007','DR007').replace('credit_spread','信用利差').replace('term_spread','期限利差').replace('gov_10y','10年国债').replace('yield_vol','收益率波动').replace('pctile','分位').replace('vol','波动').replace('ma','均值').replace('chg','变化').replace('slope','斜率').replace('trend','趋势').replace('dev','偏离').replaceAll('_','·');
}
export function renderIssuanceForecast(host:HTMLElement,rows:IssuanceSnapshot['forecast']):void {
  if(!rows.length){setEmpty(host,'窗口内无发行日期');return;}
  setChart(host,{animationDuration:180,aria:{enabled:true,description:'未来发行日预计票面'},tooltip:{...tooltip,trigger:'axis'},legend:{top:0,textStyle:axisLabel},
    grid:{left:12,right:16,top:45,bottom:10,containLabel:true},
    xAxis:{type:'category',data:rows.map(r=>r.date),axisLabel:{...axisLabel,formatter:(v:string)=>v.slice(5)},axisTick:{show:false}},
    yAxis:{type:'value',name:'票面 %',scale:true,axisLabel,splitLine:gridLine},
    series:[{name:'预计票面',type:'line',data:rows.map(r=>r.coupon_percent),itemStyle:{color:colors.brand}}]});
}

export function renderIssuanceProductComparison(host:HTMLElement,rows:IssuanceSnapshot['product_scenarios']):void {
  if(!rows.length){setEmpty(host,'品种预测暂缺');return;}
  const names=rows.map(row=>`${row.tenor}年${{
    '证券公司债':'公募债','证券公司次级债':'次级债',
  }[row.bond_type]}`);
  setChart(host,{animationDuration:180,aria:{enabled:true,description:'3年与5年公募债和次级债预计票面对比'},
    legend:{top:0,textStyle:axisLabel,data:['预计票面']},
    grid:{left:12,right:80,top:35,bottom:30,containLabel:true},
    tooltip:{...tooltip,trigger:'axis',axisPointer:{type:'shadow'},formatter:(params:unknown)=>{
      const index=(params as Array<{dataIndex:number}>)[0]?.dataIndex??-1;
      const row=rows[index];if(!row)return '';
      return `<strong>${escapeHtml(names[index]??'')}</strong><br>预计票面 ${row.coupon_percent===null?'—':`${row.coupon_percent.toFixed(2)}%`}<br>同类历史 ${row.own_observations}笔本机构 / ${row.peer_observations}笔合计`;
    }},
    xAxis:{type:'value',name:'预计票面 %',scale:true,axisLabel,splitLine:{lineStyle:gridLine}},
    yAxis:{type:'category',inverse:true,data:names,axisLabel:{...axisLabel,color:colors.ink},axisTick:{show:false}},
    series:[{name:'预计票面',type:'bar',barMaxWidth:24,data:rows.map(row=>({value:row.coupon_percent,
      itemStyle:{color:colors.brand,borderRadius:[0,4,4,0]}})),
      label:{show:true,position:'right',formatter:(param:{dataIndex:number})=>rows[param.dataIndex]?.coupon_percent==null?'—':`${rows[param.dataIndex]!.coupon_percent!.toFixed(2)}%`}}]});
}
export function renderIssuanceMarket(host:HTMLElement,rows:IssuanceSnapshot['market_forecast']):void {
  setChart(host,{aria:{enabled:true},tooltip:{...tooltip,trigger:'axis'},grid:{left:12,right:16,top:30,bottom:10,containLabel:true},
    xAxis:{type:'category',data:rows.map(r=>r.date),axisLabel:{...axisLabel,formatter:(v:string)=>v.slice(5)}},
    yAxis:{type:'value',name:'AAA 3Y %',scale:true,axisLabel,splitLine:gridLine},
    series:[{name:'市场利率',type:'line',data:rows.map(r=>r.market_level_percent),symbol:'none',itemStyle:{color:colors.brand}}]});
}
