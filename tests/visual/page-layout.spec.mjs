import { test, expect } from '@playwright/test';
import { mockResources } from './fixtures.mjs';

test('单面页面共用标题且不显示标签栏', async ({ page }) => {
  await mockResources(page);
  await page.goto('/fund-report');
  await expect(page.getByRole('heading', {name:'资金日报', exact:true})).toBeVisible();
  await expect(page.getByRole('navigation', {name:'标签页'})).toHaveCount(0);
  await expect(page.getByRole('link', {name:'资金日报', exact:true})).toHaveAttribute('href','/fund-report');
  await expect(page).toHaveScreenshot('fund-report-header.png', {fullPage:true});
  const font = await page.locator('.page-header h1 a').evaluate(el => {
    const s = getComputedStyle(el); return [s.fontFamily, s.fontSize, s.fontWeight, s.color];
  });
  await page.goto('/trading-research');
  await expect(page.getByRole('navigation', {name:'标签页'})).toHaveCount(0);
  await expect(page.locator('.page-header h1 a')).toHaveAttribute('href','/trading-research');
  expect(await page.locator('.page-header h1 a').evaluate(el => {
    const s = getComputedStyle(el); return [s.fontFamily, s.fontSize, s.fontWeight, s.color];
  })).toEqual(font);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});


test('共享顶栏保持紧凑且标签贴合底边', async ({ page }, testInfo) => {
  await mockResources(page);
  for (const url of ['/market-briefing', '/management/messenger']) {
    await page.goto(url);
    const header = page.locator('.page-header');
    const active = header.getByRole('navigation', { name: '标签页' }).locator('[aria-current="page"]');
    await expect(active).toBeVisible();
    const headerBox = await header.boundingBox();
    const tabBox = await active.boundingBox();
    if (testInfo.project.name === 'desktop') expect(headerBox.height).toBeLessThanOrEqual(64);
    expect(Math.abs(tabBox.y + tabBox.height - headerBox.y - headerBox.height)).toBeLessThanOrEqual(1);
    expect(tabBox.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
