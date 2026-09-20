import {test, expect} from '@playwright/test';
import {mockResources} from './fixtures.mjs';
import {financingModel} from './report-fixtures.mjs';

test('financing-model preserves its approved report layout',async({page})=>{
  const errors=[];
  page.on('pageerror', error=>errors.push(error.message));
  await page.clock.setFixedTime(new Date('2026-09-15T11:00:00+08:00'));
  const requests=await mockResources(page);
  await page.goto('/trading-research/financing-model');
  await expect(page.getByText('推荐发行',{exact:true}).first()).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.evaluate(()=>document.fonts.ready);
  await expect(page).toHaveScreenshot('financing-model.png',{fullPage:true});
  expect(errors).toEqual([]);expect(requests).toEqual([]);
});


test('financing-model shows online results and switches to legacy history', async ({page}) => {
  const errors=[];
  page.on('pageerror', error=>errors.push(error.message));
  const requests = await mockResources(page);
  const online = structuredClone(financingModel);
  online.snapshot.run_id = '00000000-0000-4000-8000-000000000025';
  online.snapshot.as_of_date = '2026-08-25';
  online.snapshot.company_metrics = null;
  online.snapshot.prediction.recommendation_label = '建议等待';
  online.snapshot.prediction.decision = '建议等待';
  online.conclusion.verdict = '建议等待';
  online.snapshot.driver_structure = [
    ['funding','资金面',55], ['equity','权益市场',48], ['primary','一级供给',52],
    ['secondary_bond','可比债',46], ['macro','宏观经济',51], ['proprietary','公司业务',50],
  ].map(([category,display_name,support_score])=>({category,display_name,support_score,support_bp:(support_score-50)/10,importance_weight:category==='proprietary'?0:0.2}));
  online.snapshot.market_drivers = [
    ['dr007','DR007',-0.8], ['weighted_cost','一级加权成本',0.5],
    ['credit_spread','信用利差',0.3], ['csi300_ret_5d','沪深300五日收益',-0.2], ['m2','M2同比',0.1],
  ].map(([feature,display_name,shap])=>({feature,display_name,shap,value:1,impact:shap>0?'推高成本':'降低成本'}));

  online.snapshot.online_run = {
    model_version: '0123456789abcdef0123', feature_version: 'online-market-v1',
    training_as_of: '2026-08-01', retrain_after: '2027-02-01',
    excluded_groups: ['secondary_bond', 'company'], runtime: 'cloudflare-workflow',
  };
  online.versions.unshift({runId:online.snapshot.run_id, asOfDate:'2026-08-25', generatedAt:online.snapshot.generated_at});
  const legacy = {...structuredClone(financingModel), versions:online.versions};
  await page.route('**/api/financing-model?*', route => route.fulfill({json:legacy}));
  await page.route('**/api/financing-model', route => route.fulfill({json:online}));
  await page.goto('/trading-research/financing-model');
  await expect(page.getByText('建议等待',{exact:true}).first()).toBeVisible();
  await expect(page.getByRole('heading',{name:'业务指标',exact:true})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'未来发行窗口',exact:true})).toBeVisible();
  await page.evaluate(()=>document.fonts.ready);
  await expect(page).toHaveScreenshot('financing-model-online.png',{fullPage:false});
  await page.getByRole('combobox',{name:'融资择时模型日期版本'}).selectOption(financingModel.snapshot.run_id);
  await expect(page.getByRole('heading',{name:'业务指标',exact:true})).toBeVisible();
  expect(errors).toEqual([]);expect(requests).toEqual([]);
});
