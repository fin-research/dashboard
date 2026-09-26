import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'tsx/esm/api';
register();
const { handleDashboardMcp, executeOperation, decodeBusinessResponse, boundedText } = await import('../src/lib/server/mcp.ts');
const { mcpOperations, operationPath } = await import('../src/lib/server/mcp-catalog.ts');
const { clientRequestPermission } = await import('../src/lib/route-permissions.ts');
const { stringify } = await import('devalue');
const { auditedRoeSources } = await import('../src/lib/server/credit-public-roe.ts');
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
test('real MCP discovery lists only Gateway-approved tools and labels writes/generation',async()=>{
  const f=fixture(item=>item.method==='GET');
  const {response,payload}=await rpc(f,'tools/list');
  assert.equal(response.status,200);assert.ok(payload.result.tools.some(t=>t.name==='health'));
  assert.ok(payload.result.tools.some(t=>t.name==='credit_report'));
  assert.ok(!payload.result.tools.some(t=>t.name==='create_project'));
  const all=await rpc(fixture(),'tools/list');
  assert.equal(all.payload.result.tools.length,mcpOperations.length+3);
  assert.ok(all.payload.result.tools.some(t=>t.name==='credit_public_search'));
  assert.equal(all.payload.result.tools.find(t=>t.name==='generate_tracking_commentary').annotations.readOnlyHint,false);
  assert.equal(all.payload.result.tools.find(t=>t.name==='create_project').annotations.destructiveHint,true);
});
test('MCP calls validate shared schemas, reject hidden tools, and keep identities request-scoped',async()=>{
  const f=fixture();
  const invalid=await rpc(f,'tools/call',{name:'credit_report',arguments:{query:{date:'2026-02-30'}}});
  assert.ok(invalid.payload.error||invalid.payload.result.isError);assert.equal(f.calls.length,1);
  const restricted=fixture(()=>false);const denied=await rpc(restricted,'tools/call',{name:'create_project',arguments:{form:{}}});
  assert.ok(denied.payload.error||denied.payload.result.isError);assert.equal(restricted.calls.length,1);
  const anonymous=await rpc(f,'tools/list',{},null);assert.equal(anonymous.response.status,401);
  const health=await rpc(f,'tools/call',{name:'health',arguments:{}});assert.equal(health.payload.result.structuredContent.status,'ok');
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
  const result=await rpc(f,'tools/call',{name:'economic_indicators',arguments:{}});assert.equal(result.payload.result.isError,true);assert.match(result.payload.result.content[0].text,/403/);
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
test('public credit search exposes only current public PDF excerpts and original links',async()=>{
  const f=fixture();
  f.env.EASTMONEY={list:async()=>({objects:[{key:'credit/public/测试报告.pdf',size:100,uploaded:new Date('2026-09-01'),httpEtag:'etag'}],truncated:false})};
  f.env.CREDIT_SEARCH={search:async()=>({chunks:[
    {id:'visible',item:{key:'credit/public/测试报告.pdf'},text:'公开授信额度为10亿元'},
    {id:'hidden',item:{key:'credit/originals/内部报告.pdf'},text:'内部数据'},
  ]})};
  const {payload}=await rpc(f,'tools/call',{name:'credit_public_search',arguments:{query:'授信额度'}});
  assert.equal(payload.result.isError,undefined);
  const sources=payload.result.structuredContent.sources;
  assert.equal(sources.length,1);
  assert.equal(sources[0].title,'测试报告.pdf');
  assert.equal(sources[0].url,'/api/credit-assistant/files/%E6%B5%8B%E8%AF%95%E6%8A%A5%E5%91%8A.pdf');
  assert.equal(sources[0].locator,'AI Search 检索片段');
  assert.ok(!JSON.stringify(sources).includes('内部数据'));
  const materials=await rpc(f,'tools/call',{name:'credit_public_materials',arguments:{}});
  assert.deepEqual(materials.payload.result.structuredContent.documents.map(document=>document.title),['测试报告.pdf']);
});
test('ROE search returns verified annual tables before noisy excerpts and rejects changed originals',async()=>{
  const reports=[
    {year:2023,etag:'074f1743e4087111415d1ea6d71ff1ec',value:'9.75%'},
    {year:2024,etag:'c7e65bb5f836592812dd6e3c47cb220c',value:'11.64%'},
    {year:2025,etag:'38c1ac97ef61e3e5700a1498f4f639e4',value:'13.23%'},
  ];
  const f=fixture();
  f.env.EASTMONEY={list:async()=>({objects:reports.map(report=>({key:`credit/public/${report.year}审计报告.pdf`,etag:report.etag,size:100})),truncated:false})};
  const queries=[];
  f.env.CREDIT_SEARCH={search:async({query})=>{
    queries.push(query);
    const year=reports.find(report=>query.includes(String(report.year)));
    return {chunks:year?[{item:{key:`credit/public/${year.year}审计报告.pdf`},text:`OCR 乱码 ${year.value}`}]:[]};
  }};
  const {payload}=await rpc(f,'tools/call',{name:'credit_public_search',arguments:{query:'近几年的ROE是多少'}});
  assert.equal(payload.result.isError,undefined);
  const sources=payload.result.structuredContent.sources;
  assert.deepEqual(sources.slice(0,3).map(source=>source.text.match(/\d+\.\d+%/)[0]),['9.75%','11.64%','13.23%']);
  assert.deepEqual(sources.slice(0,3).map(source=>source.locator),[
    'PDF 第 110 页（补充资料第 1 页）','PDF 第 110 页（补充资料第 1 页）','PDF 第 111 页（补充资料第 1 页）',
  ]);
  assert.ok(queries.some(query=>query.includes('2023年 审计报告')));
  assert.ok(queries.some(query=>query.includes('2024年 审计报告')));
  assert.ok(queries.some(query=>query.includes('2025年 审计报告')));
  const changed=reports.map(report=>({key:`credit/public/${report.year}审计报告.pdf`,title:`${report.year}审计报告.pdf`,url:`/api/credit-assistant/files/${report.year}审计报告.pdf`,authority:'audited',etag:report.year===2025?'new-object':report.etag}));
  assert.deepEqual(auditedRoeSources(changed,'2025年ROE'),[]);
  assert.equal(auditedRoeSources(changed,'2024年ROE').length,1);
});
