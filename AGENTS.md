# 协作协议（三 agent 共用）

任何 agent 进入本仓库，先读完本文件再动手。

## 角色

| 角色 | 职责 | 写权限 |
|---|---|---|
| DSH | 编排者：写任务卡、验收、合并、推送 | 唯一可操作 `main` 的角色 |
| Claude Code | 实现者：按任务卡写代码 | 只能写自己 `ai/claude-*` 分支的授权文件 |
| Codex | 评审者：只读代码，产出问题清单 | 只读，不改代码 |

## 硬规则

1. 不直接改 `main`。一任务一分支一 worktree。
2. 只改任务卡 `可写文件` 里列出的文件；列出的文件之外一律不改。
3. 完成后必须写 `handoff/result-<task>.json`，格式见下。
4. **禁止调用其它 agent**（任务里不许再启动 `claude` / `codex` / 其它 AI），防止递归烧钱。
5. 任务卡里的验收命令必须自己真的跑过，把原始结果写进 `verify` 字段。没跑过就不许填 `done`。
6. 不做任务卡之外的重构、不升级依赖、不改测试。

## result 文件格式

```json
{
  "task": "T1",
  "agent": "claude",
  "status": "done",
  "changed_files": ["csvstat/cli.py"],
  "verify": {"command": "python -m unittest discover -s tests -v", "exit_code": 0, "summary": "11 passed"},
  "notes": "遗留问题、假设、需要人类决策的点"
}
```

`status` 只能是 `done` / `blocked`。`blocked` 时在 `notes` 里写清卡在哪。