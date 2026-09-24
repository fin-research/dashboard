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

test('交易管理标签悬浮时保持连续的冷灰顶栏', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Hover state is for pointer devices');
  await mockResources(page);
  await page.goto('/trading-research/trading');
  const header = page.locator('.page-header');
  const sidebar = page.locator('.tr-drawer');
  const workspace = page.locator('.tr-workspace');
  const active = header.getByRole('link', { name: '交易记录' });
  const inactive = header.getByRole('link', { name: '交易流程' });
  const beforeHover = await active.evaluate(element => ({
    header: getComputedStyle(element.closest('.page-header')).backgroundColor,
    tab: getComputedStyle(element).backgroundColor,
    shoulderBefore: getComputedStyle(element, '::before').content,
    shoulderAfter: getComputedStyle(element, '::after').content,
  }));
  expect(beforeHover.tab).toBe('rgb(255, 255, 255)');
  expect(beforeHover.shoulderBefore).toBe('none');
  expect(beforeHover.shoulderAfter).toBe('none');
  await expect(workspace).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  expect(await sidebar.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(beforeHover.tab);
  expect(beforeHover.header).not.toBe(beforeHover.tab);
  await inactive.hover();
  const hoverColor = await inactive.evaluate(element => getComputedStyle(element).backgroundColor);
  expect(hoverColor).not.toBe(beforeHover.header);
  expect(hoverColor).not.toBe(beforeHover.tab);
  await expect(page).toHaveScreenshot('trading-tabs-hover.png', { fullPage: true });
});

test('普通页与报告页共用冷灰顶栏和深色导航', async ({ page }, testInfo) => {
  await mockResources(page);
  let reference;
  for (const url of ['/trading-research', '/credit-workbench', '/credit-workbench/weekly', '/trading-research/financing-model', '/financing/', '/financing/schedule', '/management/messenger']) {
    await page.goto(url);
    const mobile = testInfo.project.name === 'mobile';
    const toggle = page.getByRole('button', { name: mobile ? '打开导航菜单' : '折叠侧边导航', exact: true });
    await expect(toggle).toBeVisible();
    const surfaces = await page.locator('.page-header').evaluate(header => ({
      header: getComputedStyle(header).backgroundColor,
      headerImage: getComputedStyle(header).backgroundImage,
      workspace: getComputedStyle(document.querySelector('.tr-workspace')).backgroundColor,
      sidebar: getComputedStyle(document.querySelector('.tr-drawer')).backgroundColor,
    }));
    expect(surfaces.headerImage, url).toBe('none');
    expect(surfaces.workspace, url).toBe('rgb(255, 255, 255)');
    expect(surfaces.header, `${url}: header must remain distinct from workspace`).not.toBe(surfaces.workspace);
    expect(surfaces.sidebar, `${url}: sidebar must remain distinct from workspace`).not.toBe(surfaces.workspace);
    if (mobile) await toggle.click();
    const active = page.locator('.tr-drawer__nav [aria-current="page"]');
    await expect(active).toHaveCount(1);
    await expect(active).toBeVisible();
    // Compare completed interaction states, not device-dependent transition frames.
    await page.locator(mobile ? '.tr-mobile-menu' : '.tr-sidebar-toggle')
      .evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
    const appearance = await active.evaluate(el => {
      const style = (target, keys) => {
        const css = getComputedStyle(target);
        return Object.fromEntries(keys.map(key => [key, css[key]]));
      };
      const header = document.querySelector('.page-header');
      const toggle = header.querySelector(innerWidth <= 900 ? '.tr-mobile-menu' : '.tr-sidebar-toggle');
      const root = getComputedStyle(document.documentElement);
      return {
        link: style(el, ['color', 'backgroundColor', 'borderColor', 'borderRadius', 'fontWeight', 'minHeight', 'paddingLeft', 'gap']),
        icon: style(el.querySelector('.tr-nav-icon'), ['color', 'width', 'height', 'backgroundColor']),
        title: style(header.querySelector('h1 a'), ['fontFamily', 'fontSize', 'fontWeight', 'color']),
        toggle: style(toggle, ['width', 'height', 'borderRadius', 'paddingLeft', 'paddingRight', 'backgroundColor', 'color']),
        marker: getComputedStyle(el, '::before').content,
        accent: root.getPropertyValue('--color-primary').trim(),
      };
    });
    expect(appearance.link.color, url).toBe('rgb(255, 255, 255)');
    expect(appearance.icon.color, url).toBe('rgb(255, 255, 255)');
    expect(appearance.link.backgroundColor, url).toBe('rgb(47, 111, 214)');
    expect(appearance.marker, url).toBe('none');
    const inactive = page.locator('.tr-drawer__nav a:not(.active)').first();
    if (await inactive.count()) await expect(inactive, url).toHaveCSS('color', 'rgb(216, 224, 233)');
    if (reference) expect(appearance, url).toEqual(reference);
    else reference = appearance;
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), url).toBe(true);
    if (url === '/management/messenger') await expect(page).toHaveScreenshot('workbench-navigation.png', { fullPage: true });
    if (mobile) {
      await page.keyboard.press('Escape');
      await expect(active).not.toBeVisible();
    } else {
      await toggle.click();
      await expect(active.locator('.tr-nav-label')).not.toBeVisible();
      await expect(active.locator('.tr-nav-icon')).toBeVisible();
      await page.getByRole('button', { name: '展开侧边导航', exact: true }).click();
      await expect(active.locator('.tr-nav-label')).toBeVisible();
    }
  }
});
