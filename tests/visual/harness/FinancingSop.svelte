<script lang="ts">
  import WorkbenchShell from '../../../src/lib/workbench/WorkbenchShell.svelte';
  import SopPage from '../../../src/routes/financing/sop/+page.svelte';
  import '../../../src/routes/financing/layout.css';
  import type { WorkbenchPageLink } from '../../../src/lib/workbench/navigation';
  import { PERMISSION_CODES } from '../../../src/lib/permissions';
  const views: WorkbenchPageLink[] = [{ id: 'sop', label: 'SOP 管理', href: '/financing/sop', icon: 'check' }];
  const data = { permissions: [...PERMISSION_CODES], user: null, account: null, session: null, auth0: true,
    reminders: { items: [], total: 0 }, settings: {
    sopTemplates: [{ id: 'short-term', name: '短期融资券发行 SOP', debtType: '短期融资券', isActive: true,
      description: '立项、申报、发行和存续期管理。', nodeCount: 2,
      nodes: [{ id: 'approval', name: '材料准备与内部审批' }, { id: 'issue', name: '簿记发行' }] }],
    reminderRules: [{ id: 'due', name: '任务到期提醒', isActive: true, recipientMode: 'assignee',
      periods: [{ leadHours: 24 }], targets: [{ sopName: '短期融资券发行 SOP', name: '簿记发行' }] }],
  } };
</script>

<WorkbenchShell title="融资工作台" homeHref="/financing/" {views} activeViewId="sop" class="financing-scope">
  <SopPage {data} />
</WorkbenchShell>
