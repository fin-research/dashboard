import { AccessError } from '$lib/server/access';
import { requireSameOrigin } from '$lib/server/dashboard-access';
import type { RequestHandler } from './$types';
class ProxyError extends Error { readonly status:number; constructor(status:number,message:string) {super(message);this.status=status;} }
const read = /^(?:borrowings|repayment-drafts\/[A-Za-z0-9_-]{1,100})$/;
const write = /^(?:borrowings\/parse|borrowings\/import|attachments|repayment-drafts)$/;
const proxy:RequestHandler = async ({request,params,url,locals,platform}) => {
  const headers={'Cache-Control':'no-store, private'};
  try {
    if (!locals.user) throw new AccessError(401,'请先登录');
    const permission = request.method==='GET' ? 'research.interbank:read' : 'research.interbank:import';
    if (!locals.user.authorization?.permissions.includes(permission)) throw new AccessError(403,'无权访问拆借台账');
    const path=params.path ?? '';
    if (!(request.method==='GET' ? read : write).test(path)) throw new ProxyError(404,'接口不存在');
    if (request.method==='POST') requireSameOrigin(request);
    if (!platform?.env.DATA) throw new AccessError(503,'资金系统暂不可用');
    const target=new URL(`/camel/${path}`,'https://data.internal');
    if (path==='borrowings') {
      for (const key of url.searchParams.keys()) if (!['date','current','size'].includes(key)) throw new ProxyError(400,'查询参数无效');
      target.search=url.search;
    } else if (url.search) throw new ProxyError(400,'查询参数无效');
    const forwardedHeaders=new Headers();
    for (const key of ['Content-Type','X-Filename']) if (request.headers.has(key)) forwardedHeaders.set(key,request.headers.get(key)!);
    const upstream=await platform.env.DATA.fetch(new Request(target,{
      method:request.method,headers:forwardedHeaders,
      ...(request.method==='POST'?{body:request.body,...{duplex:'half'}}:{}),redirect:'manual',
    }));
    if (upstream.status>=300 && upstream.status<400) throw new ProxyError(502,'资金系统响应无效');
    return new Response(upstream.body,{status:upstream.status,headers:{...headers,'Content-Type':'application/json'}});
  } catch(error) {
    return Response.json({error:error instanceof AccessError || error instanceof ProxyError?error.message:'资金系统请求失败',code:'INTERBANK_REQUEST_FAILED'},{status:error instanceof AccessError || error instanceof ProxyError?error.status:502,headers});
  }
};
export const GET=proxy;
export const POST=proxy;
