import {test,expect} from '@playwright/test';
import {mockResources} from './fixtures.mjs';
import {creditFull} from './audit-fixtures.mjs';

test('desktop credit weekly report presents nonempty news and five product details',async({page},testInfo)=>{
 test.skip(testInfo.project.name!=='desktop','Desktop UI audit');
 await mockResources(page);
 const report=structuredClone(creditFull);
 report.weeklyNews=Array.from({length:4},(_,index)=>({
   ...report.weeklyNews[0],institutionName:`银行${['甲','乙','丙','丁'][index]}`,
 }));
 await page.route('**/api/credit**',route=>route.fulfill({json:report}));
 await page.setViewportSize({width:1280,height:900});await page.goto('/credit-workbench/weekly');
 await expect(page.getByRole('region',{name:'授信周报',exact:true}).getByRole('article')).toHaveCount(5);
 for (const card of await page.getByRole('region',{name:'授信周报',exact:true}).getByRole('article').all()) await expect(card).toContainText('较上周');
 await expect(page.getByRole('region',{name:'授信周报',exact:true}).getByRole('article').first()).toContainText('较上周+2亿元');
 await expect(page.getByRole('region',{name:'本周授信快讯',exact:true})).toContainText('较前额增加5亿');
 await expect(page.locator('.tr-credit-news-list li')).toHaveCount(4);
 await expect(page.getByRole('table',{name:'所选报表日前近6个月新增、续作和扩额授信批复',exact:true})).toContainText('同业拆借 3.00亿');
 await expect(page.locator('.tr-workspace')).toHaveScreenshot('credit-weekly-full-desktop.png');
});

test('credit weekly detail keeps the complete grouped header while scrolling',async({page},testInfo)=>{
 test.skip(testInfo.project.name!=='desktop','Desktop sticky header audit');
 await mockResources(page);
 const report=structuredClone(creditFull);
 report.institutions=Array.from({length:24},(_,index)=>({
   ...structuredClone(creditFull.institutions[index%2]),
   institutionName:`银行${String(index+1).padStart(2,'0')}`,
 }));
 await page.route('**/api/credit**',route=>route.fulfill({json:report}));
 await page.setViewportSize({width:1280,height:900});await page.goto('/credit-workbench/weekly');
 const workspace=page.locator('.tr-workspace');
 const table=page.locator('.tr-credit-weekly-detail-table');
 await table.scrollIntoViewIfNeeded();
 await workspace.evaluate(el=>{el.scrollTop+=220});
 const workspaceTop=await workspace.evaluate(el=>el.getBoundingClientRect().top);
 const headerTop=await table.locator('thead').evaluate(el=>el.getBoundingClientRect().top);
 expect(Math.abs(headerTop-workspaceTop)).toBeLessThanOrEqual(2);
 for(const cell of await table.locator('thead tr:first-child th').all()) await expect(cell).toBeInViewport();
 await expect(workspace).toHaveScreenshot('credit-weekly-sticky-header.png');
});

test('desktop credit metrics and expanded records stay within the workspace',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop','Desktop UI audit');
  await page.clock.setFixedTime(new Date('2026-09-30T04:00:00Z'));
  await mockResources(page);
  await page.route('**/api/credit**',route=>route.fulfill({json:creditFull}));
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
  const products=await region.getByRole('group').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().y));
  expect(products).toHaveLength(5);
  expect(Math.max(...products.slice(0,4))-Math.min(...products.slice(0,4))).toBeLessThanOrEqual(1);
  expect(products[4]).toBeGreaterThan(products[1]);
  await page.setViewportSize({width:1280,height:1600});
  await region.evaluate(el=>el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}));await expect(region).toBeInViewport({ratio:1});
  await expect(region).toHaveScreenshot('credit-record-expanded.png');
  const notes=region.locator('.tr-credit-notes-grid textarea');
  const emptyHeights=await notes.evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().height));
  expect(Math.max(...emptyHeights)-Math.min(...emptyHeights)).toBeLessThanOrEqual(1);
  expect(emptyHeights[0]).toBeLessThanOrEqual(48);
  await notes.first().fill('授信额度明细第一行\n授信额度明细第二行\n授信额度明细第三行');
  const filledHeights=await notes.evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().height));
  expect(filledHeights[0]).toBeGreaterThan(emptyHeights[0]);
  expect(Math.max(...filledHeights)-Math.min(...filledHeights)).toBeLessThanOrEqual(1);
  await page.setViewportSize({width:1280,height:900});
  await region.getByRole('button',{name:'收起',exact:true}).click();
  await expect(region.getByRole('textbox',{name:'机构性质',exact:true})).toHaveCount(0);
  await page.getByRole('combobox',{name:'授信风险',exact:true}).selectOption('all');
  await expect(region.getByRole('rowheader',{name:'银行乙',exact:true})).toBeVisible();
});

test('credit application separates requests from editable maintenance details',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop','Desktop credit application');
  await page.clock.setFixedTime(new Date('2026-09-30T04:00:00Z'));
  await mockResources(page);
  const report=structuredClone(creditFull);
  let saved;
  await page.route('**/api/credit**',route=>{
    if(route.request().method()==='PATCH'){
      saved=route.request().postDataJSON();
      report.institutions[0].bankOffice=saved.changes.institution.bankOffice;
      return route.fulfill({json:{...report,institution:report.institutions[0],institutionName:report.institutions[0].institutionName,viewDate:saved.viewDate,calendarMonth:saved.calendarMonth,previousWeeklyNews:[]}});
    }
    return route.fulfill({json:report});
  });
  await page.setViewportSize({width:1280,height:900});
  await page.goto('/credit-workbench');
  const region=page.getByRole('region',{name:'授信机构记录',exact:true});
  await region.getByRole('button',{name:'详情',exact:true}).first().click();
  await expect(region.getByRole('textbox',{name:'机构性质',exact:true})).toBeEnabled();
  await expect(region.getByRole('textbox',{name:'已用额度（亿元）',exact:true})).toBeDisabled();
  await expect(region.getByRole('button',{name:'保存',exact:true})).toBeVisible();
  await expect(region.getByRole('group',{name:'其它'}).getByRole('spinbutton')).toHaveCount(1);
  await region.getByRole('textbox',{name:'银行经办机构'}).fill('分行金融市场部');
  await region.getByRole('button',{name:'保存',exact:true}).click();
  await expect(region.getByRole('textbox',{name:'银行经办机构'})).toHaveValue('分行金融市场部');
  expect(saved.operation).toBe('maintenance');
  expect(saved.reportDate).toBe(report.summary.reportDate);
  expect(saved.viewDate).toBe(report.summary.reportDate);
  expect(saved.changes.institution.bankOffice).toBe('分行金融市场部');
  await page.getByRole('button',{name:'关闭通知'}).click();
  await page.getByRole('button',{name:'授信申请',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'授信申请'});
  await expect(dialog.getByRole('textbox',{name:'机构名称'})).toBeVisible();
  await dialog.getByRole('button',{name:'续期',exact:true}).click();
  await expect(dialog.getByLabel('新到期日')).toBeVisible();
  await expect(dialog.getByRole('textbox',{name:'机构名称'})).toHaveCount(0);
  await dialog.getByRole('button',{name:'扩额',exact:true}).click();
  await expect(dialog.getByRole('spinbutton',{name:'扩额后总额（亿元）'})).toBeVisible();
  await expect(dialog.getByRole('spinbutton',{name:'债券投资（亿元）'})).toBeVisible();
  const totalTop=(await dialog.getByRole('spinbutton',{name:'扩额后总额（亿元）'}).boundingBox()).y;
  const institutionTop=(await dialog.getByRole('combobox',{name:'授信机构'}).boundingBox()).y;
  expect(Math.abs(totalTop-institutionTop)).toBeLessThanOrEqual(1);
  const increaseRows=await dialog.locator('.tr-credit-increase-grid > label').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().y));
  expect(increaseRows).toHaveLength(4);
  expect(Math.max(...increaseRows)-Math.min(...increaseRows)).toBeLessThanOrEqual(1);
  expect(increaseRows[0]).toBeGreaterThan(totalTop);
  await expect(dialog).toHaveScreenshot('credit-application-increase.png');
  await dialog.getByRole('button',{name:'撤销',exact:true}).click();
  await expect(dialog.getByRole('checkbox',{name:'确认撤销该机构授信'})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'维护',exact:true})).toHaveCount(0);
  await dialog.getByRole('button',{name:'新增',exact:true}).click();
  await expect(dialog.getByRole('textbox',{name:'机构名称'})).toBeVisible();
  await expect(dialog.getByRole('spinbutton',{name:'债券投资（亿元）'})).toBeVisible();
  await expect(dialog.getByText('已用（亿元）',{exact:true})).toHaveCount(0);
  await expect(dialog.getByText('说明',{exact:true})).toHaveCount(0);
  const applicationNotes=dialog.locator('.tr-credit-notes-grid textarea');
  const applicationEmptyHeights=await applicationNotes.evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().height));
  expect(Math.max(...applicationEmptyHeights)-Math.min(...applicationEmptyHeights)).toBeLessThanOrEqual(1);
  expect(applicationEmptyHeights[0]).toBeLessThanOrEqual(48);
  await applicationNotes.first().fill('授信额度明细第一行\n授信额度明细第二行\n授信额度明细第三行');
  const applicationFilledHeights=await applicationNotes.evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().height));
  expect(applicationFilledHeights[0]).toBeGreaterThan(applicationEmptyHeights[0]);
  expect(Math.max(...applicationFilledHeights)-Math.min(...applicationFilledHeights)).toBeLessThanOrEqual(1);
  await applicationNotes.first().fill('');
  await expect(dialog).toHaveCSS('opacity','1');
  await expect(dialog).toHaveScreenshot('credit-application-new.png');
});
