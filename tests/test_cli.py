"""csvstat 的行为契约。

这个文件是三方协作的"冻结契约"：实现方不得修改本文件，
只允许让代码去满足它。测试即需求。
"""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run_cli(csv_text, filename="data.csv"):
    tmp = tempfile.mkdtemp()
    path = Path(tmp) / filename
    path.write_text(csv_text, encoding="utf-8")
    return subprocess.run(
        [sys.executable, "-m", "csvstat", str(path)],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
    )


def stats(csv_text):
    proc = run_cli(csv_text)
    assert proc.returncode == 0, f"exit={proc.returncode} stderr={proc.stderr}"
    return json.loads(proc.stdout)


def col(payload, name):
    for c in payload["columns"]:
        if c["name"] == name:
            return c
    raise AssertionError(f"输出里缺少列 {name}")


class CsvStatTest(unittest.TestCase):
    def test_numeric_column(self):
        p = stats("name,age\na,3\nb,5\nc,7\n")
        self.assertEqual(p["rows"], 3)
        age = col(p, "age")
        self.assertEqual(age["kind"], "numeric")
        self.assertEqual(age["count"], 3)
        self.assertEqual(age["missing"], 0)
        self.assertEqual(age["min"], 3.0)
        self.assertEqual(age["max"], 7.0)
        self.assertAlmostEqual(age["mean"], 5.0, places=2)

    def test_text_column(self):
        p = stats("name,age\na,3\nb,5\nc,7\n")
        name = col(p, "name")
        self.assertEqual(name["kind"], "text")
        self.assertEqual(name["unique"], 3)
        self.assertEqual(name["top"], "a")

    def test_missing_tokens(self):
        p = stats("city\nBeijing\n\nNA\nnull\nN/A\n")
        city = col(p, "city")
        self.assertEqual(p["rows"], 5)
        self.assertEqual(city["missing"], 4)
        self.assertEqual(city["count"], 1)
        self.assertEqual(city["unique"], 1)
        self.assertEqual(city["top"], "Beijing")

    def test_numeric_falls_back_to_text(self):
        p = stats("v\n1\n2\nx\n")
        v = col(p, "v")
        self.assertEqual(v["kind"], "text")
        self.assertEqual(v["count"], 3)
        self.assertEqual(v["missing"], 0)

    def test_quoted_field_with_comma(self):
        p = stats('name,n\n"Doe, John",1\n"Smith, Ann",2\n')
        self.assertEqual(p["rows"], 2)
        self.assertEqual(col(p, "name")["unique"], 2)

    def test_mean_rounding(self):
        p = stats("v\n1\n2\n4\n")
        self.assertAlmostEqual(col(p, "v")["mean"], 2.33, places=2)

    def test_header_only(self):
        p = stats("a,b\n")
        self.assertEqual(p["rows"], 0)
        a = col(p, "a")
        self.assertEqual(a["count"], 0)
        self.assertEqual(a["missing"], 0)
        self.assertEqual(a["kind"], "text")
        self.assertIsNone(a["top"])

    def test_ragged_rows(self):
        p = stats("a,b,c\n1,2\n4,5,6,7\n")
        self.assertEqual(p["rows"], 2)
        c = col(p, "c")
        self.assertEqual(c["missing"], 1)
        self.assertEqual(c["count"], 1)
        self.assertEqual(c["kind"], "numeric")
        self.assertIsNone(c.get("top"))

    def test_top_tie_uses_lexicographic_order(self):
        p = stats("t\ny\nx\n")
        self.assertEqual(col(p, "t")["top"], "x")

    def test_missing_file_is_error(self):
        proc = subprocess.run(
            [sys.executable, "-m", "csvstat", "no-such-file.csv"],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        self.assertEqual(proc.returncode, 2)
        self.assertIn("error", json.loads(proc.stdout))

    def test_empty_file_is_error(self):
        proc = run_cli("")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("error", json.loads(proc.stdout))


if __name__ == "__main__":
    unittest.main()