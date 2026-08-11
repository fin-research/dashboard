<script lang="ts">
  import {
    focusFormatCommand,
    normalizeFocusText,
    plainTextToFocusHtml,
  } from "../focus-editor";
  import type { MarketBriefing } from "../types";

  export let reportDate: string;
  export let generatedBriefing: MarketBriefing | null = null;

  const STORAGE_PREFIX = "dm-market-report:focus-rich:v1:";
  const LEGACY_STORAGE_PREFIX = "dm-market-report:widescreen-focus:v1:";
  const PLACEHOLDER =
    "1. 输入流动性、固收或权益市场的关键判断\n2. 每条聚焦一个结论，建议保留 2–3 条";
  let editor: HTMLDivElement;
  let loadedDate = "";
  let html = "";
  let empty = true;
  let appliedBriefing: MarketBriefing | null = null;

  $: if (reportDate && reportDate !== loadedDate) {
    loadedDate = reportDate;
    try {
      const saved = window.localStorage.getItem(
        `${STORAGE_PREFIX}${reportDate}`,
      );
      const legacy = window.localStorage.getItem(
        `${LEGACY_STORAGE_PREFIX}${reportDate}`,
      );
      html = saved
        ? migrateLegacyEmphasis(saved)
        : plainTextToFocusHtml(legacy ?? "");
      if (saved && html !== saved) {
        window.localStorage.setItem(`${STORAGE_PREFIX}${reportDate}`, html);
      }
      empty = !visibleText(html);
    } catch {
      html = "";
      empty = true;
    }
  }

  $: if (
    generatedBriefing &&
    generatedBriefing !== appliedBriefing &&
    generatedBriefing.report_date === reportDate
  ) {
    appliedBriefing = generatedBriefing;
    html = plainTextToFocusHtml(generatedBriefing.content);
    empty = !visibleText(html);
    try {
      window.localStorage.setItem(`${STORAGE_PREFIX}${reportDate}`, html);
    } catch {
      // The generated text remains editable if browser storage is unavailable.
    }
  }

  function save(): void {
    if (!reportDate) return;
    html = editor.innerHTML;
    const normalized = normalizeFocusText(editor.innerText);
    empty = !normalized;
    try {
      if (normalized) {
        window.localStorage.setItem(
          `${STORAGE_PREFIX}${reportDate}`,
          html,
        );
      } else {
        window.localStorage.removeItem(`${STORAGE_PREFIX}${reportDate}`);
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
    const container = document.createElement("div");
    container.innerHTML = value;
    return Boolean(normalizeFocusText(container.innerText));
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

<div
  bind:this={editor}
  class="focus-editor"
  contenteditable="true"
  role="textbox"
  aria-label="输入今日聚焦"
  aria-keyshortcuts="Control+B Meta+B Control+I Meta+I Control+U Meta+U Control+Shift+H Meta+Shift+H"
  aria-multiline="true"
  data-empty={empty}
  data-placeholder={PLACEHOLDER}
  spellcheck="false"
  tabindex="0"
  bind:innerHTML={html}
  onkeydown={format}
  oninput={save}
  onpaste={pastePlainText}
></div>
