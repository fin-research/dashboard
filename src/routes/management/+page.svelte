<script lang="ts">
  import {
    fundReportDateFromFileName,
    fundReportFileName,
    MAX_FUND_REPORT_BYTES,
  } from "$lib/fund-report";
  import { globalMessages } from "$lib/global-messages";

  interface UploadResult {
    date: string;
    fileName: string;
    url: string;
    replaced: boolean;
  }

  let fileInput: HTMLInputElement;
  let selectedFile: File | null = null;
  let selectedDate = "";
  let uploading = false;
  let lastUpload: UploadResult | null = null;

  function chooseFile(): void {
    fileInput.click();
  }

  function handleFileSelection(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    selectedFile = null;
    selectedDate = "";
    lastUpload = null;
    if (!file) return;

    const reportDate = fundReportDateFromFileName(file.name);
    if (!reportDate) {
      input.value = "";
      globalMessages.error(
        "文件名末尾必须包含有效日期，例如 资金日报驾驶舱交互版_20260824.html",
        { key: "fund-report-upload", title: "文件名无效", duration: 8000 },
      );
      return;
    }
    if (file.size <= 0 || file.size > MAX_FUND_REPORT_BYTES) {
      input.value = "";
      globalMessages.error("资金日报文件必须大于 0 且不超过 20 MB", {
        key: "fund-report-upload",
        title: "文件大小无效",
        duration: 8000,
      });
      return;
    }
    selectedFile = file;
    selectedDate = reportDate;
  }

  async function uploadFundReport(): Promise<void> {
    if (!selectedFile || !selectedDate || uploading) return;
    uploading = true;
    const operationMessage = globalMessages.info(
      `正在上传 ${selectedFile.name}`,
      {
        key: "fund-report-upload",
        title: "资金日报处理中",
        duration: 120_000,
      },
    );
    try {
      const response = await fetch("/api/fund-report", {
        method: "POST",
        headers: {
          "Content-Type": "text/html",
          "X-Fund-Report-Filename": encodeURIComponent(selectedFile.name),
          "X-Fund-Report-Size": String(selectedFile.size),
        },
        body: selectedFile,
      });
      const payload = (await response.json()) as UploadResult & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "资金日报上传失败");
      }
      if (operationMessage) globalMessages.dismiss(operationMessage);
      lastUpload = payload;
      selectedFile = null;
      selectedDate = "";
      fileInput.value = "";
      globalMessages.success(
        `${payload.fileName} 已${payload.replaced ? "更新" : "上传"}`,
        { key: "fund-report-upload", title: "资金日报已保存", duration: 8000 },
      );
    } catch (error) {
      if (operationMessage) globalMessages.dismiss(operationMessage);
      globalMessages.error(
        error instanceof Error ? error.message : String(error),
        { key: "fund-report-upload", title: "资金日报上传失败", duration: 8000 },
      );
    } finally {
      uploading = false;
    }
  }

  function formatSize(size: number): string {
    return size >= 1024 * 1024
      ? `${(size / 1024 / 1024).toFixed(2)} MB`
      : `${Math.max(1, Math.round(size / 1024))} KB`;
  }
</script>

<svelte:head>
  <title>管理 · 资金管理部</title>
  <meta name="description" content="资金日报上传管理" />
</svelte:head>

<div class="management-page">
  <header class="management-masthead">
    <a class="home-link" href="/" aria-label="返回市场研究首页">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7M8 12h11" /></svg>
      <span>返回首页</span>
    </a>
    <h1>管理</h1>
  </header>

  <main>
    <section class="management-panel" aria-labelledby="fund-report-upload-title">
      <header>
        <span class="panel-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 15V4m0 0L8 8m4-4 4 4M5 13v6h14v-6" /></svg>
        </span>
        <h2 id="fund-report-upload-title">上传资金日报</h2>
      </header>

      <div class="upload-content">
        <div class="upload-rules">
          <p>选择 HTML 文件后，系统会读取文件名末尾的日期并保存为 <strong>YYYY-MM-DD.html</strong>。</p>
          <p>例如：资金日报驾驶舱交互版_20260824.html → 2026-08-24.html</p>
        </div>

        <input
          bind:this={fileInput}
          class="sr-only"
          type="file"
          accept=".html,text/html"
          disabled={uploading}
          onchange={handleFileSelection}
        />

        <button
          class="file-picker"
          type="button"
          disabled={uploading}
          onclick={chooseFile}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h6l2 2h8v11H4zM12 11v5m-2.5-2.5L12 11l2.5 2.5" /></svg>
          <span>
            <strong>{selectedFile ? "重新选择 HTML" : "选择 HTML 文件"}</strong>
            <small>单个文件不超过 20 MB</small>
          </span>
        </button>

        {#if selectedFile}
          <dl class="selected-file">
            <div>
              <dt>原始文件</dt>
              <dd>{selectedFile.name}</dd>
            </div>
            <div>
              <dt>保存名称</dt>
              <dd>{fundReportFileName(selectedDate)}</dd>
            </div>
            <div>
              <dt>文件大小</dt>
              <dd>{formatSize(selectedFile.size)}</dd>
            </div>
          </dl>
        {/if}

        <div class="panel-actions">
          <button
            class="upload-button"
            type="button"
            disabled={!selectedFile || uploading}
            onclick={uploadFundReport}
          >
            {uploading ? "正在上传" : "上传资金日报"}
          </button>
          {#if lastUpload}
            <a href={lastUpload.url} target="_blank" rel="noreferrer">打开 {lastUpload.date} 资金日报</a>
          {/if}
        </div>
      </div>
    </section>
  </main>
</div>

<style>
  .management-page {
    min-height: 100dvh;
    color: var(--ink);
    background: var(--canvas);
  }

  .management-masthead,
  main {
    width: min(1120px, calc(100% - 48px));
    margin-inline: auto;
  }

  .management-masthead {
    display: flex;
    min-height: 88px;
    align-items: center;
    gap: 24px;
    border-bottom: 1px solid var(--line);
  }

  .management-masthead h1 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: bolder;
  }

  .home-link {
    display: inline-flex;
    min-height: 44px;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius-control);
    color: var(--brand-deep);
    background: var(--surface);
    text-decoration: none;
  }

  .home-link svg,
  .panel-icon svg,
  .file-picker svg {
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.8;
  }

  .home-link svg {
    width: 20px;
  }

  main {
    padding-block: 48px;
  }

  .management-panel {
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: var(--radius-card);
    background: var(--surface);
    box-shadow: var(--shadow-card);
  }

  .management-panel > header {
    display: flex;
    min-height: 72px;
    align-items: center;
    gap: 12px;
    padding: 14px 20px;
    border-bottom: 1px solid var(--line);
  }

  .management-panel h2 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: bold;
  }

  .panel-icon {
    display: grid;
    width: 44px;
    height: 44px;
    place-items: center;
    border-radius: var(--radius-control);
    color: var(--brand-deep);
    background: var(--brand-soft);
  }

  .panel-icon svg {
    width: 24px;
  }

  .upload-content {
    display: grid;
    gap: 24px;
    padding: 24px;
  }

  .upload-rules {
    display: grid;
    gap: 8px;
    color: var(--muted);
    font-size: 1rem;
    line-height: 1.6;
  }

  .upload-rules p {
    margin: 0;
  }

  .upload-rules strong {
    color: var(--ink);
    font-weight: bold;
  }

  .file-picker {
    display: flex;
    min-height: 112px;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 20px;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-inner);
    color: var(--brand-deep);
    background: color-mix(in srgb, var(--brand-soft) 42%, var(--surface));
    cursor: pointer;
  }

  .file-picker:hover:not(:disabled) {
    border-color: var(--brand);
    background: var(--brand-soft);
  }

  .file-picker svg {
    width: 36px;
  }

  .file-picker span {
    display: grid;
    justify-items: start;
    gap: 4px;
  }

  .file-picker strong {
    font-size: 1rem;
    font-weight: bold;
  }

  .file-picker small {
    color: var(--muted);
    font-size: 0.875rem;
  }

  .selected-file {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
    margin: 0;
  }

  .selected-file div {
    display: grid;
    min-width: 0;
    gap: 6px;
    padding: 16px;
    border: 1px solid var(--line);
    border-radius: var(--radius-inner);
    background: var(--panel);
  }

  .selected-file dt {
    color: var(--muted);
    font-size: 0.875rem;
  }

  .selected-file dd {
    margin: 0;
    font-size: 1rem;
    overflow-wrap: anywhere;
  }

  .panel-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
  }

  .upload-button,
  .panel-actions a {
    display: inline-flex;
    min-height: 44px;
    align-items: center;
    justify-content: center;
    padding: 0 16px;
    border-radius: var(--radius-control);
    font-size: 1rem;
    text-decoration: none;
  }

  .upload-button {
    border: 1px solid var(--brand);
    color: #fff;
    background: var(--brand);
    cursor: pointer;
  }

  .upload-button:hover:not(:disabled) {
    background: var(--brand-deep);
  }

  .upload-button:disabled,
  .file-picker:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .panel-actions a {
    border: 1px solid var(--line-strong);
    color: var(--brand-deep);
    background: var(--surface);
  }

  .home-link:focus-visible,
  .file-picker:focus-visible,
  .upload-button:focus-visible,
  .panel-actions a:focus-visible {
    outline: 3px solid color-mix(in srgb, var(--brand) 36%, transparent);
    outline-offset: 2px;
  }

  @media (max-width: 720px) {
    .management-masthead,
    main {
      width: min(100% - 32px, 1120px);
    }

    .management-masthead {
      min-height: 72px;
    }

    main {
      padding-block: 24px;
    }

    .upload-content {
      padding: 20px;
    }

    .selected-file {
      grid-template-columns: 1fr;
    }

    .panel-actions {
      align-items: stretch;
      flex-direction: column;
    }

    .upload-button,
    .panel-actions a {
      width: 100%;
    }
  }
</style>
