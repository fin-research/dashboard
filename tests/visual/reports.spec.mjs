import {test, expect} from '@playwright/test';
import {mockResources} from './fixtures.mjs';

test('financing-model preserves its approved report layout',async({page})=>{
  const errors=[];
  page.on('pageerror', error=>errors.push(error.message));
  await page.clock.setFixedTime(new Date('2026-09-15T11:00:00+08:00'));
  const requests=await mockResources(page);
  await page.goto('/trading-research/financing-model');
  await expect(page.getByText('推荐发行',{exact:true}).first()).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.evaluate(()=>document.fonts.ready);
  await expect(page).toHaveScreenshot('financing-model.png',{fullPage:true});
  expect(errors).toEqual([]);expect(requests).toEqual([]);
});
