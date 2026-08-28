<script lang="ts">
  import { resolveInstitutionLogo } from "$lib/sell-side-institutions";

  export let institution: string;

  $: logo = resolveInstitutionLogo(institution);
</script>

<span
  class="institution-logo"
  style={`--institution-logo-color: ${logo.foreground}; --institution-logo-background: ${logo.background};`}
  aria-hidden="true"
>{logo.mark}</span>

<style>
  .institution-logo {
    display: inline-grid;
    width: 32px;
    height: 32px;
    flex: 0 0 32px;
    place-items: center;
    border: 1px solid color-mix(in srgb, var(--institution-logo-color) 18%, transparent);
    border-radius: 8px;
    color: var(--institution-logo-color);
    background: var(--institution-logo-background);
    font-size: 0.75rem;
    font-weight: bold;
    line-height: 1;
  }
</style>
