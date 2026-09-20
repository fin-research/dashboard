import {test,expect} from '@playwright/test';
import {mockResources} from './fixtures.mjs';

test('desktop credit metrics and expanded records stay within the workspace',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop','Desktop UI audit');
  await mockResources(page);
  await page.setViewportSize({width:1280,height:900});
  await page.goto('/credit-workbench');
  await expect(page.getByRole('rowheader',{name:'银行甲',exact:true})).toBeVisible();
  const metrics=page.getByRole('region',{name:'授信总览',exact:true});
  const tops=await metrics.getByRole('article').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().y));
  expect(Math.max(...tops)-Math.min(...tops)).toBeLessThanOrEqual(1);
  const region=page.getByRole('region',{name:'授信机构记录',exact:true});
  const bounds=await region.evaluate(el=>({width:el.clientWidth,content:el.scrollWidth}));
  expect(bounds.content).toBeLessThanOrEqual(bounds.width+1);
  await page.getByRole('combobox',{name:'授信风险',exact:true}).selectOption('expiry');
  await expect(region.getByRole('rowheader',{name:'银行乙',exact:true})).toHaveCount(0);
  await region.getByRole('button',{name:'详情',exact:true}).click();
  await expect(region).toHaveJSProperty('scrollLeft',0);
  await expect(region.getByRole('textbox',{name:'机构性质',exact:true})).toHaveValue('商业银行');
  await expect(region).toHaveScreenshot('credit-record-expanded.png');
  await region.getByRole('button',{name:'收起',exact:true}).click();
  await expect(region.getByRole('textbox',{name:'机构性质',exact:true})).toHaveCount(0);
  await page.getByRole('combobox',{name:'授信风险',exact:true}).selectOption('all');
  await expect(region.getByRole('rowheader',{name:'银行乙',exact:true})).toBeVisible();
});
