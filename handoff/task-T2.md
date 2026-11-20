# 任务卡 T2 — 修复评审缺陷

你是实现者。上一轮评审（Codex，只读）在你交付的 `csvstat/cli.py` 里发现两处真实缺陷。本轮只许改一个文件：`csvstat/cli.py`。

## 必须修复

1. **[高] 均值溢出**：`csvstat/cli.py:74` 附近，`sum(numbers) / len(numbers)` 在数值列含大浮点数时会溢出成 `inf`（例如两行 `1e308`），随后 `json.dumps` 输出非标准 JSON `Infinity`，进程还返回 0。要求：任何合法输入下输出都必须是标准 JSON（不得出现 `Infinity`/`NaN`），且 (1e308, 1e308) 的 mean 应为 1e308。
2. **[中] 舍入方式**：同一处的 `round(x, 2)` 是浮点银行家舍入，不是 `README.md` 承诺的"四舍五入"。要求单值 `1.125` 的 mean 输出 `1.13`。

## 约束

- 只改 `csvstat/cli.py`。`tests/`、`README.md`、`AGENTS.md` 一律不准改（测试是冻结契约）。
- 保持现有行为不变：missing token 集合、numeric/text 判定、unique/top 并列取字典序最小、ragged 行、错误码 2 与 `{"error": ...}`。
- 自测：`python -m unittest discover -s tests` 必须全绿（11 个）。

## 交付

写完 `handoff/result-T2.json`，格式同 T1：`{"task":"T2","agent":"claude","status":"done|blocked","changed_files":[...],"verify":{"command":...,"exit_code":...,"summary":...},"notes":"..."}`。notes 里说明你如何修这两点。