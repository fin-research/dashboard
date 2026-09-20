import { test, expect } from '@playwright/test';
import { mockResources, marketSnapshot } from './fixtures.mjs';

test('desktop SOP create action remains clear of AI and opens a dismissible dialog', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop UI audit');
  await mockResources(page);
  await page.goto('/financing/sop');
  const create = page.getByRole('button', { name: '新建 SOP', exact: true });
  const ai = page.getByRole('button', { name: '打开 AI 面板', exact: true });
  const a = await create.boundingBox(), b = await ai.boundingBox();
  expect(a.y + a.height + 12).toBeLessThanOrEqual(b.y);
  await expect(page).toHaveScreenshot('sop-actions.png', { fullPage: true });
  await create.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(page).toHaveScreenshot('sop-create.png', { fullPage: true });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(create).toBeFocused();
});

test('desktop market report retains full names and table cells at 1280 pixels', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop UI audit');
  await mockResources(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('**/api/market-report*', route => route.fulfill({ json: { ...marketSnapshot,
    equities: [...marketSnapshot.equities,
      { name: '深证成指', close: 13200.23, change_pct: 1.22 },
      { name: '创业板指', close: 3100.25, change_pct: -0.83 },
      { name: '科创50', close: 1350.67, change_pct: 0.75 }],
    primary_summary: { current_amount: 30, change_amount: 5 },
    primary_issues: [{ issue_date: '09/15', issue_date_key: '2026-09-15', issuer: '国泰海通证券',
      category: '小公募', bond_names: ['26国泰海通01'], tenors: ['3年'], coupons: [2.15], amount: 30 }],
    secondary_bonds: [{ bond_id: '240001', issuer: '国泰海通证券', bond_name: '24国泰海通证券01',
      tenor_label: '3Y', tenor_years: 3, trade_yield: 1.92, valuation: 1.93 }],
  } }));
  await page.goto('/market-briefing');
  await expect(page.locator('.primary-table')).toBeVisible();
  await expect(page.locator('.primary-table__issuer')).toHaveText('国泰海通证券');
  for (const selector of ['.equity-value__name', '.equity-value strong', '.summary-strip__item strong', '.primary-table td', '.secondary-table td']) {
    const clipped = await page.locator(selector).evaluateAll(nodes => nodes.filter(node =>
      node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1
    ).map(node => node.textContent));
    expect(clipped, selector).toEqual([]);
  }
  await expect(page).toHaveScreenshot('market-report-readable.png', { fullPage: true });
});
