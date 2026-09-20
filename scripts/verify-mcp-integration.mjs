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
let progressRow=null;
const appEnv={IDENTITY:{fetch:r=>identityService(r,f.env)},EASTMONEY:{async list(){return {objects:[],truncated:false};}},DB:{prepare(sql){let args;return {bind(...values){args=values;return this},async first(){return progressRow},async run(){if(sql.startsWith('INSERT'))progressRow={state:args[2],revision:1};else progressRow={state:args[0],revision:progressRow.revision+1};return {meta:{changes:1}}}}}}};
const server=new Server(manifest);await server.init({env:appEnv});
f.env.DASHBOARD={fetch(request){const context=JSON.parse(Buffer.from(request.headers.get('X-Eastmoney-Gateway-Context'),'base64url'));const headers=new Headers(request.headers);headers.delete('X-Eastmoney-Gateway-Context');headers.set('Host','eastmoney.hasbai.xyz');return server.respond(new Request(request,{headers}),{getClientAddress:()=> '127.0.0.1',platform:{env:{...appEnv,GATEWAY_CONTEXT:context},context:{waitUntil(){}}}})}};
const token=await f.signed({azp:'portal'});
async function rpc(method,params={}) {const response=await gatewayRequest(new Request(f.env.SITE_ORIGIN+'/api/mcp',{method:'POST',headers:{Authorization:'Bearer '+token,Host:'eastmoney.hasbai.xyz','Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),f.env);const text=await response.text();assert.equal(response.status,200,text);const value=response.headers.get('Content-Type')?.includes('text/event-stream')?text.split('\n').filter(v=>v.startsWith('data: ')).map(v=>JSON.parse(v.slice(6))).find(v=>v.id===1):JSON.parse(text);return value.error?{isError:true,rpcError:value.error}:value.result;}
try{
const list=await rpc('tools/list');assert.ok(list.tools.length>60);
const call=(name,args={})=>rpc('tools/call',{name,arguments:args});
assert.equal((await call('health')).structuredContent.status,'ok');
const funds=await call('fund_reports');assert.equal(funds.isError,undefined,JSON.stringify(funds));assert.deepEqual(funds.structuredContent.data.reports,[]);
const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date());
const saved=await call('save_trading_progress',{body:{date,completed:{mcp_test:true}}});assert.equal(saved.isError,undefined,JSON.stringify(saved));assert.equal(saved.structuredContent.data.state.completed.mcp_test,true);
const read=await call('trading_progress');assert.equal(read.structuredContent.data.state.completed.mcp_test,true);
// Original action validation runs and produces an MCP business error, without a database write.
const bad=await call('update_project',{form:{id:'nonexistent',name:''}});assert.equal(bad.isError,true,JSON.stringify(bad));assert.equal(bad.structuredContent.data.status,400);
await f.updateGrants([]);const denied=await call('save_trading_progress',{body:{date,completed:{mcp_test:false}}});assert.ok(denied.isError);assert.equal(JSON.parse(progressRow.state).completed.mcp_test,true);
console.log(JSON.stringify({integration:true,tools:list.tools.length,realGateway:true,builtSvelteKit:true,pageRead:true,writeReadback:true,namedActionValidation:true,permissionRevocation:true,externalServices:'mocked',browserUsed:false}));
}finally{for(const fn of cleanup)fn()}
