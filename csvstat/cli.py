"""csvstat 的命令行入口与统计逻辑。

stdout 只输出一个 JSON 对象；正常退出码 0，输入错误退出码 2。
"""

from __future__ import annotations

import csv
import json
import math
import sys
from collections import Counter
from typing import Any, Sequence

# 缺失值 token（比较前先去除前后空白并转小写）。
MISSING_TOKENS = frozenset({"", "na", "n/a", "null", "none"})


class CsvStatError(Exception):
    """读取或解析输入文件失败。"""


def _is_missing(value: str) -> bool:
    """判断一个字段是否视为缺失值。"""
    return value.strip().lower() in MISSING_TOKENS


def _to_float(value: str) -> float | None:
    """尝试把字段解析为有限浮点数；失败返回 None。"""
    text = value.strip()
    if not text:
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    # 非有限值（nan/inf）无法产出可序列化的统计量，按文本处理。
    return number if math.isfinite(number) else None


def _summarize_column(name: str, values: Sequence[str]) -> dict[str, Any]:
    """计算单列的统计摘要。"""
    count = 0
    missing = 0
    numbers: list[float] = []
    texts: list[str] = []
    all_numeric = True

    for raw in values:
        if _is_missing(raw):
            missing += 1
            continue
        count += 1
        text = raw.strip()
        number = _to_float(raw)
        if number is None:
            all_numeric = False
        else:
            numbers.append(number)
        texts.append(text)

    # 没有非缺失值时 kind 为 text。
    numeric = all_numeric and count > 0
    summary: dict[str, Any] = {
        "name": name,
        "kind": "numeric" if numeric else "text",
        "count": count,
        "missing": missing,
    }

    if numeric:
        summary["min"] = min(numbers)
        summary["max"] = max(numbers)
        summary["mean"] = round(sum(numbers) / len(numbers), 2)
    else:
        counts = Counter(texts)
        summary["unique"] = len(counts)
        # 出现次数最多的值；并列时取字典序最小者；无值时 top 为 null。
        summary["top"] = min(counts, key=lambda v: (-counts[v], v)) if counts else None

    return summary


def _read_rows(path: str) -> list[list[str]]:
    """读取整个 CSV 文件为行列表。"""
    try:
        with open(path, "r", encoding="utf-8-sig", newline="") as handle:
            return list(csv.reader(handle))
    except FileNotFoundError:
        raise CsvStatError(f"file not found: {path}") from None
    except IsADirectoryError:
        raise CsvStatError(f"not a file: {path}") from None
    except PermissionError:
        raise CsvStatError(f"permission denied: {path}") from None
    except UnicodeDecodeError:
        raise CsvStatError(f"file is not valid UTF-8: {path}") from None
    except csv.Error as exc:
        raise CsvStatError(f"invalid CSV: {exc}") from None
    except OSError as exc:
        raise CsvStatError(f"cannot read file: {exc}") from None


def compute_stats(path: str) -> dict[str, Any]:
    """读取 *path* 并返回统计结果字典。"""
    rows = _read_rows(path)
    if not rows:
        raise CsvStatError(f"empty file: {path}")

    header = rows[0]
    if not header:
        raise CsvStatError(f"missing header: {path}")

    data_rows = rows[1:]
    columns = []
    for index, name in enumerate(header):
        # 短行按缺失值补足；长行的多余字段忽略。
        values = [row[index] if index < len(row) else "" for row in data_rows]
        columns.append(_summarize_column(name, values))

    return {
        "path": path,
        "rows": len(data_rows),
        "columns": columns,
    }


def _emit(payload: dict[str, Any]) -> None:
    """把 payload 作为单行 JSON 写到 stdout。"""
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")


def main(argv: Sequence[str] | None = None) -> int:
    """命令行入口，返回进程退出码。"""
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 1:
        _emit({"error": "usage: python -m csvstat <file.csv>"})
        return 2

    try:
        payload = compute_stats(args[0])
    except CsvStatError as exc:
        _emit({"error": str(exc)})
        return 2

    _emit(payload)
    return 0
