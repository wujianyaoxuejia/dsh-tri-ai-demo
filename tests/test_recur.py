"""recur 的冻结契约测试。实现方不得修改本文件。

约定：测试只通过命令行调用 `python -m recur`，断言外部行为，不 import 内部函数。
"""

from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run(*args: str) -> tuple[int, dict]:
    """调用 CLI，返回 (退出码, 解析后的 JSON)。"""
    proc = subprocess.run(
        [sys.executable, "-m", "recur", *args],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=30,
    )
    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError:  # pragma: no cover - 便于定位实现错误
        raise AssertionError(
            f"stdout 不是合法 JSON: {proc.stdout!r} stderr={proc.stderr!r}"
        ) from None
    return proc.returncode, payload


class RecurTestBase(unittest.TestCase):
    def occ(self, *args: str) -> list[str]:
        code, payload = run(*args)
        self.assertEqual(code, 0, f"期望退出码 0，实际 {code}: {payload}")
        self.assertIn("occurrences", payload)
        return payload["occurrences"]

    def err(self, *args: str, code_name: str) -> None:
        code, payload = run(*args)
        self.assertEqual(code, 2, f"期望退出码 2，实际 {code}: {payload}")
        self.assertEqual(payload.get("code"), code_name, payload)
        self.assertIn("error", payload)


class TestDaily(RecurTestBase):
    def test_default_count_is_10(self) -> None:
        occ = self.occ("--rule", "FREQ=DAILY", "--start", "2026-01-01T08:00:00+08:00")
        self.assertEqual(len(occ), 10)
        self.assertEqual(occ[0], "2026-01-01T08:00:00+08:00")
        self.assertEqual(occ[9], "2026-01-10T08:00:00+08:00")

    def test_cross_month(self) -> None:
        occ = self.occ(
            "--rule", "FREQ=DAILY",
            "--start", "2026-01-30T09:00:00+08:00",
            "--count", "3",
        )
        self.assertEqual(
            occ,
            [
                "2026-01-30T09:00:00+08:00",
                "2026-01-31T09:00:00+08:00",
                "2026-02-01T09:00:00+08:00",
            ],
        )

    def test_interval_3_cross_month(self) -> None:
        occ = self.occ(
            "--rule", "FREQ=DAILY;INTERVAL=3",
            "--start", "2026-01-30T09:00:00+08:00",
            "--count", "3",
        )
        self.assertEqual(
            occ,
            [
                "2026-01-30T09:00:00+08:00",
                "2026-02-02T09:00:00+08:00",
                "2026-02-05T09:00:00+08:00",
            ],
        )

    def test_leap_day(self) -> None:
        occ = self.occ(
            "--rule", "FREQ=DAILY",
            "--start", "2028-02-28T00:00:00+08:00",
            "--count", "3",
        )
        self.assertEqual(
            occ,
            [
                "2028-02-28T00:00:00+08:00",
                "2028-02-29T00:00:00+08:00",
                "2028-03-01T00:00:00+08:00",
            ],
        )


class TestWeekly(RecurTestBase):
    def test_byday_output_sorted_by_time(self) -> None:
        # BYDAY 写成 TH,TU 也必须按时间先后输出
        occ = self.occ(
            "--rule", "FREQ=WEEKLY;BYDAY=TH,TU",
            "--start", "2026-01-05T19:00:00+08:00",  # 周一
            "--count", "4",
        )
        self.assertEqual(
            occ,
            [
                "2026-01-06T19:00:00+08:00",  # 周二
                "2026-01-08T19:00:00+08:00",  # 周四
                "2026-01-13T19:00:00+08:00",
                "2026-01-15T19:00:00+08:00",
            ],
        )

    def test_skips_candidates_before_start(self) -> None:
        # start 是周三，规则要周一：首次出现必须是下一个周一
        occ = self.occ(
            "--rule", "FREQ=WEEKLY;BYDAY=MO",
            "--start", "2026-01-07T10:00:00+08:00",
            "--count", "2",
        )
        self.assertEqual(
            occ,
            ["2026-01-12T10:00:00+08:00", "2026-01-19T10:00:00+08:00"],
        )

    def test_interval_2(self) -> None:
        # 第 0 周（1/5）的周一早于 start 被跳过；往后每 2 周取一次
        occ = self.occ(
            "--rule", "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO",
            "--start", "2026-01-07T10:00:00+08:00",
            "--count", "2",
        )
        self.assertEqual(
            occ,
            ["2026-01-19T10:00:00+08:00", "2026-02-02T10:00:00+08:00"],
        )

    def test_without_byday_repeats_same_weekday(self) -> None:
        occ = self.occ(
            "--rule", "FREQ=WEEKLY",
            "--start", "2026-03-02T07:30:00+08:00",  # 周一
            "--count", "3",
        )
        self.assertEqual(
            occ,
            [
                "2026-03-02T07:30:00+08:00",
                "2026-03-09T07:30:00+08:00",
                "2026-03-16T07:30:00+08:00",
            ],
        )


class TestUntilAndOffset(RecurTestBase):
    def test_until_is_inclusive(self) -> None:
        occ = self.occ(
            "--rule", "FREQ=WEEKLY;BYDAY=TU",
            "--start", "2026-01-06T19:00:00+08:00",
            "--until", "2026-01-20T19:00:00+08:00",
        )
        self.assertEqual(
            occ,
            [
                "2026-01-06T19:00:00+08:00",
                "2026-01-13T19:00:00+08:00",
                "2026-01-20T19:00:00+08:00",
            ],
        )

    def test_non_hour_offset_preserved(self) -> None:
        occ = self.occ(
            "--rule", "FREQ=DAILY",
            "--start", "2026-05-01T12:00:00+05:30",
            "--count", "2",
        )
        self.assertEqual(
            occ,
            ["2026-05-01T12:00:00+05:30", "2026-05-02T12:00:00+05:30"],
        )

    def test_count_one_returns_start_only(self) -> None:
        occ = self.occ(
            "--rule", "FREQ=DAILY",
            "--start", "2026-05-01T12:00:00+05:30",
            "--count", "1",
        )
        self.assertEqual(occ, ["2026-05-01T12:00:00+05:30"])


class TestErrors(RecurTestBase):
    def test_unsupported_freq(self) -> None:
        self.err(
            "--rule", "FREQ=MONTHLY",
            "--start", "2026-01-01T00:00:00+08:00",
            code_name="unsupported_freq",
        )

    def test_missing_freq(self) -> None:
        self.err(
            "--rule", "INTERVAL=2",
            "--start", "2026-01-01T00:00:00+08:00",
            code_name="invalid_rule",
        )

    def test_unknown_rule_key(self) -> None:
        self.err(
            "--rule", "FREQ=DAILY;BYSETPOS=1",
            "--start", "2026-01-01T00:00:00+08:00",
            code_name="invalid_rule",
        )

    def test_byday_with_daily_is_rejected(self) -> None:
        self.err(
            "--rule", "FREQ=DAILY;BYDAY=MO",
            "--start", "2026-01-01T00:00:00+08:00",
            code_name="invalid_byday",
        )

    def test_bad_byday_code(self) -> None:
        self.err(
            "--rule", "FREQ=WEEKLY;BYDAY=XX",
            "--start", "2026-01-01T00:00:00+08:00",
            code_name="invalid_byday",
        )

    def test_zero_count(self) -> None:
        self.err(
            "--rule", "FREQ=DAILY",
            "--start", "2026-01-01T00:00:00+08:00",
            "--count", "0",
            code_name="invalid_count",
        )

    def test_bad_interval(self) -> None:
        self.err(
            "--rule", "FREQ=DAILY;INTERVAL=abc",
            "--start", "2026-01-01T00:00:00+08:00",
            code_name="invalid_interval",
        )

    def test_count_and_until_conflict(self) -> None:
        self.err(
            "--rule", "FREQ=DAILY",
            "--start", "2026-01-01T00:00:00+08:00",
            "--count", "3",
            "--until", "2026-02-01T00:00:00+08:00",
            code_name="invalid_args",
        )

    def test_start_without_offset(self) -> None:
        self.err(
            "--rule", "FREQ=DAILY",
            "--start", "2026-01-01T00:00:00",
            code_name="invalid_start",
        )


if __name__ == "__main__":
    unittest.main()