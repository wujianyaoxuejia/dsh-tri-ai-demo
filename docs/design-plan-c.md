# 方案 C 设计文档：本地多 Agent 协作系统（代号 courier）

状态：**待批准**（批准前不写实现代码）
日期：2026-11-21
前置：`docs/opensource-survey.md` 的开源调研 + Happy 实测失败记录（见附录 A）

---

## 0. 一句话

一个跑在本机的**常驻派发器**（Python 标准库，无第三方依赖）负责机械动作：把任务卡投给 Claude、把结果投给 Codex 评审、记账、存档、在关键动作前停下；
一个**本地 HUD**（localhost 网页）让你像看聊天记录一样看它们互相传话，并且只能由你按"批准"。
判断类工作（写任务卡、改规格、决定是否合并）仍由 DSH（我）做。

## 1. 为什么不是"接一个现成的"

- vibe-kanban 已停止维护、Crystal 被继任者取代、agentapi 停止维护。
- 它们默认"一个大脑 + 一堆工具型子 agent"；我们要的是**两个不同厂商的 CLI 平级互审**（Claude 写、Codex 只读挑刺），这一层没人做。
- Happy 实测：CLI 能连上中继（172.67.212.85:443 ESTABLISHED），但网页客户端配对三次全失败（`连接终端失败`），且 CLI 侧日志**没有任何入站连接记录**。即失败发生在它的云端，不在本机。哪怕修好，它也是把会话密钥托管在第三方云——不适合当"每天真用"的主干。

## 2. 六条硬要求 → 具体机制

| 要求 | 机制 | 验证方式 |
|---|---|---|
| 断点可续 | 每个任务一个 `runs/<id>/state.json`，每次状态迁移原子写入（写临时文件 + `os.replace`）；启动时扫描所有 run，把 `running` 状态的标记为 `interrupted` 并可一键续跑 | 任务跑到一半 `taskkill`，重启后能续上且不重复计费 |
| 预算上限 | 单任务 `budget_usd` + 全局每日 `daily_budget_usd`；每次派发前检查，超了就进 `blocked_budget` 状态，不静默继续 | 故意设 $0.05 上限，跑一轮应停在预算不足 |
| 全量留痕 | `runs/<id>/events.jsonl` 追加写（不可改），加上 `artifacts/` 里原样保存 prompt、result、review、diff、退出码、耗时、花费 | 任意时刻能从事件流重建出"谁在什么时候做了什么、花了多少" |
| 一任务一 worktree | `git worktree add ../wt-<id> -b ai/<id>`；合并后 `git worktree remove`；同一 repo 的 main 只由派发器在批准后写入 | 并发三个任务，互不踩文件 |
| 关键操作挂起等人 | 策略表决定哪些动作必须人工：合并、push、删文件/分支、改动冻结文件（tests/、契约文档）、超过 3 轮评审 | 每个 gate 都必须能在 HUD 上看到并把任务卡在那里 |
| 可无人值守 | 无 gate 的路径（派发→实现→评审→修→再评审）自动跑完停在 `awaiting_approval`；**永不自动批准任何 gate** | 关掉 HUD 放一夜，第二天看它停在等待批准，而不是自己合并了 |

## 3. 组件与文件布局

```
orchestrator/
  __main__.py         # 入口：run / status / approve <id> / resume <id> / cancel <id>
  config.toml         # 预算、agent 命令、路径、策略开关（唯一的可调旋钮）
  state.py            # Task 数据类 + 状态机 + 原子持久化
  mailbox.py          # JSONL 信箱：追加写 + 每读者游标，天然支持重放
  agents.py           # ClaudeAdapter / CodexAdapter / DryRunAdapter（统一接口）
  policy.py           # 动作 → 需要/不需要人工
  loop.py             # 单线程监督循环（一次只推进一步，可随时中断）
  hud/server.py       # 127.0.0.1:8787，HTTP + SSE
  hud/static/         # 单页 HTML + 原生 JS，无构建步骤
tests/                # 状态机、策略、游标、崩溃恢复的单元测试（用 DryRunAdapter，不花钱）

runs/<task-id>/
  task.md             # 冻结的任务卡（给 Claude 的输入）
  state.json          # 状态 + 花费 + 轮次 + 指针
  events.jsonl        # 只追加的事件流
  artifacts/          # prompt / result / review-N / diff / stdout / stderr
  mailbox/            # 各 agent 的收件箱（JSONL）
```

## 4. 消息格式（"纸飞机"）

一条消息就是一行 JSON，落在收件人的信箱里：

```json
{
  "id": "msg-0007",
  "ts": "2026-11-21T10:40:12+08:00",
  "task": "t3-recur",
  "from": "claude",
  "to": "codex",
  "kind": "result",              // task | result | review | question | answer | approval | system
  "body": "已修复 sum() 溢出与舍入；见 artifacts/result-T3b.json",
  "refs": {
    "commit": "24eaaee",
    "artifacts": ["artifacts/result-T3b.json", "artifacts/diff-2.patch"],
    "verify": {"cmd": "python -m unittest discover -s tests", "exit": 0, "summary": "Ran 31 tests / OK"}
  },
  "cost_usd": 0.474,
  "tokens": {"in": 21034, "out": 1892}
}
```

设计约束（这几条决定了它能不能长期用）：

1. **只传结论，不传原始上下文。** body 是一两句话加 `refs`；评审者需要细节自己去读 artifacts。这正是视频里"纸飞机上只写一句结论"的做法，也是不把上下文炸掉的关键。
2. **append-only + 游标。** 每个读者记自己的偏移量，崩溃重放不会重复投递。
3. **消息不可改。** 修正靠新消息，不靠编辑历史。这让"有据可查"成立。

## 5. 任务状态机

```
queued ──dispatch──> working ──result──> reviewing
  ↑                                         │
  │                              ┌──────────┼───────────┐
  │                        issues│     clean│     rounds≥3
  │                              ↓          ↓           ↓
  └────────────────────── fix ───┘   awaiting_approval  blocked_human
                                            │  │
                                    approve │  │ reject
                                            ↓  ↓
                                        merging  cancelled
                                            │
                                          done
任意状态 ──崩溃/被杀──> interrupted ──resume──> 中断前的状态
任意状态 ──超预算──> blocked_budget
```

每次迁移写一行 `events.jsonl`：`{"ts","from_state","to_state","actor","reason","cost_delta"}`。

## 6. 策略表（哪些动作必须停下等人）

| 动作 | 默认 | 说明 |
|---|---|---|
| 派发给 Claude 实现 | 自动 | 只写 `ai/<task>` 分支 |
| 派发给 Codex 评审 | 自动 | 强制只读：`-s read-only` |
| 修复轮次 ≤ 3 | 自动 | 第 4 轮起必须人来决定 |
| 合并到 main | **人工** | HUD 上按"批准" |
| `git push` | **人工** | 同上，且合并后单独确认 |
| 删除文件 / 分支 / worktree | **人工** | 不可逆 |
| 改动冻结文件（tests/、契约文档） | **人工** | 只能由规格所有者（我）改 |
| 超预算 | 自动停 | 进 `blocked_budget`，需人抬额度 |

策略写在 `config.toml`，不写死在代码里——因为用一个月后你一定会想调。

## 7. 预算与记账

- Claude：`claude -p ... --output-format json` 直接返回 `costUSD` 与 usage，逐条累加，不需要估算。
- Codex：`codex exec` 输出末尾有 `tokens used`；按 `config.toml` 里的 `codex_usd_per_mtok` 估算（默认按实测 25–27k/轮、单轮成本折算）。
- 全局日预算独立于单任务预算，任一超限即停。
- HUD 上每个任务一条进度条，红了就是钱到了。

## 8. HUD

一个页面，四块：

1. **任务列表**：状态徽章（working / reviewing / awaiting_approval / blocked_budget …）+ 花费 + 轮次。
2. **对话流**：每个任务一条时间线，纸飞机方向明确（claude → codex / codex → claude / system → 你）。只显示 `body`，点开看 artifacts。
3. **Diff**：`git diff main...ai/<task>` 原样显示，不渲染成花哨的东西。
4. **待办批准**：所有 gate 排在最上面，`批准` / `拒绝（附理由）`。拒绝理由会作为一条 `system` 消息投回给 Claude。

技术选择：`http.server` + SSE，不引入 Web 框架、不需要 `pnpm`、不需要构建。理由：这东西要能在你机器上活一年，依赖越少越好；`pnpm build` 那一套在别的项目里已经证明会腐坏。
绑定 `127.0.0.1`，访问需带一次性 token（写在 `runs/hud-token.txt`）。

## 9. 无人值守的边界（重要）

"可以无人值守" ≠ "什么都敢让它自己干"。默认无人值守只覆盖：
实现 → 评审 → 修复 → 再评审 → **停**。
合并、push、删除永远等人。这条不提供"完全自动"开关——需要时你也应该在场，因为不可逆操作没有后悔药。

## 10. 分阶段交付（每阶段都可停）

| 阶段 | 内容 | 花钱吗 | 完成判据 |
|---|---|---|---|
| P0 | 状态机 + 信箱 + DryRunAdapter + 单元测试 | 否 | `python -m unittest` 全绿，含崩溃恢复用例 |
| P1 | ClaudeAdapter 真实跑通一个任务（用已有 recur 仓库做靶子） | 是（< $1） | 一条任务从 queued 走到 awaiting_approval |
| P2 | CodexAdapter 评审 + 修复轮次（≤3） | 是（~$2） | 一轮真评审能触发一次修复，第三次干净收尾 |
| P3 | HUD + 批准/拒绝闭环 | 否 | 在网页上点批准能真的合并并推进状态 |
| P4 | 崩溃测试：跑到一半 `taskkill`，重启续跑 | 否 | 状态正确、不重复计费、不留孤儿 worktree |

P0–P4 全部通过后，才谈"每天真用"。

## 11. 待你决定的四件事

1. **默认预算**：建议单任务 $3、每日 $15。太紧会频繁打断，太松一夜可能烧掉 $30+。
2. **HUD 要不要给手机看**：绑 `0.0.0.0` + token 可以从手机访问，但等于把"能批准合并"的界面暴露到局域网。建议先只在本机，需要远程时再单独加一层。
3. **自动合并的边界**：是否允许"只改了 docs/ 且测试全绿"的任务自动合并？建议不允许——省下的人工点击换不来等值的风险。
4. **Codex 是否允许改代码**：当前设计它只读评审。若放开写权限，"互审"就退化成"两个 agent 互相改"，失去独立性。建议保持只读。

---

## 附录 A：Happy 实测记录（2026-11-21）

- 安装：`npm i -g happy` 失败（npmmirror 缺 `@aws-sdk/credential-provider-cognito-identity@^3.972.84`，ETARGET）；改用官方源 + 缓存装成 `happy@1.2.6`，并需 `--allow-scripts=happy` 放行 postinstall 解包。
- 体量：`D:\nodejs\node_modules\happy` 约 0.93 GB（打包了 claude-agent-sdk 的 win32 二进制）。
- 手机路径：需要 Happy Coder 手机 App；国区 App Store 大概率没有，用户选择改走网页登录。
- 网页路径：`happy` → `Web Browser` → 打开 `https://app.happy.engineering/terminal/connect#key=...` → 点"接受连接" → **三次均报 `连接终端失败`**，刷新后重试同样失败。
- 诊断：CLI 侧日志 `C:\Users\Administrator\.happy\logs\2026-11-21-10-25-55-pid-25532.log` 只有 `Browser opened successfully`，**无任何入站连接记录**；同时该进程有 `172.67.212.85:443 ESTABLISHED`，说明本机到中继的网络是通的。结论：失败在云端握手，不在本机配置。
- 处置：已 `Stop-Process` 清理 happy 进程；不删除 node_modules（保留体积 0.93G，如确定不用可 `npm rm -g happy` 回收）。