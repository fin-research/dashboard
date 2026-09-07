# /// script
# requires-python = ">=3.12"
# dependencies = ["openpyxl>=3.1", "python-docx>=1.2", "xlrd>=2", "markitdown[docx]==0.1.7"]
# ///
import importlib.util
from pathlib import Path
import tempfile
import unittest
from openpyxl import Workbook

ROOT = Path(__file__).resolve().parents[1]


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / file)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


prepare = module("prepare", "prepare-credit-corpus.py")
organize = module("organize", "organize-credit-materials.py")


class CreditMaterialsTest(unittest.TestCase):
    def test_document_below_limit_is_unchanged(self):
        text = "# 年报\n\n| 科目 | 本期 |\n| --- | --- |\n| 借款 | 50 |\n"
        self.assertEqual(prepare.split_markdown(text), [text])

    def test_only_byte_limit_splits_and_utf8_is_lossless(self):
        text = ("中文财务表😀\n\n" * 20) + "最后一行"
        parts = prepare.split_markdown(text, 39)
        self.assertGreater(len(parts), 1)
        self.assertEqual("".join(parts), text)
        self.assertTrue(all(0 < len(p.encode()) <= 39 for p in parts))
        self.assertEqual(prepare.split_markdown("a" * 40, 40), ["a" * 40])
        self.assertEqual(len(prepare.split_markdown("a" * 41, 40)), 2)

    def test_spreadsheet_values_units_and_missing_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "财务.xlsx"
            book = Workbook()
            sheet = book.active
            sheet.title = "现金流量表"
            sheet.append(["2025年度", "单位：元"])
            sheet.append(["收取现金", 20036396034.31])
            sheet.append(["比例", 0.75509])
            sheet["B3"].number_format = "0.00%"
            sheet.append(["缺失缓存", "=B2*2"])
            book.save(file)
            text = prepare.spreadsheet_markdown(file)
            self.assertIn("20036396034.31", text)
            self.assertNotIn("20036396034.310001", text)
            self.assertNotIn("NaN", text)
            self.assertIn("显示百分比=75.50900000%", text)
            self.assertIn("缓存值缺失，禁止推算", text)
            self.assertEqual(text.count("单位：元"), 1)

    def test_organization_keeps_names_and_is_idempotent(self):
        for source in [
            "公司债券2025年度报告.pdf",
            "财务报表/25Q1-合并财务报表.xlsx",
            "授信资料反馈/青岛银行/评分.xlsx",
        ]:
            target = organize.destination(Path(source))
            self.assertEqual(target.name, Path(source).name)
            self.assertEqual(organize.destination(target), target)
        self.assertEqual(
            organize.destination(Path("公司债券2025年度报告.pdf")).parent.as_posix(),
            "定期报告与审计/2025年度",
        )


if __name__ == "__main__":
    unittest.main()
