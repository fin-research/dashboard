<script lang="ts">
  import { onDestroy } from "svelte";
  import { prefersReducedMotion } from "svelte/motion";
  import { fly } from "svelte/transition";

  import { globalMessages } from "$lib/global-messages";

  onDestroy(globalMessages.clear);

  function resumeAfterFocusLeaves(event: FocusEvent, id: string): void {
    const region = event.currentTarget as HTMLElement;
    if (!region.contains(event.relatedTarget as Node | null)) {
      globalMessages.resume(id, "focus");
    }
  }
</script>

<div class="global-message-region" aria-label="系统消息">
  {#each $globalMessages as item (item.id)}
    <article
      class={`global-message ${item.kind}`}
      onpointerenter={() => globalMessages.pause(item.id, "pointer")}
      onpointerleave={() => globalMessages.resume(item.id, "pointer")}
      onfocusin={() => globalMessages.pause(item.id, "focus")}
      onfocusout={(event) => resumeAfterFocusLeaves(event, item.id)}
      transition:fly={{
        y: prefersReducedMotion.current ? 0 : -12,
        duration: prefersReducedMotion.current ? 0 : 180,
      }}
    >
      <span class="message-icon" aria-hidden="true">
        {#if item.kind === "success"}
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></svg>
        {:else if item.kind === "error"}
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v6M12 17h.01" /></svg>
        {:else if item.kind === "warning"}
          <svg viewBox="0 0 24 24"><path d="M10.3 4.4 3.2 17a2 2 0 0 0 1.8 3h14a2 2 0 0 0 1.8-3L13.7 4.4a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 16.5h.01" /></svg>
        {:else}
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5h.01" /></svg>
        {/if}
      </span>
      <span
        class="message-copy"
        role={item.kind === "error" ? "alert" : "status"}
        aria-atomic="true"
      >
        <strong>{item.title}</strong>
        <span>{item.message}</span>
      </span>
      <button
        type="button"
        aria-label={`关闭通知：${item.message}`}
        title="关闭通知"
        onclick={() => globalMessages.dismiss(item.id)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg>
      </button>
    </article>
  {/each}
</div>

<style>
  .global-message-region {
    position: fixed;
    z-index: 80;
    top: max(1rem, env(safe-area-inset-top));
    right: 0;
    left: 0;
    display: grid;
    justify-items: center;
    gap: 0.625rem;
    padding-inline: 1rem;
    pointer-events: none;
  }

  .global-message {
    --message-color: var(--brand, #2f6fd6);
    display: grid;
    width: min(34rem, 100%);
    min-height: 4.25rem;
    grid-template-columns: 2.5rem minmax(0, 1fr) 2.75rem;
    align-items: center;
    gap: 0.75rem;
    padding: 0.625rem 0.625rem 0.625rem 0.75rem;
    border: 1px solid color-mix(in srgb, var(--message-color) 28%, var(--line, #d8e2f0));
    border-left: 0.25rem solid var(--message-color);
    border-radius: var(--radius-card, 10px);
    color: var(--ink, #172033);
    background: rgb(255 255 255 / 97%);
    box-shadow:
      0 1rem 2.5rem rgb(16 24 40 / 18%),
      0 0.125rem 0.375rem rgb(16 24 40 / 8%);
    backdrop-filter: blur(0.75rem);
    pointer-events: auto;
  }

  .global-message.success {
    --message-color: var(--green, #12a873);
  }

  .global-message.error {
    --message-color: var(--red, #d92d20);
  }

  .global-message.warning {
    --message-color: var(--color-accent, #ff7a45);
  }

  .message-icon {
    display: grid;
    width: 2.5rem;
    height: 2.5rem;
    place-items: center;
    border-radius: var(--radius-tag, 6px);
    color: var(--message-color);
    background: color-mix(in srgb, var(--message-color) 10%, white);
  }

  .message-icon svg,
  button svg {
    width: 1.25rem;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 2;
  }

  .message-copy {
    display: grid;
    min-width: 0;
    gap: 0.125rem;
    line-height: 1.45;
  }

  .message-copy strong {
    color: color-mix(in srgb, var(--message-color) 78%, #182230);
    font-size: 0.75rem;
    font-weight: bold;
    letter-spacing: 0.03em;
  }

  .message-copy > span {
    color: #344054;
    font-size: 1rem;
    overflow-wrap: anywhere;
  }

  button {
    display: grid;
    width: 2.75rem;
    height: 2.75rem;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: var(--radius-tag, 6px);
    color: #667085;
    background: transparent;
    cursor: pointer;
    transition:
      color 180ms ease,
      background 180ms ease;
  }

  button:hover {
    color: #1d2939;
    background: #f2f4f7;
  }

  button:focus-visible {
    outline: 0.1875rem solid rgb(47 111 237 / 22%);
    outline-offset: 0.125rem;
  }

  @media (max-width: 35rem) {
    .global-message-region {
      padding-inline: 0.5rem;
    }

    .global-message {
      grid-template-columns: 2.25rem minmax(0, 1fr) 2.75rem;
      gap: 0.625rem;
      padding-left: 0.625rem;
    }

    .message-icon {
      width: 2.25rem;
      height: 2.25rem;
    }
  }
</style>
