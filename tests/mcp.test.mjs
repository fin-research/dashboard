import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'tsx/esm/api';
register();
const { handleDashboardMcp, executeOperation, decodeBusinessResponse, boundedText } = await import('../src/lib/server/mcp.ts');
const { mcpOperations, operationPath } = await import('../src/lib/server/mcp-catalog.ts');
const { clientRequestPermission } = await import('../src/lib/route-permissions.ts');
const { stringify } = await import('devalue');
const user = { id:'auth0|test',auth0Id:'auth0|test',email:'test@18.cn',issuedAt:1,expiresAt:9999999999,authorization:{name:'测试',picture:'',roles:[],permissions:[],mode:'enforce'} };
function fixture(allow = () => true, response = () => Response.json({ saved:true })) {
  const calls = [];
  return { calls, env: { IDENTITY: { async fetch(request) {
    calls.push(request);
    if (new URL(request.url).pathname === '/mcp/policies') return Response.json({ allowed:(await request.json()).map(allow) });
    return response(request);
  } } } };
}
async function rpc(f, method, params = {}, identity = user) {
  const response = await handleDashboardMcp(new Request('https://eastmoney.hasbai.xyz/api/mcp',{method:'POST',headers:{...(method==='server/discover'?{'MCP-Protocol-Version':'2026-07-28','Mcp-Method':method}:{}),Host:'eastmoney.hasbai.xyz','Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),f.env,identity);
  const text = await response.text();
  const payload = response.headers.get('Content-Type')?.includes('text/event-stream') ? text.split('\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6))).find(value=>value.id===1) : JSON.parse(text);
  return {response,payload};
}
test('real MCP discovery publishes exactly credit_report and respects Gateway permission',async()=>{
  const {response,payload}=await rpc(fixture(),'tools/list');
  assert.equal(response.status,200);
  assert.deepEqual(payload.result.tools.map(tool=>tool.name),['credit_report']);
  assert.equal(payload.result.tools[0].annotations.readOnlyHint,true);
  const denied=await rpc(fixture(()=>false),'tools/list');
  assert.deepEqual(denied.payload.result.tools,[]);
});
test('unpublished tools and prefixed aliases cannot execute or access backing services',async()=>{
  const f=fixture();
  f.env.EASTMONEY={list(){assert.fail('Unpublished materials must not be read')}};
  f.env.CREDIT_SEARCH={search(){assert.fail('Unpublished search must not execute')}};
  for(const name of ['health','credit_public_materials','credit_public_search','dashboard_credit_report',...mcpOperations.filter(op=>op.name!=='credit_report').map(op=>op.name)]) {
    const {payload}=await rpc(f,'tools/call',{name,arguments:{}});
    assert.ok(payload.error||payload.result.isError,name);
  }
  assert.equal(f.calls.filter(request=>new URL(request.url).pathname==='/mcp/dispatch').length,0);
});
test('credit MCP always dispatches the anonymized API and cannot select full reports',async()=>{
  const f=fixture(()=>true,request=>{
    const target=new URL(new URL(request.url).searchParams.get('target'),'https://eastmoney.hasbai.xyz');
    assert.equal(target.pathname,'/api/credit');assert.deepEqual(target.searchParams.getAll('view'),['masked']);
    return Response.json({reportDate:'2026-08-21',amountUnit:'亿元',institutions:[{institution_id:'8',total_limit:'10.000000'}]});
  });
  const read=await rpc(f,'tools/call',{name:'credit_report',arguments:{query:{date:'2026-08-21',institutionId:'8'}}});
  assert.equal(read.payload.result.structuredContent.data.institutions[0].institution_id,'8');
  for(const query of [{view:'usage'},{institution:'身份哨兵'},{month:'2026-08'}]) {
    const result=await rpc(f,'tools/call',{name:'credit_report',arguments:{query}});
    assert.ok(result.payload.error||result.payload.result.isError);
  }
  assert.equal(f.calls.filter(request=>new URL(request.url).pathname==='/mcp/dispatch').length,1);
});
test('MCP calls validate shared schemas, reject hidden tools, and keep identities request-scoped',async()=>{
  const f=fixture();
  const invalid=await rpc(f,'tools/call',{name:'credit_report',arguments:{query:{date:'2026-02-30'}}});
  assert.ok(invalid.payload.error||invalid.payload.result.isError);assert.equal(f.calls.length,1);
  const restricted=fixture(()=>false);const denied=await rpc(restricted,'tools/call',{name:'create_project',arguments:{form:{}}});
  assert.ok(denied.payload.error||denied.payload.result.isError);assert.equal(restricted.calls.length,1);
  const anonymous=await rpc(f,'tools/list',{},null);assert.equal(anonymous.response.status,401);
  const read=await rpc(f,'tools/call',{name:'credit_report',arguments:{}});assert.deepEqual(read.payload.result.structuredContent.data,{saved:true});
});
test('catalog operations map to registered Gateway methods and cannot inject named actions or paths',()=>{
  assert.equal(new Set(mcpOperations.map(t=>t.name)).size,mcpOperations.length);
  for(const operation of mcpOperations) assert.ok(clientRequestPermission(new URL(operationPath(operation,{}),'https://eastmoney.hasbai.xyz'),operation.method),operation.name);
  assert.equal(mcpOperations.find(t=>t.name==='bond_ledger').input.safeParse({query:{workflow:'old-instance'}}).success,false);
  const op=mcpOperations.find(t=>t.name==='article');
  assert.equal(op.input.safeParse({id:'../../api/profile'}).success,false);
  assert.throws(()=>operationPath(op,{id:'a',query:{'/deleteProject':'1'}}));
});
test('JSON mutations and named actions use private dispatch, preserve user context and repeated form fields',async()=>{
  const f=fixture();
  await executeOperation(mcpOperations.find(t=>t.name==='create_timing_decision'),{body:{runId:'sample'}},f.env,user);
  const first=f.calls[0];assert.equal(first.headers.has('Authorization'),false);assert.equal(first.headers.has('Cookie'),false);
  assert.equal(JSON.parse(Buffer.from(first.headers.get('X-Eastmoney-Gateway-Context'),'base64url')).user.auth0Id,user.auth0Id);
  assert.deepEqual(await first.json(),{runId:'sample'});
  const g=fixture(()=>true,()=>Response.json({type:'success',status:200,data:stringify({saved:true})}));
  await executeOperation(mcpOperations.find(t=>t.name==='update_sop'),{id:'abc',form:{name:'模板',nodeIds:['1','2']}},g.env,user);
  assert.equal(new URL(g.calls[0].url).searchParams.get('target'),'/financing/sop/abc?%2FupdateTemplate=');
  assert.deepEqual((await g.calls[0].formData()).getAll('nodeIds'),['1','2']);
});
test('business failures, Svelte data and SSE terminal results retain their meaning',async()=>{
  assert.deepEqual(await decodeBusinessResponse(Response.json({type:'data',nodes:[{type:'data',data:JSON.parse(stringify({secret:'layout'}))},{type:'data',data:JSON.parse(stringify({projects:[]}))}]}),{format:'page'}),{projects:[]});
  const failure=await decodeBusinessResponse(Response.json({type:'failure',status:409,data:stringify({message:'版本冲突'})}),{format:'form'});assert.equal(failure.failed,true);assert.equal(failure.status,409);
  const f=fixture(()=>true,()=>Response.json({detail:'权限已变更'},{status:403}));
  const result=await rpc(f,'tools/call',{name:'credit_report',arguments:{}});assert.equal(result.payload.result.isError,true);assert.match(result.payload.result.content[0].text,/403/);
  const sse=text=>new Response(text,{headers:{'Content-Type':'text/event-stream'}});
  assert.deepEqual(await decodeBusinessResponse(sse('event: progress\ndata: 生成中\n\nevent: result\ndata: {"saved":true}\n\n'),{}),{saved:true});
  await assert.rejects(decodeBusinessResponse(sse('event: error\ndata: 失败\n\n'),{}),/失败/);
  await assert.rejects(decodeBusinessResponse(sse('event: progress\ndata: 未完成\n\n'),{}),/中断/);
  await assert.rejects(boundedText(new Response('超出限制'),3),/大小限制/);
});
test('modern discovery and legacy initialization both serve the Dashboard identity',async()=>{
  for(const [method,params] of [['server/discover',{_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientInfo':{name:'test',version:'1'},'io.modelcontextprotocol/clientCapabilities':{}}}],['initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'test',version:'1'}}]]) {
    const {response,payload}=await rpc(fixture(),method,params);
    assert.equal(response.status,200,JSON.stringify(payload));assert.ok(payload.result,JSON.stringify(payload));if(method==='initialize') assert.equal(payload.result.serverInfo.name,'eastmoney-dashboard'); else assert.ok(payload.result.supportedVersions.includes('2026-07-28'));
  }
});
test('public credit materials remain unpublished even when public files are available',async()=>{
  const f=fixture();
  f.env.EASTMONEY={list(){assert.fail('Unpublished materials must not read R2')}};
  const {payload}=await rpc(f,'tools/call',{name:'credit_public_materials',arguments:{}});
  assert.ok(payload.error||payload.result.isError);
});
test('public credit search remains unpublished and cannot return indexed financial excerpts',async()=>{
  const f=fixture();
  f.env.CREDIT_SEARCH={search(){assert.fail('Unpublished search must not query AI Search')}};
  const {payload}=await rpc(f,'tools/call',{name:'credit_public_search',arguments:{query:'近几年的ROE是多少'}});
  assert.ok(payload.error||payload.result.isError);
});
