<script lang="ts">
import { page } from '$app/state';
import WorkbenchShell from '$lib/workbench/WorkbenchShell.svelte';
import type { WorkbenchIconName } from '$lib/trading-research/demo-data';
let { children } = $props();
const views: {id:string;label:string;href:string;icon:WorkbenchIconName;permission?:string;separatorBefore?:boolean}[] = [
 {id:'me',label:'我的',href:'/management/me',icon:'user'},
 {id:'permissions',label:'权限',href:'/management/permissions',icon:'credit'},
 {id:'notifications',label:'通知',href:'/management/notifications',icon:'file'},
 {id:'messenger',label:'消息投递',href:'/management/messenger',icon:'file',permission:'admin',separatorBefore:true},
 {id:'people',label:'角色权限',href:'/management/people',icon:'credit',permission:'admin'},
 {id:'fund-report',label:'资金日报',href:'/fund-report?upload=1',icon:'file',permission:'admin'}
];
const activeViewId = $derived(page.url.pathname.split('/')[2] ?? 'me');
</script>
<WorkbenchShell title="管理" homeHref="/management/me" {views} {activeViewId} class="management-scope" tone="purple">{@render children()}</WorkbenchShell>
