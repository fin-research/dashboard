import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){if(specifier.startsWith('$lib/'))return next(new URL('../src/lib/'+specifier.slice(5)+'.ts',import.meta.url).href,context);return next(specifier,context);}});
const {GET,POST}=await import('../src/routes/api/interbank/[...path]/+server.ts');
function event(path,method='GET',permissions=['research.interbank:read','research.interbank:import']){
 const url=new URL('https://example.test/api/interbank/'+path);const requests=[];
 return {url,params:{path:url.pathname.replace('/api/interbank/','')},request:new Request(url,{method,headers:{Origin:'https://example.test',Authorization:'Bearer browser-token',Cookie:'secret=browser','Content-Type':'application/json'},...(method==='POST'?{body:'{"records":[]}'}:{})}),locals:{user:{id:'auth0|test',authorization:{permissions}}},platform:{env:{DATA:{fetch:async request=>{requests.push(request);return Response.json({saved:true});}}}},requests};
}
test('interbank proxy fails closed for anonymous, wrong permission, origin and paths',async()=>{
 const anonymous=event('borrowings');anonymous.locals.user=null;assert.equal((await GET(anonymous)).status,401);
 assert.equal((await GET(event('borrowings','GET',[]))).status,403);
 assert.equal((await POST(event('borrowings/import','POST',['research.interbank:read']))).status,403);
 const foreign=event('attachments','POST');foreign.request.headers.set('Origin','https://other.test');assert.equal((await POST(foreign)).status,403);
 for(const path of ['session','login','repayment-drafts/12/submit','borrowings?token=bad'])assert.ok([400,404].includes((await GET(event(path))).status));
});
test('interbank proxy uses InternalData and strips credentials and upstream redirect',async()=>{
 const sample=event('borrowings/import','POST');assert.equal((await POST(sample)).status,200);
 const forwarded=sample.requests[0];assert.equal(forwarded.url,'https://data.internal/camel/borrowings/import');assert.equal(forwarded.headers.get('authorization'),null);assert.equal(forwarded.headers.get('cookie'),null);assert.equal(await forwarded.text(),'{"records":[]}');
 const redirect=event('borrowings');redirect.platform.env.DATA.fetch=async()=>new Response(null,{status:302,headers:{Location:'https://other.test'}});assert.equal((await GET(redirect)).status,502);
});
