import {test,expect} from '@playwright/test';
import * as XLSX from 'xlsx';
import {zipSync,strToU8} from 'fflate';
import {mockResources} from './fixtures.mjs';
test.beforeEach(async({page})=>{await page.clock.setFixedTime(new Date('2026-10-16T02:00:00Z'));});
function fixture(){
 const serial='IBO20261016000001',book=XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([
 ['成交编号','成交日期','本方方向','本方','对手方','本方资金账号','对手方资金账号','拆借金额(万)','拆借利率(%)','实际占款天数','拆借期限(天)','拆借利息','到期还款金额','首次结算日','到期还款日'],
 [serial,'2026-10-16','拆入','东方财富证券','上海农村商业银行股份有限公司','000123','000456','10000','1.8250001','3','7','1520.833','100001520.833','2026-10-16','2026-10-19']]),'信用拆借成交');
 const text=`BT /F1 12 Tf 50 700 Td (${serial}) Tj ET`;
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${text.length} >>\nstream\n${text}\nendstream`];
 let pdf='%PDF-1.4\n',offsets=[0];for(const [i,obj]of objects.entries()){offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${obj}\nendobj\n`;}
 const start=pdf.length;pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
 return Buffer.from(zipSync({'成交查询.xlsx':new Uint8Array(XLSX.write(book,{type:'array',bookType:'xlsx'})),'成交单.pdf':strToU8(pdf)}));
}
test('interbank archive previews renamed files and saves only repayment drafts',async({page})=>{
 await mockResources(page);
 await page.addInitScript(()=>{Object.defineProperty(window,'showDirectoryPicker',{value:undefined,configurable:true});});
 let imported=false,hid=null;const writes=[];
 await page.route('**/api/interbank/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname.replace('/api/interbank','');
  let json;
  if(request.method()==='POST')writes.push(path);
  if(path==='/borrowings')json={records:imported?[{id:12,serialNo:'IBO20261016000001',busiDate:'2026-10-16',counterpartyName:'上海农村商业银行股份有限公司',matchAmount:'100000000',matchTime:'2026-10-16',firstSettleDate:'2026-10-19',expireAmount:'100001520.833',financingCode:'F12',hid}]:[],total:imported?1:0};
  else if(path==='/borrowings/parse')json={status:'SUCCESS',totalNum:1,data:[{serialNo:'IBO20261016000001',counterpartyId:'bank'}]};
  else if(path==='/borrowings/import'){const record=request.postDataJSON().records[0];expect(record.ourpartyAccount).toBe('000123');expect(record.days).toBe('3');expect(record.daysPurpose).toBe('7');imported=true;json={saved:true};}
  else if(path==='/attachments'){expect(request.headers()['content-type']).toBe('application/pdf');expect(decodeURIComponent(request.headers()['x-filename'])).toBe('1016 上海农 1E 成交单.pdf');json={id:'file1'};}
  else if(path==='/repayment-drafts'){hid=9;json={hid};}
  else if(path==='/repayment-drafts/9')json={hid:9,reservationId:'F12',remark:'IBO20261016000001',reviewStatus:'0',status:'0',repaymentId:12,attachmentList:[{id:'file1'}]};
  else throw Error('unexpected '+path);
  await route.fulfill({json});
 });
 await page.goto('/trading-research/interbank-ledger');
 await expect(page.getByRole('link',{name:'拆借台账',exact:true})).toHaveAttribute('aria-current','page');
 await expect(page.locator('.tr-workspace')).toHaveScreenshot('interbank-empty.png');
 await page.getByLabel('选择成交压缩包').setInputFiles({name:'成交.zip',mimeType:'application/zip',buffer:fixture()});
 await expect(page.getByRole('region',{name:'归档文件预览'})).toContainText('1016 上海农 1E 成交单.pdf');
 await expect(page.getByRole('button',{name:'导入并保存草稿',exact:true})).toBeDisabled();
 const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'保存归档',exact:true}).click();await downloaded;
 await page.getByRole('button',{name:'已保存下载文件',exact:true}).click();
 await page.mouse.move(0,0);
 await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
 await expect(page.locator('.tr-workspace')).toHaveScreenshot('interbank-preview.png');
 await page.getByRole('button',{name:'导入并保存草稿',exact:true}).click();
 await expect(page.getByRole('region',{name:'成交处理进度'})).toContainText('已上传');
 await expect(page.getByRole('region',{name:'成交处理进度'})).toContainText('已导入');
 await page.mouse.move(0,0);
 await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
 await expect(page.locator('.tr-workspace')).toHaveScreenshot('interbank-complete.png');
 expect(writes).toEqual(['/borrowings/parse','/borrowings/import','/attachments','/repayment-drafts']);
});

test('interbank directory archive writes renamed files beneath the trade date',async({page})=>{
 await mockResources(page);
 await page.addInitScript(()=>{
  window.archiveWrites=[];
  const directory=path=>({
   async getDirectoryHandle(name){return directory(path+'/'+name);},
   async getFileHandle(name,options){if(!options?.create)throw new DOMException('missing','NotFoundError');return {async createWritable(){return {async write(buffer){window.archiveWrites.push({path:path+'/'+name,size:buffer.byteLength});},async close(){}};}};},
  });
  Object.defineProperty(window,'showDirectoryPicker',{value:async()=>directory('交易'),configurable:true});
 });
 await page.goto('/trading-research/interbank-ledger');
 await page.getByLabel('选择成交压缩包').setInputFiles({name:'成交.zip',mimeType:'application/zip',buffer:fixture()});
 await expect(page.getByRole('region',{name:'归档文件预览'})).toBeVisible();
 await page.getByRole('button',{name:'保存归档',exact:true}).click();
 await expect(page.getByRole('button',{name:'导入并保存草稿',exact:true})).toBeEnabled();
 expect(await page.evaluate(()=>window.archiveWrites.map(file=>file.path))).toEqual(['交易/2026-10-16/信用拆借成交查询_20261016.xlsx','交易/2026-10-16/1016 上海农 1E 成交单.pdf']);
 expect(await page.evaluate(()=>window.archiveWrites.every(file=>file.size>0))).toBe(true);
});


test('archive confirmation preserves progress written by another tab under the import lock',async({page})=>{
 await mockResources(page);
 await page.addInitScript(()=>{Object.defineProperty(window,'showDirectoryPicker',{value:undefined,configurable:true});});
 await page.goto('/trading-research/interbank-ledger');
 await page.getByLabel('选择成交压缩包').setInputFiles({name:'成交.zip',mimeType:'application/zip',buffer:fixture()});
 await expect(page.getByRole('region',{name:'归档文件预览'})).toBeVisible();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'保存归档',exact:true}).click();await download;
 const storageKey=await page.evaluate(async()=>{
  const key=Object.keys(localStorage).find(key=>key.startsWith('eastmoney:interbank:v1:'));
  const account=decodeURIComponent(key.split(':')[3]);
  let started;const ready=new Promise(resolve=>started=resolve);
  window.otherTabLock=navigator.locks.request(`interbank:${account}`,async()=>{
   started();await new Promise(resolve=>window.releaseOtherTab=()=>{
    const current=JSON.parse(localStorage.getItem(key));
    current.trades.IBO20261016000001={import:'verified',id:12,draft:'intent',attachments:['file1']};
    current.uploads['1016 上海农 1E 成交单.pdf']={digest:'saved-digest',id:'file1',status:'uploaded'};
    localStorage.setItem(key,JSON.stringify(current));resolve();
   });
  });
  await ready;return key;
 });
 await page.getByRole('button',{name:'已保存下载文件',exact:true}).click();
 await expect(page.getByRole('button',{name:'导入并保存草稿',exact:true})).toBeDisabled();
 await page.evaluate(()=>window.releaseOtherTab());
 await expect(page.getByRole('button',{name:'导入并保存草稿',exact:true})).toBeEnabled();
 const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),storageKey);
 expect(saved.archived).toBe(true);
 expect(saved.trades.IBO20261016000001).toEqual({import:'verified',id:12,draft:'intent',attachments:['file1']});
 expect(saved.uploads['1016 上海农 1E 成交单.pdf']).toEqual({digest:'saved-digest',id:'file1',status:'uploaded'});
});
