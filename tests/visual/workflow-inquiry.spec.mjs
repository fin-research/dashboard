import { test, expect } from '@playwright/test';
import { mockResources } from './fixtures.mjs';

const row = (id, name, tenor, amount, price) => ({ id, counterparty: name, trader: `交易员${id}`, tenor, amount, price });
const seed = [row('a', '银行甲', '7', '10', '2'), row('b', '银行乙', '14', '20', '3'), row('c', '银行丙', '21', '30', '4')];
const key = 'eastmoney:trading-workflow:v1:visual-fixture:2026-09-15';
async function open(page, rows = []) {
  await page.clock.setFixedTime(new Date('2026-09-15T11:00:00+08:00'));
  const requests = await mockResources(page);
  await page.addInitScript(({ key, rows }) => localStorage.setItem(key, JSON.stringify({ date: '2026-09-15', enabled: { loan: true, reverse: true, exchange: false }, completed: {}, branches: {}, notified: {}, notes: {}, quotes: { 'loan-quote': rows } })), { key, rows });
  await page.goto('/trading-research/workflow');
  await page.locator('[data-workflow-node="loan-quote"] .node-surface').click();
  return requests;
}
const cell = (page, id, field) => page.locator(`[data-row="${id}"][data-field="${field}"]`);
const allRows = page => page.locator('.inquiry-row');

test('inquiry keeps blank numeric cells until a candidate is accepted, and validates input', async ({ page }) => {
  const requests = await open(page, seed);
  const amount = cell(page, 'b', 'amount');
  await amount.fill('');
  await cell(page, 'b', 'trader').focus();
  await expect(amount).toHaveValue('');
  await amount.focus();
  await expect(amount.locator('..').getByRole('option').first()).toHaveText('10');
  await expect(amount).toHaveValue('');
  await amount.press('Tab');
  await expect(amount).toHaveValue('10亿');
  const price = cell(page, 'b', 'price');
  await price.fill(''); await amount.focus(); await price.focus();
  await price.locator('..').getByRole('option').first().click();
  await expect(price).toHaveValue('2'); await expect(price).toBeFocused();
  await expect(allRows(page)).toHaveCount(3);
  await amount.fill('-1'); await amount.press('Tab');
  await expect(amount).toBeFocused(); await expect(amount).toHaveAttribute('aria-invalid', 'true');
  await amount.fill('0'); await amount.press('Tab'); await expect(amount).toHaveAttribute('aria-invalid', 'true');
  await amount.fill('1.5'); await amount.press('Tab'); await expect(amount).toHaveAttribute('aria-invalid', 'false');
  await cell(page, 'b', 'tenor').fill('1.1'); await cell(page, 'b', 'tenor').press('Tab');
  await expect(cell(page, 'b', 'tenor')).toHaveAttribute('aria-invalid', 'true');
  expect(requests).toEqual([]);
});

test('inquiry appends only at the end with Tab or at the row insertion control', async ({ page }) => {
  await open(page);
  const first = page.locator('.inquiry-row').first();
  await first.locator('[data-field="counterparty"]').fill('新银行');
  await expect(allRows(page)).toHaveCount(1);
  for (const [field, value] of [['trader', '新交易员'], ['tenor', '7'], ['amount', '1'], ['price', '2']]) await first.locator(`[data-field="${field}"]`).fill(value);
  await first.locator('[data-field="price"]').press('Tab');
  await expect(allRows(page)).toHaveCount(2);
  const originalId = await first.locator('input').first().getAttribute('data-row');
  await first.getByRole('button', { name: '在此行下方插入询价' }).click();
  await expect(allRows(page)).toHaveCount(3);
  await expect(first.locator('input').first()).toHaveAttribute('data-row', originalId);
  await expect(allRows(page).nth(1).locator('input').first()).toBeFocused();
});

test('inquiry drag selection copies a rectangle and deletes fully cleared rows', async ({ page, context }, info) => {
  test.skip(info.project.name === 'mobile', 'Mouse rectangle selection is a desktop interaction');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page, seed);
  const start = await cell(page, 'b', 'counterparty').boundingBox(), end = await cell(page, 'c', 'amount').boundingBox();
  await page.mouse.move(start.x + 12, start.y + start.height / 2); await page.mouse.down();
  await page.mouse.move(end.x + 12, end.y + end.height / 2, { steps: 10 }); await page.mouse.up();
  await expect(page.locator('.cell-selected')).toHaveCount(8);
  await page.keyboard.press('ControlOrMeta+c');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('银行乙\t交易员b\t14\t20\n银行丙\t交易员c\t21\t30');
  await page.keyboard.press('Delete');
  await expect(cell(page, 'b', 'counterparty')).toHaveValue('');
  await expect(cell(page, 'c', 'amount')).toHaveValue('');
  await expect(cell(page, 'b', 'price')).toHaveValue('-3BP');
  await cell(page, 'b', 'price').fill('');
  await expect(allRows(page)).toHaveCount(2);
  await expect(cell(page, 'b', 'price')).toHaveCount(0);
});
