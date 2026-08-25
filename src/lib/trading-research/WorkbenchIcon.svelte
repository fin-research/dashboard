<script lang="ts">
  import type { WorkbenchIconName } from "./demo-data";

  let { name, className = "" }: { name: WorkbenchIconName; className?: string } =
    $props();
</script>

<svg class={className} viewBox="0 0 24 24" aria-hidden="true">
  {#if name === "overview"}
    <rect x="3" y="3" width="7" height="7" rx="2" />
    <rect x="14" y="3" width="7" height="7" rx="2" />
    <rect x="3" y="14" width="7" height="7" rx="2" />
    <rect x="14" y="14" width="7" height="7" rx="2" />
  {:else if name === "trading"}
    <path d="M4 8h13m0 0-3-3m3 3-3 3M20 16H7m0 0 3-3m-3 3 3 3" />
  {:else if name === "credit"}
    <path d="M12 3 5 6v5c0 4.8 2.7 8.4 7 10 4.3-1.6 7-5.2 7-10V6l-7-3Z" />
    <path d="m9 12 2 2 4-4" />
  {:else if name === "research"}
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5v-16ZM20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5v-16Z" />
  {:else if name === "workflow"}
    <rect x="5" y="3.5" width="14" height="17" rx="2.5" />
    <path d="M8.5 9h7M8.5 13h5M8.5 17h3" />
  {:else if name === "bond"}
    <path d="M4 4h16v16H4zM8 16v-4m4 4V8m4 8v-6" />
  {:else if name === "financing-model"}
    <path d="M4 19V9m5 10V5m5 14v-7m5 7V8M3 21h18" />
  {:else if name === "back"}
    <path d="m14.5 5-7 7 7 7" />
  {:else if name === "calendar"}
    <path d="M4 6.5h16M7 3v3M17 3v3M5 4h14v17H5z" />
  {:else if name === "check"}
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12 2.5 2.5L16 9" />
  {:else if name === "chevron"}
    <path d="m15 18-6-6 6-6" />
  {:else if name === "database"}
    <ellipse cx="12" cy="5.5" rx="7.5" ry="3" />
    <path d="M4.5 5.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6M4.5 11.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6" />
  {:else if name === "funds"}
    <path d="M4 19V9m5 10V5m5 14v-7m5 7V8M3 21h18" />
  {:else if name === "menu"}
    <path d="M4 7h16M4 12h16M4 17h16" />
  {:else if name === "search"}
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m15.5 15.5 4 4" />
  {:else if name === "warning"}
    <path d="M12 3 2.8 20h18.4L12 3Z" />
    <path d="M12 9v5m0 3h.01" />
  {/if}
</svg>
