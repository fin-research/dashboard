<script lang="ts">
  import WorkbenchShell from '../../../src/lib/workbench/WorkbenchShell.svelte';
  import MessengerView from '../../../src/lib/messenger/MessengerView.svelte';
  const failed={id:'fixture-message',source:'financing',channel:'email',status:'failed',subject:'融资项目节点提醒',recipient:'test@example.com',attempts:6,providerId:null,error:'EMAIL_RATE_LIMIT',createdAt:1789441200000,updatedAt:1789441200000,nextAttemptAt:1789441200000};
  const uncertain={...failed,id:'fixture-telegram',source:'ingest',channel:'telegram',status:'uncertain',subject:'中国央行：开展公开市场操作',recipient:'默认 Telegram',attempts:1};
</script>
<WorkbenchShell title="管理" homeHref="/management" views={[]} activeViewId="messenger" activeLabel="消息投递" tone="purple">
<MessengerView list={{items:[failed,uncertain],counts:[{status:'failed',count:1},{status:'uncertain',count:1}],nextCursor:null}} canRetry={true} detail={{...failed,content:{html:'<p>节点提醒</p>'},history:[{number:6,started_at:1789441200000,finished_at:1789441201000,status:'failed',provider_id:null,error:'EMAIL_RATE_LIMIT'}],retries:[]}} />

</WorkbenchShell>
