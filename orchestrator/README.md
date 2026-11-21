# courier — 本地多 agent 派发器

方案 C 的落地实现：机械动作交给它（投任务卡、收结论、送评审、记账、存档、在关键动作前停下），
判断动作留给人（写规格、判验收、决定是否合并）。

零第三方依赖，只跑在 `127.0.0.1`。

## 快速开始

```bash
# 1. 登记任务（任务卡是 Markdown，规格由人写）
python -m orchestrator new handoff/task-T5.md --id T5 --branch ai/t5 --worktree ../wt-t5

# 2. 先空跑，验证流程（不调用任何 CLI，不花钱）
python -m orchestrator run T5 --dry

# 3. 真跑（会调用 claude / codex）
python -m orchestrator run T5

# 4. 看状态 / 起面板
python -m orchestrator status
python -m orchestrator hud --port 8787
```

## 目录

```
runs/<id>/
  task.md          任务卡快照（派发时复制，事后不可篡改）
  state.json       状态机 + 成本 + 轮次（原子写）
  events.jsonl     每次状态迁移，只追加
  mailbox.jsonl    "纸飞机"：一行一条消息，只传结论
  cursors.json     每个读者的游标（消息不可改，读完推进游标）
  artifacts/       每轮的原始输出（claude-roundN.txt / review-roundN.txt）
```

## 状态机

```
queued → working → reviewing → working(修复) ... → awaiting_approval
                              ↘ 评审干净 → awaiting_approval
任意状态 → interrupted（进程崩了，下次 recover 后可续跑）
      → blocked_human（实现/评审失败）
      → blocked_budget（超预算）
```

**永远不会自动合并**：跑到 `awaiting_approval` 就停。

## 策略

`orchestrator/config.json`：

| 键 | 含义 | 默认 |
|---|---|---|
| `max_task_usd` | 单任务成本上限 | 3.0 |
| `max_day_usd` | 当日成本上限 | 15.0 |
| `max_fix_rounds` | 自动修复轮次上限 | 3 |

## 测试

```bash
python -m unittest tests.test_orchestrator -v
```

11 个用例全部用 `DryAgent`，不调用 Claude/Codex，不花钱。