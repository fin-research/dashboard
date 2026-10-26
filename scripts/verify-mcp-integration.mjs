// Programmatic real-handler integration; external services use isolated in-memory fixtures.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
const gateway=resolve(process.env.GATEWAY_CHECKOUT || '../gateway');
const dashboard=resolve('.');
const { fixture } = await import(gateway+'/tests/helpers/fixture.mjs');
const { gatewayRequest } = await import(gateway+'/src/app.ts');
const { identityService } = await import(gateway+'/src/identity-service.ts');
const { Server } = await import(dashboard+'/.svelte-kit/output/server/index.js');
const { manifest } = await import(dashboard+'/.svelte-kit/output/server/manifest.js');
const cleanup=[];const f=await fixture({after:fn=>cleanup.push(fn)});f.env.AUTH0_MCP_CLIENT_ID='portal';
const appEnv={IDENTITY:{fetch:r=>identityService(r,f.env)}};
const server=new Server(manifest);await server.init({env:appEnv});
f.env.DASHBOARD={fetch(request){const context=JSON.parse(Buffer.from(request.headers.get('X-Eastmoney-Gateway-Context'),'base64url'));const headers=new Headers(request.headers);headers.delete('X-Eastmoney-Gateway-Context');headers.set('Host','eastmoney.hasbai.xyz');return server.respond(new Request(request,{headers}),{getClientAddress:()=> '127.0.0.1',platform:{env:{...appEnv,GATEWAY_CONTEXT:context},context:{waitUntil(){}}}})}};
const token=await f.signed({azp:'portal'});
async function rpc(method,params={}) {const response=await gatewayRequest(new Request(f.env.SITE_ORIGIN+'/api/mcp',{method:'POST',headers:{Authorization:'Bearer '+token,Host:'eastmoney.hasbai.xyz','Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),f.env);const text=await response.text();assert.equal(response.status,200,text);const value=response.headers.get('Content-Type')?.includes('text/event-stream')?text.split('\n').filter(v=>v.startsWith('data: ')).map(v=>JSON.parse(v.slice(6))).find(v=>v.id===1):JSON.parse(text);return value.error?{isError:true,rpcError:value.error}:value.result;}
try{
const list=await rpc('tools/list');assert.deepEqual(list.tools.map(tool=>tool.name),['credit_report']);
const call=(name,args={})=>rpc('tools/call',{name,arguments:args});
for(const name of ['health','fund_reports','save_trading_progress','trading_progress','update_project','credit_public_search','dashboard_credit_report'])assert.ok((await call(name)).isError,name);
// Invalid arguments are rejected before any business database connection.
assert.ok((await call('credit_report',{query:{view:'usage'}})).isError);
assert.ok((await call('credit_report',{query:{date:'2026-02-30'}})).isError);
await f.updateGrants([]);
assert.deepEqual((await rpc('tools/list')).tools,[]);
assert.ok((await call('credit_report')).isError);
console.log(JSON.stringify({integration:true,tools:list.tools.length,realGateway:true,builtSvelteKit:true,unpublishedToolsRejected:true,inputValidation:true,permissionRevocation:true,externalServices:'mocked',browserUsed:false}));
}finally{for(const fn of cleanup)fn()}
