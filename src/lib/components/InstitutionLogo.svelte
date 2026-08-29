<script lang="ts">
  import { resolveInstitutionLogo } from "$lib/sell-side-institutions";

  export let institution: string;

  $: logo = resolveInstitutionLogo(institution);
</script>

{#if logo}
  <span class="institution-logo" aria-hidden="true">
    <img
      src={logo.src}
      alt=""
      width="76"
      height="32"
      loading="lazy"
      decoding="async"
    />
  </span>
{/if}

<style>
  .institution-logo {
    display: inline-flex;
    box-sizing: border-box;
    width: 76px;
    height: 32px;
    flex: 0 0 76px;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    padding: 4px 6px;
    border: 1px solid color-mix(in srgb, var(--brand) 12%, var(--line));
    border-radius: 7px;
    background: #fff;
  }

  .institution-logo img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
</style>
