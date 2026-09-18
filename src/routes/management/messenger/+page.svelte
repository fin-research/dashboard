<script lang="ts">
  import NotificationManagement from '$lib/messenger/NotificationManagement.svelte';
  let {data,form}=$props();
</script>
<NotificationManagement {...data} message={form?.message} />
