import {assistantSession} from './audit-fixtures.mjs';

export const assistantRunning={...assistantSession,turns:[],running:true,
 pendingQuestion:'请核实公司最新流动性指标，并结合原始报告说明尚需业务部门确认的事项。',
 progress:'正在复核跨期数据与材料来源',activities:[
  {id:1,stage:'scope',message:'已确认本次核查范围。',startedAt:0},
  {id:2,stage:'retrieval',message:'已检索年度报告和半年度报告。',startedAt:0},
  {id:3,stage:'read',message:'正在核对原始报告中的流动性指标及报告日期。',startedAt:0},
  {id:4,stage:'retrieval',message:'补充检索最新月份披露，确认数据是否覆盖所需期间。',startedAt:0},
  {id:5,stage:'review',message:'正在复核计算结果、引用来源与尚待确认的事项。',startedAt:0},
 ]};
export const assistantFailed={...assistantRunning,running:false,error:'资料检索暂不可用，请稍后重试。'};
export const assistantRecovered={...assistantSession,turns:[{...assistantSession.turns[0],question:assistantRunning.pendingQuestion}]};
