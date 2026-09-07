# /// script
# requires-python = ">=3.12"
# dependencies = ["openpyxl>=3.1", "python-docx>=1.2", "xlrd>=2", "markitdown[docx]==0.1.7"]
# ///
"""Read-only, reproducible credit-material extraction. Original files are never changed."""

import argparse
import datetime as dt
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter
import xlrd
from markitdown import MarkItDown

VERSION = "credit-document-v2"
EXTRACTION_VERSION = "credit-extract-v1"
MAX_MARKDOWN_BYTES = 4_000_000
SUPPORTED = {".pdf", ".docx", ".doc", ".xlsx", ".xls"}


def command(args):
    return subprocess.run(
        args, check=True, capture_output=True, text=True, timeout=180
    ).stdout


def authority(name):
    if re.search(r"请.*确认|待确认|草稿", name):
        return "draft"
    if "授信资料反馈/" in name or "授信答复与银行反馈/" in name or "授信答复" in name:
        return "historical_reply"
    if "审计报告" in name:
        return "audited"
    if re.search(r"公司债券.*报告|信用评级报告|附件-", name):
        return "disclosure"
    return "internal"


def string(value):
    if value is None:
        return ""
    if isinstance(value, (dt.datetime, dt.date)):
        return value.isoformat()
    return str(value).replace("\x00", "").strip()


def pdf_blocks(path, cache, tessdata, ocr_command):
    pages = command(["pdftotext", "-layout", str(path), "-"]).split("\f")
    if not pages[-1].strip():
        pages.pop()
    for number, text in enumerate(pages, 1):
        extraction = "text"
        if len(text.strip()) < 40:
            extraction = "ocr"
            cached = (
                cache / f"page-{number}-{'vision' if ocr_command else 'tesseract'}.txt"
            )
            if cached.exists():
                text = cached.read_text()
            elif tessdata or ocr_command:
                with tempfile.TemporaryDirectory() as folder:
                    image = Path(folder) / "page"
                    command(
                        [
                            "pdftoppm",
                            "-f",
                            str(number),
                            "-l",
                            str(number),
                            "-r",
                            "220",
                            "-png",
                            "-singlefile",
                            str(path),
                            str(image),
                        ]
                    )
                    text = (
                        command([str(ocr_command), str(image) + ".png"])
                        if ocr_command
                        else command(
                            [
                                "tesseract",
                                str(image) + ".png",
                                "stdout",
                                "--tessdata-dir",
                                str(tessdata),
                                "-l",
                                "chi_sim+eng",
                                "--psm",
                                "3",
                            ]
                        )
                    )
                    cached.write_text(text)
            else:
                yield (
                    f"PDF第{number}页",
                    "[扫描页，尚未OCR，不得作为数据证据]",
                    "unreadable",
                )
                continue
        yield f"PDF第{number}页", text.strip() or "[空白页或无可识别文字]", extraction


def docx_blocks(path):
    doc = Document(path)
    paragraph = 0
    table = 0
    # iter_inner_content preserves paragraphs and tables in their original order.
    for item in doc.iter_inner_content():
        if isinstance(item, Paragraph):
            paragraph += 1
            if item.text.strip():
                yield f"段落{paragraph}", item.text.strip(), "text"
        elif isinstance(item, Table):
            table += 1
            header = "\n".join(
                " | ".join(f"列{i}: {cell.text}" for i, cell in enumerate(row.cells, 1))
                for row in item.rows[:2]
            )
            for row_no, row in enumerate(item.rows, 1):
                text = " | ".join(
                    f"列{i}: {cell.text}" for i, cell in enumerate(row.cells, 1)
                )
                yield (
                    f"表{table}第{row_no}行",
                    f"表格前两行/表头上下文：\n{header}\n本行：{text}",
                    "text",
                )


def xlsx_cell_text(cell, value):
    if cell.value is None:
        return ""
    if cell.data_type == "f":
        raw = f"{string(value)} [公式={cell.value}; 缓存值{'缺失，禁止推算' if value is None else '需核对'}]"
    else:
        raw = string(cell.value)
    if isinstance(value, (int, float)) and "%" in cell.number_format:
        raw += f" [显示百分比={value * 100:.8f}%; 原始值={value}]"
    return raw


def spreadsheet_markdown(path):
    # MarkItDown's default pandas formatter introduces NaN and float rendering noise.
    # Render each whole worksheet with the exact same values used for citation checks.
    def escape(value):
        return (
            value.replace("\\", "\\\\")
            .replace("|", "\\|")
            .replace("\n", "<br>")
            .replace("\r", "")
        )

    def table(name, rows):
        rows = [(number, values) for number, values in rows if any(values)]
        width = max((len(values) for _, values in rows), default=0)
        if not width:
            return f"## 工作表：{name}\n\n[空工作表]\n"
        result = [
            f"## 工作表：{name}",
            "",
            "| 行 | "
            + " | ".join(get_column_letter(i + 1) for i in range(width))
            + " |",
            "| --- | " + " | ".join("---" for _ in range(width)) + " |",
        ]
        result += [
            "| " + str(number) + " | " + " | ".join(escape(v) for v in values) + " |"
            for number, values in rows
        ]
        return "\n".join(result) + "\n"

    if path.suffix.lower() == ".xlsx":
        formulas = load_workbook(path, read_only=False, data_only=False)
        values = load_workbook(path, read_only=False, data_only=True)
        try:
            return "\n".join(
                table(
                    sheet.title,
                    [
                        (
                            row[0].row,
                            [
                                xlsx_cell_text(
                                    cell, values[sheet.title][cell.coordinate].value
                                )
                                for cell in row
                            ],
                        )
                        for row in sheet.iter_rows()
                    ],
                )
                for sheet in formulas
            )
        finally:
            formulas.close()
            values.close()
    book = xlrd.open_workbook(path)
    return "\n".join(
        table(
            sheet.name,
            [
                (
                    row + 1,
                    [string(sheet.cell_value(row, col)) for col in range(sheet.ncols)],
                )
                for row in range(sheet.nrows)
            ],
        )
        for sheet in book.sheets()
    )


def xlsx_blocks(path):
    formulas = load_workbook(path, read_only=False, data_only=False)
    values = load_workbook(path, read_only=False, data_only=True)
    try:
        for sheet in formulas:
            cached = values[sheet.title]
            headers = []
            for row in sheet.iter_rows():
                parts = []
                for cell in row:
                    if cell.value is None:
                        continue
                    raw = xlsx_cell_text(cell, cached[cell.coordinate].value)
                    parts.append(f"{cell.coordinate}={raw}")
                if not parts:
                    continue
                text = " | ".join(parts)
                if len(headers) < 5:
                    headers.append(text)
                context = "\n".join(headers)
                yield (
                    f"工作表「{sheet.title}」第{row[0].row}行",
                    f"表头/单位上下文：\n{context}\n本行：{text}",
                    "text",
                )
    finally:
        formulas.close()
        values.close()


def xls_blocks(path):
    book = xlrd.open_workbook(path)
    for sheet in book.sheets():
        headers = []
        for row in range(sheet.nrows):
            parts = [
                f"{get_column_letter(col + 1)}{row + 1}={string(sheet.cell_value(row, col))}"
                for col in range(sheet.ncols)
                if string(sheet.cell_value(row, col))
            ]
            if not parts:
                continue
            text = " | ".join(parts)
            if len(headers) < 5:
                headers.append(text)
            yield (
                f"工作表「{sheet.name}」第{row + 1}行",
                "表头/单位上下文：\n" + "\n".join(headers) + "\n本行：" + text,
                "text",
            )


def extract(path, cache, tessdata, ocr_command):
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        yield from pdf_blocks(path, cache, tessdata, ocr_command)
    elif suffix == ".xlsx":
        yield from xlsx_blocks(path)
    elif suffix == ".xls":
        yield from xls_blocks(path)
    elif suffix == ".docx":
        yield from docx_blocks(path)
    else:
        # Convert in a temporary directory, never beside/over the original.
        with tempfile.TemporaryDirectory() as folder:
            command(
                [
                    "soffice",
                    "-env:UserInstallation=file://" + folder + "/profile",
                    "--headless",
                    "--convert-to",
                    "docx",
                    "--outdir",
                    folder,
                    str(path),
                ]
            )
            yield from docx_blocks(Path(folder) / (path.stem + ".docx"))


def document_markdown(path, extracted, cache):
    """One natural Markdown document; only scanned PDF pages use the OCR path."""
    target = cache / (
        "document-markdown-v3-sheets.md"
        if path.suffix.lower() in {".xlsx", ".xls"}
        else "document-markdown-v2.md"
    )
    if target.exists():
        return target.read_text()
    if path.suffix.lower() in {".xlsx", ".xls"}:
        text = spreadsheet_markdown(path)
    elif path.suffix.lower() == ".pdf":
        text = (
            "\n\n".join(
                f"## {locator}{'（扫描页 OCR）' if mode == 'ocr' else ''}\n\n```text\n{body}\n```"
                for locator, body, mode in extracted
            )
            + "\n"
        )
    else:
        converter = MarkItDown(enable_plugins=False)
        if path.suffix.lower() == ".doc":
            with tempfile.TemporaryDirectory() as folder:
                command(
                    [
                        "soffice",
                        "-env:UserInstallation=file://" + folder + "/profile",
                        "--headless",
                        "--convert-to",
                        "docx",
                        "--outdir",
                        folder,
                        str(path),
                    ]
                )
                text = converter.convert(
                    str(Path(folder) / (path.stem + ".docx"))
                ).text_content
        else:
            text = converter.convert(str(path)).text_content
    if not text.strip():
        raise ValueError("Markdown 转换结果为空")
    target.write_text(text)
    return text


def split_markdown(text, limit=MAX_MARKDOWN_BYTES):
    """Keep the converter output byte-for-byte when it fits. Split ONLY at the byte limit."""
    if limit < 4:
        raise ValueError("UTF-8 limit must be at least 4 bytes")
    data = text.encode("utf-8")
    pieces = []
    while len(data) > limit:
        boundary = data.rfind(b"\n\n", 0, limit + 1)
        end = boundary + 2 if boundary >= limit // 2 else limit
        # A newline crossing the limit or a multi-byte character must never exceed it.
        end = min(end, limit)
        while end and data[end] & 0xC0 == 0x80:
            end -= 1
        pieces.append(data[:end].decode("utf-8"))
        data = data[end:]
    if data:
        pieces.append(data.decode("utf-8"))
    return pieces


def prepare(
    source,
    output,
    tessdata=None,
    ocr_command=None,
    previous_corpus=None,
    cache_dir=None,
):
    output.mkdir(parents=True, exist_ok=True)
    documents, blocks, search_files, ignored, failures = [], [], [], [], []
    previous = (
        json.loads(previous_corpus.read_text())
        if previous_corpus
        else {"documents": []}
    )
    previous_by_hash = {}
    for doc in previous["documents"]:
        previous_by_hash.setdefault(doc["sha256"], []).append(doc)
    for path in sorted(source.rglob("*")):
        relative_path = path.relative_to(source)
        if not path.is_file() or any(
            part.startswith((".", "~$")) for part in relative_path.parts
        ):
            continue
        relative = relative_path.as_posix()
        if path.suffix.lower() not in SUPPORTED:
            ignored.append(relative)
            continue
        sha = hashlib.sha256(path.read_bytes()).hexdigest()
        old = previous_by_hash.get(sha, [])
        old = next(
            (d for d in old if d["relativePath"] == relative),
            old[0] if len(old) == 1 else None,
        )
        document_id = (
            old["id"]
            if old
            else hashlib.sha256((relative + sha).encode()).hexdigest()[:24]
        )
        cache = (cache_dir or output / "cache") / sha
        cache.mkdir(parents=True, exist_ok=True)
        extracted_file = cache / (
            EXTRACTION_VERSION
            + ("-headers-v1" if path.suffix.lower() in {".doc", ".docx"} else "")
            + ("-vision" if ocr_command and path.suffix.lower() == ".pdf" else "")
            + ".json"
        )
        try:
            if extracted_file.exists():
                extracted = json.loads(extracted_file.read_text())
            else:
                extracted = list(extract(path, cache, tessdata, ocr_command))
                extracted_file.write_text(json.dumps(extracted, ensure_ascii=False))
            markdown = document_markdown(path, extracted, cache)
            parts = split_markdown(markdown)
        except Exception as error:
            failures.append(
                {
                    "file": relative,
                    "error": type(error).__name__,
                    "detail": str(error)[:500],
                }
            )
            continue
        doc = {
            "id": document_id,
            "title": path.name,
            "relativePath": relative,
            "sha256": sha,
            "bytes": path.stat().st_size,
            "authority": authority(relative),
            "originalKey": "originals/" + relative,
            "modifiedAt": dt.datetime.fromtimestamp(
                path.stat().st_mtime, dt.timezone.utc
            ).isoformat(),
            "blockCount": 0,
            "ocrCount": sum(mode == "ocr" for _, _, mode in extracted),
        }
        original = output / doc["originalKey"]
        original.parent.mkdir(parents=True, exist_ok=True)
        if (
            not original.exists()
            or hashlib.sha256(original.read_bytes()).hexdigest() != sha
        ):
            shutil.copyfile(path, original)
        keys = []
        for number, part in enumerate(parts, 1):
            # Preserve the original extension too: a PDF and DOCX may share a stem.
            key = (
                "search/"
                + relative
                + (f".part-{number:03d}" if len(parts) > 1 else "")
                + ".md"
            )
            body = part.encode("utf-8")
            assert 0 < len(body) <= MAX_MARKDOWN_BYTES
            target = output / key
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(body)
            keys.append(key)
            search_files.append(
                {
                    "key": key,
                    "documentId": document_id,
                    "sha256": hashlib.sha256(body).hexdigest(),
                    "bytes": len(body),
                    "part": number,
                }
            )
        # Local canonical evidence is NOT uploaded as individual search objects or embedded.
        for number, (locator, text, extraction) in enumerate(extracted, 1):
            for part, start in enumerate(range(0, len(text), 12000), 1):
                blocks.append(
                    {
                        "id": f"{document_id}-{number:04d}-{part}",
                        "documentId": document_id,
                        "locator": locator
                        + (f"（续段{part}）" if len(text) > 12000 else ""),
                        "text": text[start : start + 12000],
                        "extraction": extraction,
                        "searchKey": keys[0],
                    }
                )
                doc["blockCount"] += 1
        documents.append(doc)
        print(
            json.dumps(
                {
                    "file": relative,
                    "markdownFiles": len(parts),
                    "markdownBytes": sum(len(x.encode("utf-8")) for x in parts),
                    "ocrPages": doc["ocrCount"],
                },
                ensure_ascii=False,
            ),
            flush=True,
        )
    corpus = {
        "version": VERSION,
        "builtAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "documents": documents,
        "blocks": blocks,
        "searchFiles": search_files,
    }
    (output / "corpus.json").write_text(
        json.dumps(corpus, ensure_ascii=False, separators=(",", ":"))
    )
    report = {
        "documents": len(documents),
        "blocks": len(blocks),
        "searchFiles": len(search_files),
        "searchBytes": sum(x["bytes"] for x in search_files),
        "maxSearchBytes": max((x["bytes"] for x in search_files), default=0),
        "oversizedDocuments": [
            d["title"]
            for d in documents
            if sum(f["documentId"] == d["id"] for f in search_files) > 1
        ],
        "ocrBlocks": sum(x["extraction"] == "ocr" for x in blocks),
        "unreadableBlocks": sum(x["extraction"] == "unreadable" for x in blocks),
        "ignored": ignored,
        "failures": failures,
    }
    (output / "preparation-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2)
    )
    print(json.dumps(report, ensure_ascii=False), flush=True)
    if failures or report["unreadableBlocks"]:
        raise SystemExit("Review preparation-report.json before uploading")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path(".credit-local/corpus"))
    parser.add_argument("--tessdata", type=Path)
    parser.add_argument("--ocr-command", type=Path)
    parser.add_argument("--previous-corpus", type=Path)
    parser.add_argument("--cache-dir", type=Path)
    args = parser.parse_args()
    prepare(
        args.source.expanduser().resolve(),
        args.output.resolve(),
        args.tessdata,
        args.ocr_command.resolve() if args.ocr_command else None,
        args.previous_corpus,
        args.cache_dir,
    )
