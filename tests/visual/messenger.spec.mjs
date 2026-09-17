import {test,expect} from '@playwright/test';
test('消息记录、尝试明细和不确定结果重试确认',async({page},testInfo)=>{
  await page.goto('/management/messenger');
  await expect(page.getByRole('region',{name:'消息记录'})).toBeVisible();
  await expect(page.getByRole('region',{name:'发送尝试'})).toContainText('EMAIL_RATE_LIMIT');
  await expect(page.getByText('<p>节点提醒</p>',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'重试 中国央行：开展公开市场操作',exact:true}).click();
  await expect(page.getByRole('alertdialog')).toContainText('重试可能重复发送');
  await page.getByRole('button',{name:'取消',exact:true}).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath('messenger.png'),fullPage:true});
});
