# 任务卡 T3c — 第三轮：极端 UTC 偏移下的时区换算崩溃

Codex 第二轮复核只剩 1 条：

**[中] `recur/cli.py:241`（`_expand_weekly_byday` 里 `until.astimezone(start.tzinfo)`）**
在日期边界做跨偏移换算会溢出，被兜底成 `internal_error`。

复现：

```
python -m recur --rule "FREQ=WEEKLY;BYDAY=FR" --start "9999-12-31T00:00:00+14:00" --until "9999-12-31T00:00:00-12:00"
```

现状：退出 2 / `{"code": "internal_error"}`。
期望：退出 0，返回 1 条 `2026-...` 不对——返回 `9999-12-31T00:00:00+14:00` 这一条（`start` 本身满足规则且 ≤ until）。

## 为什么这是缺陷

`9999-12-31T00:00:00+14:00` = `9999-12-30T10:00Z`；`9999-12-31T00:00:00-12:00` = `9999-12-31T12:00Z`。两者都是合法 ISO 8601，start ≤ until，按规格应正常展开。README v1.2 已补充：

> `internal_error` 只允许出现在输入本身合法却仍失败的兜底情况（视为缺陷，需修）。合法 ISO 8601 输入（含 `+14:00`/`-12:00` 等极端偏移、`0001-01-01`/`9999-12-31` 等边界日期）必须给出确定结果：要么成功，要么 `date_out_of_range` / `invalid_*`。

## 修法提示（可自行选择，但必须满足验收）

`until.astimezone(start.tzinfo)` 只是用来把 `until` 折算成"start 偏移下的日历日"做提前退出，真正判定仍靠循环里的 `candidate > until` 比较。所以换算失败时可以安全退化为不做日历日剪枝（并保证循环仍能终止，例如靠日期越界检测），而不是把异常抛成 `internal_error`。

## 硬性验收

1. 上面的复现命令 → 退出 0，`occurrences == ["9999-12-31T00:00:00+14:00"]`。
2. `python -m unittest discover -s tests` 仍 31 tests OK（禁改 tests/）。
3. 下列不得出现 `internal_error`、traceback、空 stdout 或其它退出码：
   - `--rule "FREQ=WEEKLY;BYDAY=FR" --start "0001-01-01T00:00:00-12:00" --until "0001-01-01T00:00:00+14:00"`
   - `--rule "FREQ=WEEKLY;BYDAY=MO,SU" --start "9999-12-31T23:59:59+14:00" --count 3`
   - `--rule "FREQ=DAILY" --start "0001-01-01T00:00:00+14:00" --until "0001-01-02T00:00:00-12:00"`
4. 既有行为不许回退：`--count` 默认 10、`until` 闭区间、偏移保持、按日历日推进、`INTERVAL`/`COUNT` 范围校验、校验优先级（先值后互斥）。

## 交付

更新 `handoff/result-T3.json`（task 写 `T3c`），说明改了什么、上面 3 组边界各返回什么。不要改 `tests/`、`recur/README.md`、`csvstat/`、`AGENTS.md`。若发现规格与测试矛盾，`status=blocked` 停下报告。