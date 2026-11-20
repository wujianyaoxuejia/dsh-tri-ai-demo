# recur — 极简重复日程展开器

把一条 iCalendar 风格的重复规则展开成若干具体时刻。零依赖，只用 Python 标准库。

## 用法

```
python -m recur --rule "FREQ=WEEKLY;BYDAY=TU,TH" --start 2026-01-05T19:00:00+08:00 --count 4
```

参数：

| 参数 | 必填 | 说明 |
|---|---|---|
| `--rule` | 是 | 规则串，`KEY=VALUE` 以 `;` 分隔 |
| `--start` | 是 | 起始时刻，ISO 8601，**必须带 UTC 偏移**（`+08:00`、`-05:00`、`Z` 均可） |
| `--count` | 否 | 展开条数，默认 10 |
| `--until` | 否 | 截止时刻（含），与 `--count` 互斥 |

`--count` 与 `--until` 同时给出 → `invalid_args`。两者都不给 → `count=10`。

## 输出

成功：退出码 0，stdout 是一行 JSON。

```json
{"rule": "FREQ=WEEKLY;BYDAY=TU,TH", "start": "2026-01-05T19:00:00+08:00", "occurrences": ["2026-01-06T19:00:00+08:00", "2026-01-08T19:00:00+08:00"]}
```

- `occurrences` 按时间升序，元素是 `datetime.isoformat()` 文本。
- **所有时刻保持 `--start` 的 UTC 偏移**，不做夏令时换算、不转成 `Z`。
- 若 `--start` 本身满足规则，第一条就是它自己。

失败：退出码 2，stdout 是一行 JSON。

```json
{"error": "人类可读的说明", "code": "机器可读的错误码"}
```

## 规则支持范围

只支持这些键，其余一律 `invalid_rule`：

- `FREQ`（必填）：`DAILY` | `WEEKLY`。其它值 → `unsupported_freq`。
- `INTERVAL`（选填）：正整数，默认 1。非法 → `invalid_interval`。
- `BYDAY`（选填，仅 WEEKLY）：`MO,TU,WE,TH,FR,SA,SU` 逗号分隔，不区分大小写。非法值、空值、或与 `DAILY` 同时出现 → `invalid_byday`。
- `COUNT`（选填）：正整数，等价于 `--count`。与 `--until` 同时出现 → `invalid_args`。非正整数 → `invalid_count`。

**不支持 `MONTHLY` / `YEARLY` / `BYSETPOS` / `BYMONTHDAY` 等**，遇到就明确拒绝而不是猜一个近似结果——宁可报错也不要静默给出错误日程。

## 语义细节（评审重点）

1. **DAILY**：第 k 次 = `start + k * INTERVAL` 天。
2. **WEEKLY 带 BYDAY**：以 `start` 所在的那一周（周一开始）为第 0 周，按 `INTERVAL` 跳周；每周取 `BYDAY` 里列出的所有工作日；早于 `start` 的候选直接丢弃。
3. **WEEKLY 不带 BYDAY**：等价于每 `7 * INTERVAL` 天一次，落在 `start` 的同一个星期几。
4. `BYDAY` 的书写顺序不影响输出顺序，输出永远按时间升序。
5. `--until` 是闭区间：恰好等于某次出现时，该次仍然包含。
6. 日期推进用**日历日**，不是 24 小时秒数相加——跨月、跨年、闰日都由日历决定。

## 错误码一览

| code | 触发条件 |
|---|---|
| `invalid_rule` | 规则串格式错误、缺 `FREQ`、出现未知键 |
| `unsupported_freq` | `FREQ` 不是 `DAILY`/`WEEKLY` |
| `invalid_interval` | `INTERVAL` 不是正整数 |
| `invalid_byday` | `BYDAY` 值非法/为空，或与 `DAILY` 同用 |
| `invalid_count` | `COUNT` 或 `--count` 不是正整数 |
| `invalid_args` | `COUNT` 与 `--until` 同时给出 |
| `invalid_start` | `--start` 无法解析或没有 UTC 偏移 |

## 测试

```
python -m unittest discover -s tests
```

`tests/test_recur.py` 是冻结契约，实现方不得修改。若发现测试与本文档矛盾，**停止并报告**，不要自行改测试或改契约。