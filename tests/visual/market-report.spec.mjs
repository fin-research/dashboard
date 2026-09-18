import { test, expect } from '@playwright/test';
import { mockResources } from './fixtures.mjs';

test('报告只读取归档，控件的选择悬浮按下及焦点状态可辨识', async ({ page, isMobile }) => {
  const unexpected = await mockResources(page);
  const requests=[];
  page.on('request',request=>{if(/\/(api|data)\//.test(request.url()))requests.push(request);});
  await page.goto('/market-briefing');
  const visual=page.getByRole('link',{name:'可视化',exact:true});
  const text=page.getByRole('link',{name:'文字版',exact:true});
  await expect(page.getByRole('heading',{name:'今日聚焦'})).toBeVisible();
  await expect(visual).toHaveAttribute('aria-current','page');
  await expect(page.getByRole('button',{name:/生成聚焦|保存市场点评/})).toHaveCount(0);
  expect(requests.map(request=>new URL(request.url()).pathname)).toEqual(['/api/market-report']);
  expect(requests.every(request=>request.method()==='GET')).toBe(true);
  const background=button=>button.evaluate(el=>getComputedStyle(el).backgroundColor);
  expect(await background(visual)).not.toBe(await background(text));
  if (!isMobile) {
    const before=await background(text);
    await text.hover();
    await expect.poll(()=>background(text)).not.toBe(before);
    await page.mouse.down();
    expect(await text.evaluate(el=>getComputedStyle(el).filter)).not.toBe('none');
    await page.mouse.up();
  } else await text.click();
  await expect(text).toHaveAttribute('aria-current','page');
  await expect(page.locator('.text-report__editor')).toHaveAttribute('contenteditable','false');
  await visual.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  expect(await visual.evaluate(el=>getComputedStyle(el).outlineStyle)).not.toBe('none');
  expect(unexpected).toEqual([]);
});

test('未归档报告明确报错，重新尝试仍只读取归档', async ({ page }) => {
  const unexpected=await mockResources(page);
  const calls=[];
  await page.route('**/api/market-report*',route=>{calls.push(route.request().url());return route.fulfill({status:404,json:{detail:'2026-09-15 尚无市场点评定稿',error:{code:'REPORT_NOT_FINALIZED'}}});});
  await page.goto('/market-briefing?date=2026-09-15');
  await expect(page.getByRole('alert')).toContainText('尚无市场点评定稿');
  await expect(page.getByRole('button',{name:'导出图片'})).toBeDisabled();
  await page.getByRole('button',{name:'重新尝试'}).click();
  await expect.poll(()=>calls.length).toBe(2);
  expect(unexpected).toEqual([]);
});


test('市场点评标签链接可直达并保留日期和浏览器历史', async ({ page }) => {
  await mockResources(page);
  await page.goto('/market-briefing/text?date=2026-09-15');
  const tabs = page.getByRole('navigation', { name: '标签页' });
  await expect(tabs.getByRole('link', { name: '文字版', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.text-report__editor')).toBeVisible();
  await tabs.getByRole('link', { name: '可视化', exact: true }).click();
  await expect(page).toHaveURL(/market-briefing\?date=2026-09-15$/);
  await page.goBack();
  await expect(page.locator('.text-report__editor')).toBeVisible();
  await page.reload();
  await expect(tabs.getByRole('link', { name: '文字版', exact: true })).toHaveAttribute('aria-current', 'page');
});
