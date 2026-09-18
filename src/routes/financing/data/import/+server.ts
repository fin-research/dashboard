import { json } from '@sveltejs/kit';
import { DebtImportError } from '$lib/financing/debt-import-error';
import { getDatabase } from '$lib/server/financing/db.js';
import { importDebtWorkbook } from '$lib/server/financing/debt-importer.js';
import { importCommitSchema, importPlanSchema, validateIncrement } from '$lib/financing/debt-import-json';
import type { RequestHandler } from './$types';
import { hasPermission } from '$lib/permissions';

const headers = {'cache-control':'no-store, private'};
export const POST: RequestHandler = async (event) => {
  if (!event.locals.user?.authorization || !hasPermission(event.locals.permissions,'financing.data:import')) return json({error:'无权导入台账'},{status:403,headers});
  if(event.request.headers.get('origin')!==event.url.origin) return json({error:'仅允许从本站提交操作'},{status:403,headers});
  if(event.request.headers.get('content-type')?.split(';')[0]!=='application/json') return json({error:'仅支持 JSON 数据'},{status:415,headers});
  try {
    const reader=event.request.body?.getReader();
    if(!reader) throw new DebtImportError('缺少导入数据');
    const chunks:Uint8Array[]=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16*1024*1024){await reader.cancel();return json({error:'整个导入已拒绝：数据超过 16 MB'},{status:413,headers});}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const raw=JSON.parse(new TextDecoder().decode(bytes));
    const parsed=raw.action==='plan'?importPlanSchema.safeParse(raw):importCommitSchema.safeParse(raw);
    if(!parsed.success) return json({error:`整个导入已拒绝：数据格式无效（${parsed.error.issues[0]?.path.join('.')}）`},{status:400,headers});
    const input=parsed.data;
    const keys=new Set(input.identities.map(d=>d.sourceKey));
    if(keys.size!==input.identities.length) throw new DebtImportError('负债来源键重复');
    const additions=input.action==='commit'?new Map(input.debts.map(d=>[d.sourceKey,d])):new Map();
    if(input.action==='commit')validateIncrement(input);
    const transformed={snapshot:input.snapshot,debts:input.identities.map(d=>additions.get(d.sourceKey)??{...d,amount:0,interestPayable:0,extension:{}}),
      cashflows:input.action==='commit'?input.cashflows:[],balances:input.action==='commit'?input.balances:[],
      snapshotBalances:input.action==='commit'?input.snapshotBalances:undefined};
    const result=await importDebtWorkbook(getDatabase(event),transformed,{planOnly:input.action==='plan',refreshDerivatives:input.action==='commit',
      expectedVersion:input.action==='commit'?input.version:null,expectedNewKeys:input.action==='commit'?[...additions.keys()]:null});
    return json(result,{headers});
  } catch(failure) {
    const code=(failure as {code?:string})?.code;
    const rejected = failure instanceof DebtImportError || failure instanceof SyntaxError || code?.startsWith('22') || code?.startsWith('23');
    if (!rejected) {
      console.error('Debt import request failed', {code: code ?? 'unknown'});
      return json({error:'导入结果暂时无法确认，请重新核对后导入；已提交的数据不会重复新增'}, {status:503,headers});
    }
    const message=failure instanceof DebtImportError?failure.message:failure instanceof SyntaxError?'JSON 格式无效':code?.startsWith('23')?'数据违反约束，请检查重复记录与引用':'日期或数值格式无效';
    return json({error:`整个导入已拒绝，未写入任何数据：${message}`},{status:400,headers});
  }
};
