<script lang="ts">
  import { globalMessages } from "$lib/global-messages";

  import {
    buildTextReport,
    buildTextReportHtml,
    buildTextReportLinesFromText,
    normalizeTextReport,
  } from "../text-report";
  import { applyTextReportEdits } from "../text-report-editor";
  import type { MarketReportResource, ReportData } from "../types";

  export let data: ReportData;
  export let focusText = "";
  export let missingResources: MarketReportResource[] = [];
  export let dirty = false;
  export let saving = false;
  export let onDataChange: (
    data: ReportData,
    focusText: string,
  ) => void = () => {};
  export let onSave: (
    data: ReportData,
    focusText: string,
  ) => void | Promise<void> = () => {};

  let editor: HTMLDivElement;
  let html = "";
  let currentValue = "";
  let draftDirty = false;

  $: generatedValue = normalizeTextReport(
    buildTextReport(data, focusText, missingResources),
  );
  $: if (!draftDirty && generatedValue !== currentValue) {
    currentValue = generatedValue;
    html = buildTextReportHtml(
      buildTextReportLinesFromText(data, currentValue),
    );
  }

  function saveDraft(): void {
    currentValue = normalizeTextReport(editor.innerText);
    draftDirty = currentValue !== generatedValue;
  }

  function applyDraft(): ReturnType<typeof applyTextReportEdits> | null {
    if (!draftDirty) return { data, focusText, issues: [] };
    const result = applyTextReportEdits(
      data,
      focusText,
      currentValue,
      missingResources,
    );
    if (result.issues.length) {
      globalMessages.warning(result.issues.join("；"), {
        key: "market-report-text-edit",
        duration: 8000,
      });
      return null;
    }
    draftDirty = false;
    currentValue = normalizeTextReport(
      buildTextReport(result.data, result.focusText, missingResources),
    );
    html = buildTextReportHtml(
      buildTextReportLinesFromText(result.data, currentValue),
    );
    onDataChange(result.data, result.focusText);
    return result;
  }

  async function saveReport(): Promise<void> {
    const result = applyDraft();
    if (!result) return;
    await onSave(result.data, result.focusText);
  }

  function pastePlainText(event: ClipboardEvent): void {
    event.preventDefault();
    document.execCommand(
      "insertText",
      false,
      event.clipboardData?.getData("text/plain") ?? "",
    );
    saveDraft();
  }

  async function copyReport(): Promise<void> {
    const text = normalizeTextReport(editor?.innerText ?? currentValue);
    const richHtml = buildTextReportHtml(
      buildTextReportLinesFromText(data, text),
    );
    try {
      if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([text], { type: "text/plain" }),
            "text/html": new Blob([richHtml], { type: "text/html" }),
          }),
        ]);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else if (!copyPlainText(text)) {
        throw new Error("浏览器不支持剪贴板写入");
      }
      globalMessages.success("文字版报告已复制，可直接粘贴至微信笔记", {
        key: "market-report-copy",
      });
    } catch {
      if (copyPlainText(text)) {
        globalMessages.success("文字版报告已复制", {
          key: "market-report-copy",
        });
      } else {
        globalMessages.error("复制失败，请选中文字后手动复制", {
          key: "market-report-copy",
        });
      }
    }
  }

  function copyPlainText(text: string): boolean {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.inset = "0 auto auto -9999px";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
</script>

<article class="text-report" aria-label="文字版境内市场点评">
  <div class="text-report__toolbar" aria-label="文字版报告操作">
    {#if dirty || draftDirty}
      <span class="text-report__dirty" role="status">已修改，待保存</span>
    {/if}
    <button
      class="text-report__action"
      type="button"
      aria-label="复制文字版报告"
      title="复制文字版报告"
      onclick={copyReport}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <rect x="6.5" y="6.5" width="10" height="10" rx="1.5" />
        <path d="M13.5 6.5v-2A1.5 1.5 0 0 0 12 3H4.5A1.5 1.5 0 0 0 3 4.5V12a1.5 1.5 0 0 0 1.5 1.5h2" />
      </svg>
    </button>
    <button
      class:text-report__saving={saving}
      class="text-report__action"
      type="button"
      disabled={saving}
      aria-label="保存市场点评定稿"
      title="保存定稿"
      onclick={saveReport}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M4 3.5h10.5L17 6v10.5H4z" />
        <path d="M7 3.5v4h6v-4M7 16.5v-5h6v5" />
      </svg>
    </button>
  </div>
  <div
    bind:this={editor}
    bind:innerHTML={html}
    class="text-report__editor"
    contenteditable="true"
    role="textbox"
    aria-label="编辑文字版境内市场点评"
    aria-multiline="true"
    spellcheck="false"
    tabindex="0"
    oninput={saveDraft}
    onpaste={pastePlainText}
    onblur={applyDraft}
  ></div>
</article>
