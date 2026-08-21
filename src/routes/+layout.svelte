<script lang="ts">
  import { onMount } from "svelte";

  import { applyPreferences, readPreferences } from "$lib/preferences";

  let { children } = $props();

  onMount(() => applyPreferences(readPreferences()));
</script>

{@render children()}
