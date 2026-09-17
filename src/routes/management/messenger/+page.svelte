<script lang="ts">
  import MessengerView from '$lib/messenger/MessengerView.svelte';
  let {data,form}=$props();
</script>
<MessengerView {...data} message={form?.message} />
