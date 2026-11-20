# T1 — 实现 csvstat

- 指派：Claude Code
- 分支：`ai/claude-t1`
- 工作目录：本仓库根目录（已切到该分支的 worktree）

## 目标

实现 `csvstat` 包，让冻结的测试契约全绿。

## 可写文件（只允许改这三个）

- `csvstat/__init__.py`
- `csvstat/cli.py`
- `csvstat/__main__.py`

## 禁止

- 不改 `tests/`、`README.md`、`AGENTS.md`、`handoff/`（契约已冻结）
- 不引入第三方依赖，只用 Python 3.11 标准库
- 不调用其它 AI

## 验收命令

```bash
python -m unittest discover -s tests -v
```

目标：全部通过，0 failure / 0 error。

## 产出

1. 上述三个实现文件
2. `handoff/result-T1.json`，格式见 `AGENTS.md`