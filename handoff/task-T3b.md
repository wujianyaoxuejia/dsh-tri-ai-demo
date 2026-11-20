# 任务卡 T3b — recur 缺陷修复（第二轮）

上一轮实现（recur/__init__.py、recur/__main__.py、recur/cli.py）已通过 31 个冻结测试，但 Codex 只读评审与 DSH 反向抽查发现了越界崩溃。规格已升级到 v1.1（见 `recur/README.md` 新增的「输入边界」一节），现在按新规格修复。

## 可写文件

- `recur/cli.py`
- `recur/__init__.py`、`recur/__main__.py`（一般不需要改）
- `handoff/result-T3.json`（更新为真实的修复记录）

**禁止修改**：`tests/`、`recur/README.md`、`csvstat/`、`AGENTS.md`、`handoff/task-T3.md`。

## 必须修掉的缺陷

1. **[高] 日期上界崩溃**：`python -m recur --rule "FREQ=DAILY" --start 9999-12-30T00:00:00+00:00 --until 9999-12-31T00:00:00+00:00`
   现在抛 `OverflowError: date value out of range`、stdout 为空、退出码 1。按规格应退出 0 并返回 12-30、12-31 两条。

2. **[高] 极大 INTERVAL 未校验**：`--rule "FREQ=DAILY;INTERVAL=99999999"` 与 `INTERVAL=999999999999999999999999999999` 现在分别在后继日期运算、`timedelta()` 构造处抛 `OverflowError`，退出码 1。
   规格 v1.1：`INTERVAL` 必须在 1..100000，否则 `invalid_interval`。

3. **[中] 超长数字触发 ValueError**：`INTERVAL` / `COUNT` / `--count` 传入 5000 位数字时，`int()` 撞上 CPython 4300 位十进制转换上限，抛 `ValueError`，stdout 为空、退出码 1。
   必须先按长度/数值范围判定，返回 `invalid_interval` / `invalid_count`。

4. **[中] 展开无上界**：结果列表在打印前全部驻留内存。规格 v1.1 已给出 `COUNT`/`--count` ≤ 10000 与 `date_out_of_range`，请据此保证不会出现超大分配；越界一律报 `date_out_of_range` 而不是继续算。

5. **[低] 结果文件不实**：`handoff/result-T3.json` 声称"错误码严格按 README""未发现测试与文档矛盾"，与实际不符。请如实更新 `notes`，写清本轮修了什么。

## 硬性验收

- `python -m unittest discover -s tests` 仍然 **31 tests OK**（测试文件不许动）。
- 下列命令必须**要么**退出 0 且输出合法 JSON，**要么**退出 2 且输出 `{"error":...,"code":...}`。禁止 traceback、禁止空 stdout、禁止其它退出码：
  - `--rule "FREQ=DAILY;INTERVAL=99999999" --start 2026-01-01T00:00:00+08:00 --count 3` → 退出 2 / `invalid_interval`
  - `--rule "FREQ=DAILY;INTERVAL=$(python -c 'print("9"*5000)')" ...` → 退出 2 / `invalid_interval`
  - `--rule "FREQ=DAILY" --start 2026-01-01T00:00:00+08:00 --count $(python -c 'print("9"*5000)')` → 退出 2 / `invalid_count`
  - `--rule "FREQ=DAILY" --start 9999-12-30T00:00:00+00:00 --until 9999-12-31T00:00:00+00:00` → 退出 0，两条
  - `--rule "FREQ=WEEKLY;BYDAY=MO" --start 9999-12-28T00:00:00+00:00 --count 3` → 退出 2 / `date_out_of_range`
- 保持既有行为不变：`--count` 默认 10、`--until` 闭区间、与 `--count`/`COUNT` 互斥、偏移保持、按日历日推进。

## 交付

修完后更新 `handoff/result-T3.json`（task 写 `T3b`），`status` 为 `done`，`verify` 里贴真实的测试命令与结果，`notes` 里逐条说明 1–5 各是怎么修的。如果发现规格与测试矛盾，`status=blocked` 停下报告，不要改测试。