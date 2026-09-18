<script lang="ts">
  import * as Tabs from '$lib/components/ui/tabs/index.js';
  import MessengerView from './MessengerView.svelte';
  import TestMessageView from './TestMessageView.svelte';
  import type {DeliveryList,DeliveryDetail,TestRecipient} from './types';
  let {list,detail=null,filters={},canRetry=false,canSend=false,people=[],requestId,message}:{list:DeliveryList;detail?:DeliveryDetail|null;filters?:Record<string,string>;canRetry?:boolean;canSend?:boolean;people?:TestRecipient[];requestId:string;message?:string}=$props();
  let tab=$state('delivery');
</script>
<Tabs.Root bind:value={tab}>
  <Tabs.List aria-label="通知管理"><Tabs.Trigger value="delivery">消息投递</Tabs.Trigger>{#if canSend}<Tabs.Trigger value="test">测试消息</Tabs.Trigger>{/if}</Tabs.List>
  <Tabs.Content value="delivery"><MessengerView {list} {detail} {filters} {canRetry} {message}/></Tabs.Content>
  {#if canSend}<Tabs.Content value="test"><TestMessageView {people} {requestId} {canSend}/></Tabs.Content>{/if}
</Tabs.Root>
