<script lang="ts">
  import { prefersReducedMotion } from "svelte/motion";
  import { fly } from "svelte/transition";
  import {
    FOCUS_STORAGE_PREFIX,
    LEGACY_FOCUS_STORAGE_PREFIX,
    focusFormatCommand,
    focusHtmlToPlainText,
    normalizeFocusText,
    plainTextToFocusHtml,
  } from "../focus-editor";
  import type { MarketBriefing } from "../types";

  export let generating = false;
  export let disabled = false;
  export let progressText = "正在分析股债市场";
  export let summaries: Array<{ id: string; text: string }> = [];

  export let reportDate: string;
  export let generatedBriefing: MarketBriefing | null = null;
  export let initialText = "";
  export let finalizedAt: string | null = null;
  export let onTextChange: (value: string) => void = () => {};
  export let onBriefingApplied: (value: MarketBriefing) => void = () => {};

  const PLACEHOLDER =
    "1. 输入流动性、固收或权益市场的关键判断\n2. 每条聚焦一个结论，建议保留 2–3 条";
  let editor: HTMLDivElement;
  let loadedSource = "";
  let html = "";
  let empty = true;
  let appliedBriefing: MarketBriefing | null = null;
  let wasGenerating = false;

  $: currentProgress = summaries.at(-1) ?? { id: `status:${progressText}`, text: progressText };
  $: progressMessage = currentProgress.text.replace(/\*\*/g, "");

  $: if (
    reportDate &&
    `${reportDate}:${finalizedAt ?? "draft"}` !== loadedSource
  ) {
    loadedSource = `${reportDate}:${finalizedAt ?? "draft"}`;
    try {
      const saved = window.localStorage.getItem(
        `${FOCUS_STORAGE_PREFIX}${reportDate}`,
      );
      const legacy = window.localStorage.getItem(
        `${LEGACY_FOCUS_STORAGE_PREFIX}${reportDate}`,
      );
      html = finalizedAt
        ? plainTextToFocusHtml(initialText)
        : saved
          ? migrateLegacyEmphasis(saved)
          : plainTextToFocusHtml(legacy ?? "");
      if (saved && html !== saved) {
        window.localStorage.setItem(
          `${FOCUS_STORAGE_PREFIX}${reportDate}`,
          html,
        );
      }
      empty = !visibleText(html);
      onTextChange(focusHtmlToPlainText(html));
    } catch {
      html = "";
      empty = true;
      onTextChange("");
    }
  }

  $: if (generating !== wasGenerating) {
    wasGenerating = generating;
    if (generating) clearForGeneration();
  }

  function clearForGeneration(): void {
    html = "";
    empty = true;
    onTextChange("");
    try {
      window.localStorage.removeItem(`${FOCUS_STORAGE_PREFIX}${reportDate}`);
      window.localStorage.removeItem(`${LEGACY_FOCUS_STORAGE_PREFIX}${reportDate}`);
    } catch {
      // Clearing the editor does not depend on browser storage availability.
    }
  }

  $: if (
    generatedBriefing &&
    generatedBriefing !== appliedBriefing &&
    generatedBriefing.report_date === reportDate
  ) {
    appliedBriefing = generatedBriefing;
    html = plainTextToFocusHtml(`1、${generatedBriefing.stock}\n2、${generatedBriefing.bond}`);
    empty = !visibleText(html);
    onTextChange(focusHtmlToPlainText(html));
    try {
      window.localStorage.setItem(
        `${FOCUS_STORAGE_PREFIX}${reportDate}`,
        html,
      );
    } catch {
      // The generated text remains editable if browser storage is unavailable.
    }
    onBriefingApplied(generatedBriefing);
  }

  function save(): void {
    if (!reportDate) return;
    html = editor.innerHTML;
    const normalized = normalizeFocusText(editor.innerText);
    empty = !normalized;
    onTextChange(normalized);
    try {
      if (normalized) {
        window.localStorage.setItem(
          `${FOCUS_STORAGE_PREFIX}${reportDate}`,
          html,
        );
      } else {
        window.localStorage.removeItem(
          `${FOCUS_STORAGE_PREFIX}${reportDate}`,
        );
      }
    } catch {
      // The editor remains usable if browser storage is unavailable.
    }
  }

  function format(event: KeyboardEvent): void {
    const command = focusFormatCommand(event);
    if (!command) return;
    event.preventDefault();
    editor.focus();
    if (command === "emphasis") {
      document.execCommand("styleWithCSS", false, "true");
      document.execCommand("foreColor", false, themeColor());
    } else {
      document.execCommand(command, false);
    }
    save();
  }

  function pastePlainText(event: ClipboardEvent): void {
    event.preventDefault();
    document.execCommand(
      "insertText",
      false,
      event.clipboardData?.getData("text/plain") ?? "",
    );
    save();
  }

  function visibleText(value: string): boolean {
    return Boolean(focusHtmlToPlainText(value));
  }

  function migrateLegacyEmphasis(value: string): string {
    const container = document.createElement("div");
    container.innerHTML = value;
    for (const element of container.querySelectorAll<HTMLElement>("[style]")) {
      if (!element.style.backgroundColor) continue;
      element.style.removeProperty("background-color");
      element.style.color = themeColor();
      if (!element.style.length) element.removeAttribute("style");
    }
    return container.innerHTML;
  }

  function themeColor(): string {
    return getComputedStyle(document.documentElement)
      .getPropertyValue("--color-primary")
      .trim();
  }
</script>

{#if generating}
  <div class="focus-progress" role="status" aria-live="polite" aria-atomic="true" aria-label="今日聚焦生成进度">
    <div class="focus-progress-copy">
      {#key currentProgress.id}
        <span
          class="focus-progress-message"
          title={progressMessage}
          in:fly={{ y: prefersReducedMotion.current ? 0 : 6, duration: prefersReducedMotion.current ? 0 : 180, delay: prefersReducedMotion.current ? 0 : 120 }}
          out:fly={{ y: prefersReducedMotion.current ? 0 : -6, duration: prefersReducedMotion.current ? 0 : 120 }}
        >{progressMessage}</span>
      {/key}
    </div>
  </div>
{/if}
<div
  bind:this={editor}
  class="focus-editor"
  contenteditable="true"
  inert={generating || disabled}
  role="textbox"
  aria-label="输入今日聚焦"
  aria-keyshortcuts="Control+B Meta+B Control+I Meta+I Control+U Meta+U Control+Shift+H Meta+Shift+H"
  aria-multiline="true"
  data-empty={empty}
  data-placeholder={generating ? "" : PLACEHOLDER}
  spellcheck="false"
  tabindex="0"
  bind:innerHTML={html}
  onkeydown={format}
  oninput={save}
  onpaste={pastePlainText}
></div>

<style>
  .focus-progress {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding-block: 0.5rem;
    color: var(--color-primary);
    font-family: var(--font);
    font-size: 1rem;
  }
  .focus-progress-copy { display: grid; flex: 1; min-width: 0; overflow: hidden; }
  .focus-progress-message {
    grid-area: 1 / 1;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    overflow: hidden;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    line-height: 1.5;
  }
</style>
