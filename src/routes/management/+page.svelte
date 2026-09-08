<script lang="ts">
  import { ArrowUpRight, ShieldCheck, UserRound, FileUp } from '@lucide/svelte';
  import ModuleCard from '../../components/ModuleCard.svelte';
  import PanelHeading from '$lib/trading-research/PanelHeading.svelte';
  const entries = [
    { href: '/management/people', title: '角色权限', icon: ShieldCheck, tone: 'primary', items: ['业务权限配置', '角色授权范围', '分组检索与批量选择'] },
    { href: '/profile', title: '个人管理', icon: UserRound, tone: 'secondary', items: ['个人资料与登录邮箱', '密码与账号安全', '行情显示偏好'] },
    { href: '/fund-report?upload=1', title: '资金日报', icon: FileUp, tone: 'accent', items: ['上传日报文件', '历史日报归档', '查看报告'] }
  ];
</script>

<div class="management-overview">
  <PanelHeading id="management-overview-title" title="管理" />
  <div class="management-entry-grid">
    {#each entries as entry}
      <ModuleCard class="management-entry">
        <div class={`management-icon management-icon--${entry.tone}`}><entry.icon size={28} aria-hidden="true" /></div>
        <h2>{entry.title}</h2>
        <ul>{#each entry.items as item}<li>{item}</li>{/each}</ul>
        <a class="btn btn-outline management-entry-action" href={entry.href}>进入{entry.title}<ArrowUpRight size={18} aria-hidden="true" /></a>
      </ModuleCard>
    {/each}
  </div>
</div>

<style>
  .management-overview { display: grid; gap: .5rem; }
  .management-entry-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr)); gap: 1.25rem; }
  .management-entry-grid :global(.management-entry) { display: flex; flex-direction: column; align-items: flex-start; gap: 1.25rem; padding: 1.5rem; }
  .management-icon { width: 56px; height: 56px; display: grid; place-items: center; border-radius: var(--radius-card); }
  .management-icon--primary { color: var(--color-primary); background: var(--brand-soft); }
  .management-icon--secondary { color: var(--color-secondary); background: color-mix(in srgb, var(--color-secondary) 9%, white); }
  .management-icon--accent { color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 9%, white); }
  h2 { margin: 0; font-size: 1.25rem; font-weight: bold; }
  ul { display: grid; gap: .75rem; margin: 0 0 .5rem; padding: 0; list-style: none; color: var(--muted); }
  .management-entry-action { width: 100%; margin-top: auto; justify-content: space-between; }
</style>
