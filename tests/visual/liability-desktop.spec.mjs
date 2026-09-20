import {test,expect} from '@playwright/test';
import {mockResources} from './fixtures.mjs';

test('desktop liability report retains six complete pages with readable charts',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop','Desktop UI audit');
  await mockResources(page);
  await page.setViewportSize({width:1280,height:900});
  await page.goto('/financing/liability-report');
  const pages=page.locator('.report-page');
  await expect(pages).toHaveCount(6);
  await expect(page.getByRole('button',{name:'导出 PDF',exact:true})).toBeEnabled();
  const snapshots=['liability-page-1.png','liability-page-2.png','liability-page-3.png','liability-page-4.png','liability-page-5.png','liability-page-6.png'];
  for(let index=0;index<6;index++){
    const sheet=pages.nth(index);
    await sheet.scrollIntoViewIfNeeded();
    await expect(sheet.getByText(`第 ${index+1} 页 · 共 6 页`,{exact:true})).toBeVisible();
    expect(await sheet.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    await expect(sheet).toHaveScreenshot(snapshots[index]);
  }
  await page.getByRole('link',{name:'公募债',exact:true}).click();
  await expect(page).toHaveURL(/\/financing\/debts\/1$/);
});
