# 多 Agent 协作系统：GitHub 开源调研（2026-11-21）

调研目标：为「每天真用来干活」的四 agent 协作找现成轮子，要求覆盖以下六条：
1. 断点可续 2. 预算上限 3. 全量留痕 4. 一任务一 worktree 5. 关键操作挂起等人 6. 可无人值守

判定基准：能否直接驱动**已登录的** `claude` / `codex` CLI（不另买 API），能否在 **Windows 原生**跑。

## 候选清单

| 项目 | 形态 | 驱动方式 | Windows | 六条覆盖 | 状态/风险 |
|---|---|---|---|---|---|
| [slopus/happy](https://github.com/slopus/happy) | 手机+桌面 App + CLI 包装 | 包装 `claude`/`codex` 进程，E2E 加密中继 | 有桌面版（Win/mac/Linux）+ iOS/Android | 3、6（人在外面也能回话） | MIT，活跃。最接近视频里的"HUD" |
| [BloopAI/vibe-kanban](https://github.com/BloopAI/vibe-kanban) | Web/桌面看板 | 直接起 Claude Code / Codex / Gemini / Copilot / Amp / Cursor / OpenCode 等 10+ | 有（README 提到 Windows 的 MCP_HOST 处理） | 1、3、4、5（diff 内联评论、PR/合并） | **已宣布 sunsetting**，不适合长期依赖 |
| [Nimbalyst/nimbalyst](https://github.com/Nimbalyst/nimbalyst) | Electron 工作区 | code-aware 编排 + worktree 隔离 | 有（Electron） | 1、4、5 | Crystal 于 2026-02 弃用后的继任者，项目年轻 |
| [smtg-ai/claude-squad](https://github.com/smtg-ai/claude-squad) | 终端 TUI | tmux 会话 + worktree，`cs -p codex` 可换 agent | **需 tmux + gh**，Windows 上要 WSL/MSYS | 4、5（应用前 review）、6 | AGPL-3.0，活跃，最成熟的一批 |
| [devflowinc/uzi](https://github.com/devflowinc/uzi) | CLI（Go） | tmux + worktree，`uzi prompt --agents claude:3,codex:2`、`broadcast`、`checkpoint` | 同上，需 tmux | 4、6（auto 自动确认） | 小项目，功能对味但 Windows 不友好 |
| [ruvnet/claude-flow (ruflo)](https://github.com/ruvnet/claude-flow) | MCP 元框架 + Console | 在 Claude Code/Codex 内部起 swarm、100+ 子 agent、Mission Control、成本跟踪、federation（mTLS 的跨机 agent 通信） | 原生支持（`npx ruflo init`） | 1、2（cost-tracker）、3、5（read/write/manage/full + ask/auto 审批档） | MIT，极活跃但体量巨大、营销成分重；它编排的是「Claude Code 内部的子 agent」，不是 Claude CLI ↔ Codex CLI 平级互审 |
| [coder/agentapi](https://github.com/coder/agentapi) | HTTP 适配层 | 把任意 agent CLI 包成 HTTP + SSE（`/message`、`/events`），README 明说可"让一个 agent 控制另一个" | Go 单文件，跨平台 | 只是积木（解决"怎么程序化喂话/收话"） | **已 deprecated**，但设计仍是标准做法 |

## 结论

1. **没有一个是"开箱即用、正好是视频里那套"的**。视频里那套 = 派发器 + 只传结论的消息总线 + 审批门 + 可视化 HUD；开源项目普遍只做了其中 1–2 块，或者做成了重型框架。
2. 这块地**换代极快**：vibe-kanban 在 sunset，Crystal 被 Nimbalyst 取代，agentapi 停止维护。押注单一产品风险高。
3. 真正稀缺的是**策略层**，不是界面层：
   - 两个不同厂商的 CLI 互为评审（Claude 写、Codex 只读挑刺、结论回投）
   - 规格所有权（谁能改契约）
   - 预算上限与断点续跑
   - 合并/删除这类不可逆操作必须挂起等人
   
   这些没有一个开源项目按"Claude+Codex 平级互审"来设计——它们默认"一个大脑 + 一堆工具型子 agent"。
4. 我们已经有的 `handoff/` 契约（task-*.md / result-*.json）正是在补第 3 点，而且已经被两个项目、四轮评审验证过。**该保留，不换成任何框架的私有格式。**

## 推荐组合（混合式，成本最低）

- **远程/手机看板**：Happy（`npm i -g happy` → `happy claude` / `happy codex`）。直接解决"离开电脑也能派活、手机上看着 agent 干活"。
- **worktree 与多任务隔离**：若可接受 WSL，用 claude-squad（tmux TUI，成熟度最高）；坚持 Windows 原生就用我们自己的 `git worktree` + 脚本（已验证可行）。
- **agent↔agent 传话与审批门**：自建一个 ~300 行的派发器，参考 agentapi 的模式（每个 CLI 一个 HTTP/文件信箱 + SSE 日志），把现有 `handoff/` 契约作为消息体。
- **不引入 ruflo**：能力重叠但方向不同（它向内编排子 agent，我们要的是横向跨 CLI 互审），且会往仓库写 `.claude/`、`CLAUDE.md` 等大量文件，污染当前干净的项目结构。

## 下一步（待确认）

先装 Happy 做 30 分钟验证：手机能不能看到并接管本地 `claude` 会话。通过则把它当作 HUD 层，派发器照旧自建；不通过则退回纯本地 Web HUD（方案 C）。