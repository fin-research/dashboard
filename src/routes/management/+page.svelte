<script lang="ts">
import ModuleCard from '../../components/ModuleCard.svelte';
import PanelHeading from '$lib/trading-research/PanelHeading.svelte';
const entries = [
  { href: '/profile', title: '个人信息', text: '维护账号资料、登录邮箱、密码和显示偏好' },
  { href: '/management/people', title: '人员与权限', text: '维护业务人员、登录账号关联、角色和权限' },
  { href: '/management/financing-profile', title: '融资人员资料', text: '维护融资人员名称与头像' },
  { href: '/fund-report?upload=1', title: '资金日报', text: '查看与上传资金日报' }
];
</script>
<div class="management-entry-grid">
{#each entries as entry, index}
  <ModuleCard><PanelHeading id={`management-entry-${index}`} title={entry.title} /><p>{entry.text}</p><a href={entry.href}>进入{entry.title}</a></ModuleCard>
{/each}
</div>
<style>.management-entry-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr)); gap: 18px; } p { margin-block: 0 1rem; } a { display: inline-flex; align-items: center; min-height: 44px; color: var(--color-primary); }</style>
