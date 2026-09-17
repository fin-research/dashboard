import { error, fail } from '@sveltejs/kit';
import { hasPermission } from '$lib/permissions';
import { messengerJson, messengerRequest, type DeliveryList, type DeliveryDetail } from '$lib/server/messenger';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform, locals, url }) => {
  if (!hasPermission(locals.user?.authorization?.permissions,'messenger.delivery:read')) error(403,'无消息查看权限');
  const query=new URLSearchParams();
  for(const key of ['status','channel','source','before']) { const value=url.searchParams.get(key); if(value)query.set(key,value); }
  const binding=platform!.env.MESSENGER_ADMIN;
  try {
    const list=await messengerJson<DeliveryList>(binding,`/messages?${query}`);
    const id=url.searchParams.get('id');
    const detail=id && /^[a-zA-Z0-9-]{1,80}$/.test(id) ? await messengerJson<DeliveryDetail>(binding,`/messages/${id}`) : null;
    return { list, detail, filters: Object.fromEntries(query), canRetry:hasPermission(locals.user?.authorization?.permissions,'messenger.delivery:retry') };
  } catch { error(503,'消息中台暂时不可用'); }
};
export const actions: Actions = {
  retry: async ({request,platform,locals}) => {
    if(!hasPermission(locals.user?.authorization?.permissions,'messenger.delivery:retry')) return fail(403,{message:'无消息重试权限'});
    const form=await request.formData(),id=String(form.get('id') ?? '');
    if(!/^[a-zA-Z0-9-]{1,80}$/.test(id))return fail(400,{message:'消息编号无效'});
    try {
      const response=await messengerRequest(platform!.env.MESSENGER_ADMIN,`/messages/${id}/retry`,{
        actor:locals.user!.auth0Id ?? locals.user!.id,confirmUncertain:form.get('confirmUncertain')==='yes',
      });
      if(!response.ok)return fail(response.status===409?409:503,{message:response.status===409?'消息状态已变化，请刷新后重试':'重试提交失败'});
      return {message:'已加入重试队列'};
    }catch{return fail(503,{message:'消息中台暂时不可用'});}
  },
};
