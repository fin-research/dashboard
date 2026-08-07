import { toPng } from "html-to-image";

const EXPORT_SCALE = 3;

export async function exportReportImage(
  report: HTMLElement,
  reportDate: string,
  options: { captureClass?: boolean } = {},
): Promise<void> {
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const shell = report.parentElement;
  const shellScrollLeft = shell?.scrollLeft ?? 0;
  const shellScrollTop = shell?.scrollTop ?? 0;
  try {
    if (options.captureClass) {
      report.classList.add("is-export-capture");
    }
    await document.fonts.ready;
    if (options.captureClass) {
      await nextPaint();
    }

    const shellStyle = shell ? getComputedStyle(shell) : null;
    const paddingLeft = parsePixels(shellStyle?.paddingLeft);
    const paddingRight = parsePixels(shellStyle?.paddingRight);
    const paddingBottom = parsePixels(shellStyle?.paddingBottom);
    const exportWidth = report.scrollWidth + paddingLeft + paddingRight;
    const exportHeight = report.scrollHeight + paddingBottom;

    const dataUrl = await toPng(report, {
      backgroundColor: "#f7f7f3",
      cacheBust: true,
      width: exportWidth,
      height: exportHeight,
      pixelRatio: EXPORT_SCALE,
      style: {
        boxSizing: "border-box",
        width: `${exportWidth}px`,
        height: `${exportHeight}px`,
        boxShadow: "none",
        margin: "0",
        padding: `0 ${paddingRight}px ${paddingBottom}px ${paddingLeft}px`,
      },
    });

    const download = document.createElement("a");
    download.download = `资金管理部-市场点评-${reportDate}-${EXPORT_SCALE}x.png`;
    download.href = dataUrl;
    document.body.append(download);
    download.click();
    download.remove();
  } finally {
    if (options.captureClass) {
      report.classList.remove("is-export-capture");
    }
    window.scrollTo(scrollX, scrollY);
    if (shell) {
      shell.scrollLeft = shellScrollLeft;
      shell.scrollTop = shellScrollTop;
    }
  }
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function parsePixels(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}
