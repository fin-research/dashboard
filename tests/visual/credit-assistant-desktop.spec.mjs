import {test,expect} from '@playwright/test';
import {mockResources} from './fixtures.mjs';
import {assistantCustomers,assistantSession} from './audit-fixtures.mjs';
import {assistantRunning,assistantFailed,assistantRecovered} from './assistant-state-fixtures.mjs';

async function chooseCustomer(page){
 const customer=page.getByRole('combobox',{name:'客户名称',exact:true});
 await customer.fill('测试');await customer.press('ArrowDown');await customer.press('Enter');
}

test('desktop assistant processing records remain readable above the composer',async({page},testInfo)=>{
 test.skip(testInfo.project.name!=='desktop','Desktop UI audit');
 await mockResources(page);await page.setViewportSize({width:1280,height:900});
 await page.route('**/api/credit-assistant/institutions**',route=>route.fulfill({json:{institutions:assistantCustomers}}));
 await page.route(/\/api\/credit-assistant\/session(?:\?|$)/,route=>route.fulfill({json:assistantRunning}));
 let releaseStream;
 const streamGate=new Promise(resolve=>{releaseStream=resolve;});
 await page.route('**/api/credit-assistant/session/events?**',async route=>{await streamGate;await route.abort().catch(()=>{});});
 try{
  await page.goto('/credit-workbench/assistant');await chooseCustomer(page);
  await page.getByRole('button',{name:'关闭 AI 面板',exact:true}).click();
  await page.getByText('处理记录',{exact:true}).click();
  await expect(page.getByRole('list',{name:'处理记录',exact:true})).toBeVisible();
  await expect(page.getByText('检索材料 · 第 2 轮',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'正在处理消息',exact:true})).toBeDisabled();
  const geometry=await page.locator('.composer-dock').evaluate(el=>({bottom:el.getBoundingClientRect().bottom,viewport:innerHeight}));
  expect(Math.abs(geometry.bottom-geometry.viewport)).toBeLessThanOrEqual(1);
  await expect(page).toHaveScreenshot('credit-assistant-processing.png');
 }finally{releaseStream();}
});

test('desktop assistant failed answer can be retried without losing the question',async({page},testInfo)=>{
 test.skip(testInfo.project.name!=='desktop','Desktop UI audit');
 await mockResources(page);await page.setViewportSize({width:1280,height:900});
 await page.route('**/api/credit-assistant/institutions**',route=>route.fulfill({json:{institutions:assistantCustomers}}));
 let sentQuestion;
 await page.route(/\/api\/credit-assistant\/session(?:\?|$)/,route=>{
  if(route.request().method()==='GET')return route.fulfill({json:assistantFailed});
  sentQuestion=route.request().postDataJSON().question;
  return route.fulfill({contentType:'text/event-stream',body:`event: result\ndata: ${JSON.stringify(assistantRecovered)}\n\n`});
 });
 await page.goto('/credit-workbench/assistant');await chooseCustomer(page);
 await expect(page.getByRole('alert')).toContainText(assistantFailed.error);
 await expect(page).toHaveScreenshot('credit-assistant-failed.png');
 await page.getByRole('button',{name:'重新发送',exact:true}).click();
 await expect(page.getByRole('region',{name:'结果',exact:true})).toContainText(assistantSession.turns[0].answer.paragraphs[0].text);
 await expect(page.getByRole('region',{name:'结果',exact:true})).not.toContainText('corpusVersion');
 await expect(page.getByRole('region',{name:'结果',exact:true})).toHaveScreenshot('credit-assistant-result.png');
 await page.getByRole('button',{name:'关闭 AI 面板',exact:true}).click();
 await expect(page.getByText(assistantSession.turns[0].answer.paragraphs[0].text,{exact:false})).toBeVisible();
 expect(sentQuestion).toBe(assistantRunning.pendingQuestion);
 await expect(page.getByRole('button',{name:'重新发送',exact:true})).toHaveCount(0);
});

test('desktop credit assistant supports customer selection and readable cited replies',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop','Desktop UI audit');
  await mockResources(page);
  await page.setViewportSize({width:1280,height:900});
  await page.route('**/api/credit-assistant/institutions**',route=>route.fulfill({json:{institutions:assistantCustomers}}));
  let sessionAttempts=0;
  await page.route('**/api/credit-assistant/session?**',route=>route.fulfill(++sessionAttempts===1?{status:503,json:{error:'会话暂不可用'}}:{json:assistantSession}));
  await page.goto('/credit-workbench/assistant');
  const input=page.getByRole('textbox',{name:'输入消息',exact:true});
  await expect(input).toHaveAttribute('placeholder','输入问题');
  await expect(page.getByRole('button',{name:'发送消息',exact:true})).toBeDisabled();
  const customer=page.getByRole('combobox',{name:'客户名称',exact:true});
  await customer.fill('不存在的机构');
  await expect(page.getByRole('status').filter({hasText:'未找到机构'})).toBeVisible();
  await customer.fill('测试');
  await customer.press('ArrowDown');
  await expect(page.getByRole('option',{name:'测试银行甲 已签署保密协议',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page).toHaveScreenshot('credit-assistant-picker.png');
  await customer.press('Enter');
  await expect(input).toBeFocused();
  await expect(page.getByRole('alert')).toContainText('历史对话未能加载');
  await page.getByRole('button',{name:'重新连接',exact:true}).click();
  await expect(page.getByText(assistantSession.turns[0].answer.paragraphs[0].text,{exact:false})).toBeVisible();
  await page.getByRole('link',{name:'查看资料来源1',exact:true}).click();
  await expect(page.locator('#source-audit-turn-audit-source')).toBeFocused();
  await expect(page.getByText('测试公司2026年半年度报告 · 第12页',{exact:true})).toBeVisible();
  await expect(page).toHaveScreenshot('credit-assistant-citation.png');
  await input.fill('请进一步核实最新月份指标。');
  await expect(page.getByRole('button',{name:'发送消息',exact:true})).toBeEnabled();
  await expect(input).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
});
