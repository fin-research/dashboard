import {test, expect} from '@playwright/test';
import {mockResources} from './fixtures.mjs';
import {financingModel} from './report-fixtures.mjs';

test('financing-model preserves its approved report layout',async({page})=>{
  const errors=[];
  page.on('pageerror', error=>errors.push(error.message));
  await page.clock.setFixedTime(new Date('2026-09-15T11:00:00+08:00'));
  const requests=await mockResources(page);
  await page.goto('/trading-research/financing-model');
  await expect(page.getByText('可按资金计划发行',{exact:true}).first()).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.evaluate(()=>document.fonts.ready);
  await expect(page.locator('.tr-workspace')).toHaveScreenshot('financing-model.png');
  expect(errors).toEqual([]);expect(requests).toEqual([]);
});


test('financing-model switches between issuance model dates', async ({page}) => {
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await mockResources(page);
  const current=structuredClone(financingModel);
  current.snapshot.run_id='00000000-0000-4000-8000-000000000025';
  current.snapshot.as_of_date='2026-08-25';
  current.snapshot.decision.action='可择机等待';current.conclusion.verdict='可择机等待';
  current.versions.unshift({runId:current.snapshot.run_id,asOfDate:'2026-08-25',generatedAt:current.snapshot.generated_at});
  const previous={...structuredClone(financingModel),versions:current.versions};
  await page.route('**/api/financing-model?*',route=>route.fulfill({json:previous}));
  await page.route('**/api/financing-model',route=>route.fulfill({json:current}));
  await page.goto('/trading-research/financing-model');
  await expect(page.getByText('可择机等待',{exact:true}).first()).toBeVisible();
  await expect(page.getByRole('heading',{name:'SHAP 因子贡献',exact:true})).toBeVisible();
  await page.evaluate(()=>document.fonts.ready);
  await expect(page.locator('.tr-workspace')).toHaveScreenshot('financing-model-online.png');
  await page.getByRole('combobox',{name:'融资择时模型日期版本'}).selectOption(financingModel.snapshot.run_id);
  await expect(page.getByText('可按资金计划发行',{exact:true}).first()).toBeVisible();
  await page.getByRole('button',{name:'展开未来发行窗口明细'}).click();
  await expect(page.getByRole('columnheader',{name:'预计票面'})).toBeVisible();
  await expect(page.getByRole('columnheader',{name:'净节约',exact:true})).toBeVisible();
  expect(errors).toEqual([]);
});

test('desktop financing seller views load their shipping institution logos',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop','Desktop UI audit');
  await mockResources(page);
  await page.goto('/trading-research/financing-model');
  const sellers=page.getByRole('region',{name:'卖方观点',exact:true});
  await sellers.scrollIntoViewIfNeeded();
  const logos=sellers.locator('.institution-logo img');
  await expect(logos.first()).toBeVisible();
  await expect.poll(()=>logos.evaluateAll(images=>images.every(image=>image.complete&&image.naturalWidth>0))).toBe(true);
  await expect(sellers).toHaveScreenshot('financing-seller-logos.png');
});
