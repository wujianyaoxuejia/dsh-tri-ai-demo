"""recur 的命令行入口与重复规则展开逻辑。

stdout 只输出一个 JSON 对象；成功退出码 0，输入错误退出码 2。
只用 Python 标准库。
"""

from __future__ import annotations

import json
import sys
from datetime import date, datetime, timedelta
from typing import Any, Sequence

# 支持的规则键（大小写敏感，按 README「只支持这些键」）。
_RULE_KEYS = frozenset({"FREQ", "INTERVAL", "BYDAY", "COUNT"})

# 支持的 FREQ 值。
_FREQS = frozenset({"DAILY", "WEEKLY"})

# BYDAY 代码 -> 距周一的天数。
_WEEKDAYS = {
    "MO": 0,
    "TU": 1,
    "WE": 2,
    "TH": 3,
    "FR": 4,
    "SA": 5,
    "SU": 6,
}

# 命令行参数名。
_CLI_OPTIONS = frozenset({"rule", "start", "count", "until"})

_DEFAULT_COUNT = 10


class RecurError(Exception):
    """带机器可读错误码的输入错误。"""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class Rule:
    """解析后的重复规则。"""

    def __init__(self, freq: str, interval: int, byday: list[int] | None, count: int | None) -> None:
        self.freq = freq
        self.interval = interval
        self.byday = byday  # 距周一的天数列表；None 表示未提供 BYDAY
        self.count = count  # 规则内 COUNT；None 表示未提供


# INTERVAL / COUNT 的合法区间（README v1.1）。
_INTERVAL_MIN, _INTERVAL_MAX = 1, 100000
_COUNT_MIN, _COUNT_MAX = 1, 10000


def _parse_bounded_int(text: str, minimum: int, maximum: int) -> int | None:
    """仅接受 ASCII 十进制数字组成、且落在 [minimum, maximum] 的整数；其余返回 None。

    先按字符串长度判断数量级，避免对超长数字调用 ``int()`` 撞上
    CPython 的 4300 位十进制转换上限而抛 ``ValueError``。
    """
    stripped = text.strip()
    if not stripped.isascii() or not stripped.isdigit():
        return None
    # 去掉前导零后再比较位数，这样 "000001" 仍被当作 1。
    digits = stripped.lstrip("0") or "0"
    limit = str(maximum)
    if len(digits) > len(limit):
        return None
    value = int(digits)
    if value < minimum or value > maximum:
        return None
    return value


def _shorten(text: str, limit: int = 40) -> str:
    """把过长的用户输入截断，避免错误信息本身变得巨大。"""
    return repr(text) if len(text) <= limit else repr(text[:limit] + "…")


def parse_rule(text: str) -> Rule:
    """解析 KEY=VALUE;KEY=VALUE 形式的规则串。"""
    if text.strip() == "":
        raise RecurError("invalid_rule", "规则串为空")

    raw: dict[str, str] = {}
    for part in text.split(";"):
        part = part.strip()
        if not part or "=" not in part:
            raise RecurError("invalid_rule", f"规则片段格式错误: {part!r}")
        key, value = part.split("=", 1)
        key = key.strip()
        value = value.strip()
        if key not in _RULE_KEYS:
            raise RecurError("invalid_rule", f"不支持的规则键: {key!r}")
        if key in raw:
            raise RecurError("invalid_rule", f"重复的规则键: {key!r}")
        raw[key] = value

    if "FREQ" not in raw:
        raise RecurError("invalid_rule", "规则缺少 FREQ")

    freq = raw["FREQ"]
    if freq not in _FREQS:
        raise RecurError("unsupported_freq", f"不支持的 FREQ: {freq!r}（仅支持 DAILY/WEEKLY）")

    interval = 1
    if "INTERVAL" in raw:
        parsed = _parse_bounded_int(raw["INTERVAL"], _INTERVAL_MIN, _INTERVAL_MAX)
        if parsed is None:
            raise RecurError(
                "invalid_interval",
                f"INTERVAL 必须是 {_INTERVAL_MIN}..{_INTERVAL_MAX} 的整数: "
                f"{_shorten(raw['INTERVAL'])}",
            )
        interval = parsed

    byday: list[int] | None = None
    if "BYDAY" in raw:
        if freq == "DAILY":
            raise RecurError("invalid_byday", "BYDAY 不能与 DAILY 同时使用")
        byday = _parse_byday(raw["BYDAY"])

    count: int | None = None
    if "COUNT" in raw:
        count = _parse_bounded_int(raw["COUNT"], _COUNT_MIN, _COUNT_MAX)
        if count is None:
            raise RecurError(
                "invalid_count",
                f"COUNT 必须是 {_COUNT_MIN}..{_COUNT_MAX} 的整数: {_shorten(raw['COUNT'])}",
            )

    return Rule(freq=freq, interval=interval, byday=byday, count=count)


def _parse_byday(text: str) -> list[int]:
    """解析 BYDAY 值，返回去重并升序排列的星期偏移。"""
    parts = [piece.strip() for piece in text.split(",")]
    if not parts or any(piece == "" for piece in parts):
        raise RecurError("invalid_byday", f"BYDAY 含空值: {text!r}")

    offsets: set[int] = set()
    for piece in parts:
        code = piece.upper()
        if code not in _WEEKDAYS:
            raise RecurError("invalid_byday", f"非法的 BYDAY 值: {piece!r}")
        offsets.add(_WEEKDAYS[code])
    return sorted(offsets)


def parse_start(text: str) -> datetime:
    """解析 --start；必须带 UTC 偏移（+08:00 / -05:00 / Z）。"""
    return _parse_aware_datetime(text, "invalid_start", "--start")


def parse_until(text: str) -> datetime:
    """解析 --until；与 --start 一样必须带 UTC 偏移。"""
    return _parse_aware_datetime(text, "invalid_args", "--until")


def _parse_aware_datetime(text: str, code: str, label: str) -> datetime:
    value = text.strip()
    if value.endswith(("Z", "z")):
        value = value[:-1] + "+00:00"
    try:
        moment = datetime.fromisoformat(value)
    except (ValueError, OverflowError):
        raise RecurError(code, f"{label} 无法解析为 ISO 8601 时刻: {text!r}") from None
    if moment.tzinfo is None or moment.utcoffset() is None:
        raise RecurError(code, f"{label} 必须带 UTC 偏移: {text!r}")
    return moment


def _with_time(moment: datetime, day: date) -> datetime:
    """取 moment 的时分秒/微秒与偏移，落到 day 这个日历日上。"""
    return datetime(
        day.year,
        day.month,
        day.day,
        moment.hour,
        moment.minute,
        moment.second,
        moment.microsecond,
        tzinfo=moment.tzinfo,
        fold=moment.fold,
    )


def expand(
    start: datetime,
    rule: Rule,
    count: int | None = None,
    until: datetime | None = None,
) -> list[datetime]:
    """按规则展开出现时刻，按时间升序返回。"""
    if rule.freq == "DAILY":
        return _expand_fixed_step(start, timedelta(days=rule.interval), count, until)
    if rule.byday is None:
        return _expand_fixed_step(start, timedelta(weeks=rule.interval), count, until)
    return _expand_weekly_byday(start, rule, count, until)


_DATE_OUT_OF_RANGE = "展开结果越过 9999-12-31"


def _add_days(day: date, days: int) -> date | None:
    """日历日相加；越过 date.max 时返回 None，而不是抛 OverflowError。"""
    try:
        return day + timedelta(days=days)
    except OverflowError:
        return None


def _expand_fixed_step(
    start: datetime,
    step: timedelta,
    count: int | None,
    until: datetime | None,
) -> list[datetime]:
    """DAILY，以及不带 BYDAY 的 WEEKLY：固定日历步长。"""
    occurrences: list[datetime] = []
    current = start
    while True:
        if until is not None and current > until:
            break
        occurrences.append(current)
        if count is not None and len(occurrences) >= count:
            break
        try:
            current = current + step
        except OverflowError:
            # until 已到上界时，继续推进只会越界，展开已自然结束；
            # 若还要满足 count，则说明无法产出足够的日期。
            if until is not None:
                break
            raise RecurError("date_out_of_range", _DATE_OUT_OF_RANGE) from None
    return occurrences


def _expand_weekly_byday(
    start: datetime,
    rule: Rule,
    count: int | None,
    until: datetime | None,
) -> list[datetime]:
    """WEEKLY + BYDAY：以 start 所在周（周一开始）为第 0 周，按 INTERVAL 跳周。"""
    assert rule.byday is not None

    week_monday = start.date() - timedelta(days=start.weekday())
    occurrences: list[datetime] = []
    week_index = 0
    while True:
        monday = _add_days(week_monday, week_index * rule.interval * 7)
        if monday is None:
            # 本周起点已越过 9999-12-31：有 until 就自然结束，否则无法凑够 count。
            if until is not None:
                break
            raise RecurError("date_out_of_range", _DATE_OUT_OF_RANGE)
        # 提前退出：拿「本周周一的时刻」和 until 直接比时刻。它是本周所有候选的下界，
        # 因此它晚于 until 时，本周及以后都不可能有候选。不能先 astimezone 成
        # start 偏移下的日历日再比——在 +14:00/-12:00 撞上 0001/9999 边界时
        # 换算会溢出；直接比较 aware datetime 由 UTC 时刻决定，不存在该问题。
        if until is not None and _with_time(start, monday) > until:
            break
        for offset in rule.byday:
            day = _add_days(monday, offset)
            if day is None:
                # 该星期几及其后的候选都越过上界，本周不必再看。
                if until is not None:
                    break
                raise RecurError("date_out_of_range", _DATE_OUT_OF_RANGE)
            candidate = _with_time(start, day)
            if candidate < start:
                continue
            if until is not None and candidate > until:
                continue
            occurrences.append(candidate)
            if count is not None and len(occurrences) >= count:
                return occurrences
        week_index += 1
    return occurrences


def _parse_argv(argv: Sequence[str]) -> dict[str, str]:
    """极简参数解析：--name value 或 --name=value。"""
    options: dict[str, str] = {}
    index = 0
    while index < len(argv):
        token = argv[index]
        if not token.startswith("--"):
            raise RecurError("invalid_args", f"无法识别的参数: {token!r}")

        body = token[2:]
        if "=" in body:
            name, value = body.split("=", 1)
            if name not in _CLI_OPTIONS:
                raise RecurError("invalid_args", f"未知参数: --{name}")
            options[name] = value
            index += 1
            continue

        name = body
        if name not in _CLI_OPTIONS:
            raise RecurError("invalid_args", f"未知参数: --{name}")
        if index + 1 >= len(argv) or argv[index + 1].startswith("--"):
            raise RecurError("invalid_args", f"--{name} 缺少值")
        options[name] = argv[index + 1]
        index += 2
    return options


def _build_payload(argv: Sequence[str]) -> dict[str, Any]:
    options = _parse_argv(argv)

    if "rule" not in options:
        raise RecurError("invalid_rule", "缺少 --rule")
    if "start" not in options:
        raise RecurError("invalid_start", "缺少 --start")

    rule_text = options["rule"]
    rule = parse_rule(rule_text)
    start = parse_start(options["start"])

    cli_count: int | None = None
    if "count" in options:
        cli_count = _parse_bounded_int(options["count"], _COUNT_MIN, _COUNT_MAX)
        if cli_count is None:
            raise RecurError(
                "invalid_count",
                f"--count 必须是 {_COUNT_MIN}..{_COUNT_MAX} 的整数: "
                f"{_shorten(options['count'])}",
            )

    until: datetime | None = None
    if "until" in options:
        until = parse_until(options["until"])

    if until is not None and (cli_count is not None or rule.count is not None):
        raise RecurError("invalid_args", "COUNT/--count 与 --until 不能同时使用")

    if until is not None:
        count: int | None = None
    elif cli_count is not None:
        # 命令行显式给出的 --count 优先于规则串里的 COUNT。
        count = cli_count
    else:
        count = rule.count if rule.count is not None else _DEFAULT_COUNT

    occurrences = expand(start, rule, count=count, until=until)

    return {
        "rule": rule_text,
        "start": start.isoformat(),
        "occurrences": [moment.isoformat() for moment in occurrences],
    }


def main(argv: Sequence[str] | None = None) -> int:
    """CLI 主函数：成功返回 0，输入错误返回 2。"""
    args = list(sys.argv[1:] if argv is None else argv)
    try:
        payload = _build_payload(args)
    except RecurError as exc:
        print(json.dumps({"error": exc.message, "code": exc.code}))
        return 2
    except Exception as exc:  # 兜底：禁止 traceback 逃逸到 stderr / 非 0/2 退出码
        print(
            json.dumps(
                {
                    "error": f"内部错误: {exc.__class__.__name__}",
                    "code": "internal_error",
                }
            )
        )
        return 2

    print(json.dumps(payload))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
