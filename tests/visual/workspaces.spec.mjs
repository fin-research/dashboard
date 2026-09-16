import { test, expect } from '@playwright/test';
import { mockResources } from './fixtures.mjs';

let errors, requests;
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.setFixedTime(new Date('2026-09-15T11:00:00+08:00'));
  requests = await mockResources(page);
});
test.afterEach(() => {
  expect(errors, 'browser runtime errors').toEqual([]);
  expect(requests, 'unregistered network requests').toEqual([]);
});

async function screenshot(page, name) {
  if (name !== 'credit-error') await expect(page.getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
}

const scenes = [
  ['home', '/', '资金日报'],
  ['overview', '/trading-research', '资金存量指标'],
  ['trading', '/trading-research/trading', '实时交易记录'],
  ['workflow', '/trading-research/workflow', '编辑模式'],
  ['credit', '/credit-workbench', '银行甲'],
  ['calendar', '/credit-workbench/calendar', '新增授信15亿元'],
  ['credit-weekly', '/credit-workbench/weekly', '银行甲'],
  ['research', '/trading-research/research', '宏观指标'],
  ['secondary', '/trading-research/secondary-bond-pool', '测试国债'],
  ['market-report', '/market-briefing', '权益市场'],
  ['schedule', '/financing/schedule', '启动时点'],
];
for (const [name, path, ready] of scenes) {
  test(`${name} renders`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByText(ready, { exact: false }).first()).toBeVisible();
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    await screenshot(page, name);
  });
}

test('portal exposes real destinations', async ({ page }) => {
  await page.goto('/');
  for (const [name, href] of [
    ['今日资金日报', '/fund-report/2026-09-15.html'], ['历史资金日报', '/fund-report'],
    ['市场点评', '/market-briefing'], ['融资工作台', '/financing/'],
    ['交易研究工作台', '/trading-research'], ['授信工作台', '/credit-workbench'], ['管理', '/management'],
  ]) await expect(page.getByRole('link', { name: new RegExp(`^${name}( |$)`) })).toHaveAttribute('href', href);
  await page.getByRole('link', { name: /^交易研究工作台/ }).click();
  await expect(page.getByText('资金存量指标', { exact: true })).toBeVisible();
});

test('workflow expands a branch and opens the real editor', async ({ page }) => {
  await page.goto('/trading-research/workflow');
  const collapse = page.getByRole('button', { name: '折叠拆借', exact: true });
  await expect(collapse).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(collapse).toHaveCSS('box-shadow', 'none');
  await page.getByRole('button', { name: '展开交易所回购', exact: true }).click();
  await expect(page.locator('[data-workflow-node="exchange-o32"]')).toBeVisible();
  await screenshot(page, 'workflow-expanded');
  await page.getByRole('checkbox', { name: '编辑模式' }).check();
  await page.locator('[data-workflow-node="shared-elements"] .node-surface').click();
  await expect(page.locator('.workflow-editor')).toBeVisible();
  await screenshot(page, 'workflow-editor');
});

test('credit failure is visible instead of an empty success', async ({ page }) => {
  await page.unrouteAll();
  requests = await mockResources(page, { creditError: true });
  await page.goto('/credit-workbench');
  await expect(page.getByText(/暂不可用|失败/).first()).toBeVisible();
  await screenshot(page, 'credit-error');
});

test('schedule switches modes and resets without stale fields', async ({ page }) => {
  await page.goto('/financing/schedule');
  await page.getByRole('combobox', { name: '节点时间配置' }).selectOption('point');
  await expect(page.getByRole('spinbutton', { name: '节点启动偏移天数' })).toHaveCount(0);
  await page.getByRole('spinbutton', { name: '节点计划偏移天数' }).fill('2');
  await expect(page.getByRole('status')).toContainText('T+2');
  await screenshot(page, 'schedule-point');
  await page.getByRole('button', { name: '重置' }).click();
  await expect(page.getByRole('spinbutton', { name: '节点启动偏移天数' })).toHaveValue('-5');
  await expect(page.getByRole('status')).toContainText('T-5 至 T-1');
});

test('secondary pool empty state is a successful empty report', async ({ page }) => {
  await page.unrouteAll();
  requests = await mockResources(page, { ledgerEmpty: true });
  await page.goto('/trading-research/secondary-bond-pool');
  await expect(page.getByRole('heading', { name: '所选范围暂无二级池数据' })).toBeVisible();
  await expect(page.getByRole('button', { name: /更新中/ })).toHaveCount(0);
  await screenshot(page, 'secondary-empty');
});
