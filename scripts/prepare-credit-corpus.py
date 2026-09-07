# /// script
# requires-python = ">=3.12"
# dependencies = ["pypdf>=6", "openpyxl>=3.1", "python-docx>=1.2", "xlrd>=2"]
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

VERSION = "credit-extract-v1"
SUPPORTED = {".pdf", ".docx", ".doc", ".xlsx", ".xls"}


def command(args):
    return subprocess.run(
        args, check=True, capture_output=True, text=True, timeout=180
    ).stdout


def authority(name):
    if re.search(r"请.*确认|待确认|草稿", name):
        return "draft"
    if "授信资料反馈/" in name or "授信答复" in name:
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
                    value = cached[cell.coordinate].value
                    if cell.data_type == "f":
                        raw = f"{string(value)} [公式={cell.value}; 缓存值{'缺失，禁止推算' if value is None else '需核对'}]"
                    else:
                        raw = string(cell.value)
                    if isinstance(value, (int, float)) and "%" in cell.number_format:
                        raw += f" [显示百分比={value * 100:.8f}%; 原始值={value}]"
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


def prepare(source, output, tessdata=None, ocr_command=None):
    output.mkdir(parents=True, exist_ok=True)
    documents, blocks, ignored, failures = [], [], [], []
    for path in sorted(source.rglob("*")):
        if not path.is_file() or path.name.startswith((".", "~$")):
            continue
        relative = path.relative_to(source).as_posix()
        if path.suffix.lower() not in SUPPORTED:
            ignored.append(relative)
            continue
        sha = hashlib.sha256(path.read_bytes()).hexdigest()
        document_id = hashlib.sha256((relative + sha).encode()).hexdigest()[:24]
        cache = output / "cache" / sha
        cache.mkdir(parents=True, exist_ok=True)
        extracted_file = cache / (
            VERSION
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
        except Exception as error:
            failures.append({"file": relative, "error": type(error).__name__})
            continue
        doc = {
            "id": document_id,
            "title": path.name,
            "relativePath": relative,
            "sha256": sha,
            "bytes": path.stat().st_size,
            "authority": authority(relative),
            "originalKey": f"originals/{document_id}{path.suffix.lower()}",
            "modifiedAt": dt.datetime.fromtimestamp(
                path.stat().st_mtime, dt.timezone.utc
            ).isoformat(),
            "blockCount": 0,
            "ocrCount": 0,
        }
        original = output / doc["originalKey"]
        original.parent.mkdir(exist_ok=True)
        if not original.exists():
            shutil.copyfile(path, original)
        for number, (locator, text, extraction) in enumerate(extracted, 1):
            # Preserve full evidence; split exceptionally long blocks with explicit continuation locators.
            for part, start in enumerate(range(0, len(text), 12000), 1):
                block_id = f"{document_id}-{number:04d}-{part}"
                location = locator + (f"（续段{part}）" if len(text) > 12000 else "")
                block = {
                    "id": block_id,
                    "documentId": document_id,
                    "locator": location,
                    "text": text[start : start + 12000],
                    "extraction": extraction,
                    "searchKey": f"search/{block_id}.md",
                }
                blocks.append(block)
                doc["blockCount"] += 1
                doc["ocrCount"] += extraction == "ocr"
                search_file = output / block["searchKey"]
                search_file.parent.mkdir(exist_ok=True)
                search_file.write_text(
                    f"# {path.name}\n资料：{relative}\n来源ID：{block_id}\n定位：{location}\n权威层级：{doc['authority']}\n提取方式：{extraction}\n\n{block['text']}\n"
                )
        documents.append(doc)
        print(
            json.dumps(
                {"file": relative, "blocks": doc["blockCount"], "ocr": doc["ocrCount"]},
                ensure_ascii=False,
            ),
            flush=True,
        )
    corpus = {
        "version": VERSION,
        "builtAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "documents": documents,
        "blocks": blocks,
    }
    (output / "corpus.json").write_text(
        json.dumps(corpus, ensure_ascii=False, separators=(",", ":"))
    )
    report = {
        "documents": len(documents),
        "blocks": len(blocks),
        "ocrBlocks": sum(x["extraction"] == "ocr" for x in blocks),
        "unreadableBlocks": sum(x["extraction"] == "unreadable" for x in blocks),
        "ignored": ignored,
        "failures": failures,
    }
    (output / "preparation-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2)
    )
    print(json.dumps(report, ensure_ascii=False), flush=True)
    if failures:
        raise SystemExit(
            "Some materials failed extraction; review preparation-report.json before uploading"
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path(".credit-local/corpus"))
    parser.add_argument("--tessdata", type=Path)
    parser.add_argument("--ocr-command", type=Path)
    args = parser.parse_args()
    prepare(
        args.source.expanduser().resolve(),
        args.output.resolve(),
        args.tessdata,
        args.ocr_command.resolve() if args.ocr_command else None,
    )
