<script lang="ts">
  import { onMount } from "svelte";

  import GlobalMessages from "$lib/GlobalMessages.svelte";
  import { applyPreferences, readPreferences } from "$lib/preferences";

  let { children } = $props();

  onMount(() => applyPreferences(readPreferences()));
</script>

<GlobalMessages />
{@render children()}
