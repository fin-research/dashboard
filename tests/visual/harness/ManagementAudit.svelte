<script lang="ts">
  import ManagementLayout from '../../../src/routes/management/+layout.svelte';
  import People from '../../../src/routes/management/people/+page.svelte';
  import Me from '../../../src/routes/management/me/+page.svelte';
  import Notifications from '../../../src/routes/management/notifications/+page.svelte';
  import {managementAudit} from '../management-fixtures.mjs';
  const path=window.location.pathname;
</script>
<ManagementLayout>
  {#if path==='/management/people'}<People data={managementAudit} />
  {:else if path==='/management/me'}<Me data={managementAudit} />
  {:else}<Notifications />{/if}
</ManagementLayout>
