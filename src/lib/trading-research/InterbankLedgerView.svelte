<script lang="ts">
  import { getContext, onDestroy } from 'svelte';
  import ModuleCard from '../../components/ModuleCard.svelte';
  import PanelHeading from './PanelHeading.svelte';
  import Badge from './Badge.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { CLIENT_SESSION_CONTEXT, type ClientSession } from '$lib/client-session';
  import { globalMessages } from '$lib/global-messages';
  import { interbankPageSchema, interbankParseSchema, interbankAttachmentSchema, interbankSavedSchema, interbankDraftSavedSchema, interbankDraftSchema } from '../../data-contracts';
  import { runWorkflow, ledgerRows } from '$lib/interbank/workflow';
  import type { PreparedBatch, Journal, LedgerRow } from '$lib/interbank/model';
  const session=getContext<ClientSession>(CLIENT_SESSION_CONTEXT);
  let batch=$state<PreparedBatch|null>(null), journal=$state<Journal|null>(null);
  let downloaded=$state(false);
  let busy=$state(''), date=$state(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
  let rows=$state<LedgerRow[]>([]), queried=$state(false);
  let worker:Worker|undefined;
  let fileInput:HTMLInputElement;
  const actor=$derived($session?.user?.id ?? '');
  const canImport=$derived(!!$session?.permissions.includes('research.interbank:import'));
  const key=(account:string,signature:string)=>`eastmoney:interbank:v1:${encodeURIComponent(account)}:${signature}`;
  $effect(()=>{ actor; batch=null;journal=null;rows=[];queried=false;downloaded=false; });
  onDestroy(()=>worker?.terminate());
  async function action(label:string, run:()=>Promise<void>) {
    if (busy) return;
    busy=label;
    try { await run(); } catch(error) { globalMessages.error(error instanceof Error?error.message:'操作失败'); }
    finally { busy=''; }
  }
  async function api(path:string,init?:RequestInit) {
    const response=await fetch(`/api/interbank${path}`,init);
    const body=await response.json();
    if (!response.ok) throw new Error(body.error || body.detail || '资金系统请求失败');
    const schema=path.startsWith('/borrowings?')?interbankPageSchema:path==='/borrowings/parse'?interbankParseSchema:path==='/borrowings/import'?interbankSavedSchema:path==='/attachments'?interbankAttachmentSchema:path==='/repayment-drafts'?interbankDraftSavedSchema:interbankDraftSchema;
    return schema.parse(body);
  }
  function process<T>(data:unknown):Promise<T> {
    worker?.terminate();worker=new Worker(new URL('../interbank/prepare.worker.ts',import.meta.url),{type:'module'});
    return new Promise((resolve,reject)=>{
      worker!.onmessage=({data})=>{ worker?.terminate();data.error?reject(new Error(data.error)):resolve(data); };
      worker!.onerror=()=>{worker?.terminate();reject(new Error('文件处理失败'));};
      worker!.postMessage(data);
    });
  }
  async function choose(event:Event) {
    const input=event.currentTarget as HTMLInputElement,file=input.files?.[0];input.value='';
    if (!file) return;
    await action('解析中',async()=>{
      if (!actor) throw new Error('请先登录');
      const account=actor;
      const result=await process<{batch:PreparedBatch}>({file});
      if (actor!==account) throw new Error('账号已改变');
      const saved=localStorage.getItem(key(account,result.batch.signature));
      const next:Journal=saved?JSON.parse(saved):{signature:result.batch.signature,trades:{},uploads:{}};
      if (next.signature!==result.batch.signature) throw new Error('批次记录不一致');
      batch=result.batch;journal=next;date=result.batch.date;downloaded=false;
      globalMessages.success(`已解析 ${batch.trades.length} 笔成交`);
    });
  }
  async function persist(next:Journal,account=actor) {
    localStorage.setItem(key(account,next.signature),JSON.stringify(next));
    if (actor===account) journal=structuredClone(next);
  }
  function download(bytes:Uint8Array,name:string) {
    const url=URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer],{type:'application/zip'}));
    const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function archive() {
    if (!batch || !journal) return;
    const account=actor,prepared=batch,progress=structuredClone($state.snapshot(journal));
    // Call directory picker in the originating gesture, before asynchronous work.
    const picker=(window as unknown as {showDirectoryPicker?:()=>Promise<FileSystemDirectoryHandle>}).showDirectoryPicker;
    const directoryPromise=picker?.();
    await action('保存中',async()=>{
      if (directoryPromise) {
        const directory=await (await directoryPromise).getDirectoryHandle(prepared.date,{create:true});
        // Check every existing target before writing any file.
        const pending=[];
        for (const file of prepared.files) {
          const parts=file.name.split('/');let parent=directory;
          for (const part of parts.slice(0,-1)) parent=await parent.getDirectoryHandle(part,{create:true});
          let existing:FileSystemFileHandle|undefined;
          try { existing=await parent.getFileHandle(parts.at(-1)!); } catch(error) { if (!(error instanceof DOMException && error.name==='NotFoundError')) throw error; }
          if (existing) {
            const content=new Uint8Array(await (await existing.getFile()).arrayBuffer());
            if (content.length!==file.bytes.length || content.some((value,i)=>value!==file.bytes[i])) throw new Error(`目录已有不同文件：${file.name}`);
          } else pending.push({file,parent,name:parts.at(-1)!});
        }
        for (const {file,parent,name} of pending) {
          const handle=await parent.getFileHandle(name,{create:true});
          const stream=await handle.createWritable();await stream.write(new Uint8Array(file.bytes).buffer);await stream.close();
        }
        progress.archived=true;await persist(progress,account);
        globalMessages.success(`已保存 ${prepared.files.length} 个文件`);
      } else {
        const result=await process<{zip:Uint8Array}>({batch:$state.snapshot(prepared)});
        download(result.zip,`拆借台账_${prepared.date}.zip`);downloaded=true;
        globalMessages.success('归档 ZIP 已下载');
      }
    });
  }
  async function confirmDownloaded() {
    if (!journal) return;
    const progress=$state.snapshot(journal);
    await action('保存中',async()=>{await persist({...progress,archived:true});globalMessages.success('已确认归档');});
  }
  async function execute() {
    if (!batch || !journal) return;
    const account=actor,prepared=$state.snapshot(batch);
    await action('导入中',async()=>{
      if (!navigator.locks) throw new Error('浏览器不支持安全导入锁');
      await navigator.locks.request(`interbank:${account}`,{ifAvailable:true},async lock=>{
        if (!lock) throw new Error('另一个窗口正在导入');
        const current=JSON.parse(localStorage.getItem(key(account,prepared.signature)) ?? 'null');
        if (!current) throw new Error('批次进度丢失，请重新选择压缩包');
        await runWorkflow(prepared,current,async(path,init)=>{
          if (actor!==account) throw new Error('账号已改变，操作已停止');
          return api(path,init);
        },next=>persist(next,account));
        
        globalMessages.success(`已导入并保存 ${prepared.trades.length} 笔还款草稿`);
      });
    });
  }
</script>
<div class="interbank-ledger">
  <ModuleCard labelledBy="interbank-archive">
    <PanelHeading id="interbank-archive" title="成交归档">
      <input hidden bind:this={fileInput} type="file" accept=".zip,application/zip" aria-label="选择成交压缩包" onchange={choose} disabled={!!busy}/>
      <Button variant="outline" onclick={()=>fileInput.click()} disabled={!!busy}>{busy==='解析中'?'解析中':'选择成交压缩包'}</Button>
      <Button variant="outline" onclick={archive} disabled={!batch || !!busy}>{busy==='保存中'?'保存中':'保存归档'}</Button>
      {#if batch && downloaded && !journal?.archived && !(typeof window!=='undefined' && typeof (window as unknown as {showDirectoryPicker?:unknown}).showDirectoryPicker==='function')}<Button variant="outline" onclick={confirmDownloaded} disabled={!!busy}>已保存下载文件</Button>{/if}
      <Button onclick={execute} disabled={!batch || !journal?.archived || !!busy || !canImport}>{busy==='导入中'?'导入中':'导入并保存草稿'}</Button>
    </PanelHeading>
    {#if batch}
      <div class="batch-summary"><span>{batch.date}</span><span>{batch.trades.length} 笔成交</span><span>{batch.files.length} 个文件</span><Badge>{journal?.archived?'已归档':'待归档'}</Badge></div>
      <div class="table-scroll" tabindex="0" role="region" aria-label="归档文件预览"><table><thead><tr><th>原文件</th><th>归档文件</th></tr></thead><tbody>{#each batch.files as file}<tr><td>{file.source}</td><td>{file.name}</td></tr>{/each}</tbody></table></div>
      <div class="table-scroll" tabindex="0" role="region" aria-label="成交处理进度"><table><thead><tr><th>成交编号</th><th>对手方</th><th class="numeric">金额（万）</th><th>归档</th><th>台账</th><th>附件</th><th>还款草稿</th></tr></thead><tbody>{#each batch.trades as trade}{@const progress=journal?.trades[trade.serialNo]}{@const uploads=batch.files.filter(f=>f.serialNo===trade.serialNo).map(f=>journal?.uploads[f.name])}<tr><td>{trade.serialNo}</td><td>{trade['对手方']}</td><td class="numeric">{trade['拆借金额(万)']}</td><td>{journal?.archived?'已保存':'待保存'}</td><td>{progress?.import==='verified'?'已导入':progress?.import?'结果待确认':'待导入'}</td><td>{uploads.every(u=>u?.id)?'已上传':uploads.some(u=>u?.status==='intent'&&!u.id)?'结果待确认':'待上传'}</td><td>{progress?.draft==='verified'?'已保存':progress?.draft?'结果待确认':'待保存'}</td></tr>{/each}</tbody></table></div>
    {:else}<div class="empty">{busy==='解析中'?'正在解析成交文件':'请选择成交压缩包'}</div>{/if}
  </ModuleCard>
  <ModuleCard labelledBy="interbank-records">
    <PanelHeading id="interbank-records" title="资金系统台账">
      <div class="date-field"><Input type="date" aria-label="成交日期" bind:value={date} disabled={!!busy}/></div>
      <Button variant="outline" disabled={!!busy} onclick={()=>action('查询中',async()=>{rows=await ledgerRows(api,date);queried=true;})}>{busy==='查询中'?'查询中':'查询'}</Button>
    </PanelHeading>
    {#if rows.length}<div class="table-scroll" tabindex="0" role="region" aria-label="资金系统拆借台账"><table><thead><tr><th>成交编号</th><th>对手方</th><th class="numeric">金额（元）</th><th>首次结算日</th><th>到期还款日</th><th>还款草稿</th></tr></thead><tbody>{#each rows as row}<tr><td>{row.serialNo}</td><td>{row.counterpartyName}</td><td class="numeric">{row.matchAmount}</td><td>{row.matchTime}</td><td>{row.firstSettleDate}</td><td>{row.hid?'已保存':'未保存'}</td></tr>{/each}</tbody></table></div>{:else}<div class="empty">{queried?'当日暂无拆借台账':'请选择成交日期查询'}</div>{/if}
  </ModuleCard>
</div>
<style>
  .interbank-ledger{display:grid;gap:20px;min-width:0}.date-field{width:220px;max-width:100%}.batch-summary{display:flex;gap:20px;align-items:center;flex-wrap:wrap;margin-bottom:16px}.table-scroll{overflow:auto;max-width:100%;margin-top:16px}table{width:100%;border-collapse:collapse;white-space:nowrap;font-size:.875rem}th,td{padding:12px;text-align:left;border-bottom:1px solid var(--tr-border);font-variant-numeric:tabular-nums}th{font-weight:bold;background:var(--tr-bg)}.numeric{text-align:right}.empty{padding:36px 12px;text-align:center;color:var(--text-2)}
</style>
