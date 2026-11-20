# 任务卡 T3 — 新项目 recur：重复日程展开器

仓库里已有一个工具（`csvstat/`，已完成并推送）。本次要新建第二个工具 `recur`，**从零实现**。

## 你的产出

只允许新建这三个文件：

- `recur/__init__.py`
- `recur/cli.py`
- `recur/__main__.py`

外加任务要求的 `handoff/result-T3.json`。

**禁止修改**：`tests/`（冻结契约）、`recur/README.md`（规格书）、`AGENTS.md`、`csvstat/` 下任何文件、`handoff/task-T3.md`。

## 规格

严格按 `recur/README.md` 实现，一字一句读，特别是「语义细节」和「错误码一览」两节。

## 验收命令

```
python -m unittest discover -s tests
```

期望：31 个测试全部通过（11 个 csvstat + 20 个 recur）。当前 20 个 recur 测试是红的，因为实现还不存在。

## 硬约束

- 只准用 Python 标准库，不准引入第三方依赖。
- 不准改动或"适配"测试。如果你认为某个测试与 README 矛盾，**停下来**，把 `handoff/result-T3.json` 的 `status` 写成 `blocked`，在 `notes` 里说明是哪一条、为什么，然后结束。
- 不要为了让测试过而写死返回值（例如 if 输入等于某测试用例就返回固定结果）。
- 时间推进必须用日历日（`datetime.timedelta(days=n)` + `date` 运算），不要用 `timestamp ± 86400`。

## 交付

写 `handoff/result-T3.json`：

```json
{"task": "T3", "agent": "claude", "status": "done", "changed_files": ["recur/__init__.py", "recur/cli.py", "recur/__main__.py", "handoff/result-T3.json"], "verify": {"command": "python -m unittest discover -s tests", "exit_code": 0, "summary": "Ran 31 tests ... OK"}, "notes": "实现要点与任何取舍"}
```