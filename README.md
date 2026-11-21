# dsh-tri-ai-demo

三个 AI 在同一个仓库里配合写代码的实验：**DSH 负责拆任务与验收，Claude Code 负责实现，OpenAI Codex 负责只读评审**。所有交付都走「先写冻结测试 → 实现 → 评审 → 修复 → 人工批准合并」的闭环。

协作规则见 [AGENTS.md](AGENTS.md)，每一轮的任务卡与结果在 [handoff/](handoff/)。

## 仓库里有什么

| 目录 | 是什么 |
| --- | --- |
| `csvstat/` | 把 CSV 变成列统计 JSON 的小工具，零依赖，Python 3.11 标准库（[规格](csvstat/README.md)） |
| `recur/` | RRULE-lite：把 `FREQ=WEEKLY;BYDAY=TU,TH` 这类重复规则展开成具体时刻（[规格](recur/README.md)） |
| `web/` + `vendor/` | 流浪地球「行星发动机」的 Three.js 交互拆解页（纯前端，零外链） |
| `orchestrator/` | courier：常驻派发器内核 —— 任务状态机、append-only 信箱、预算上限、崩溃恢复、本地 HUD |
| `tests/` | 冻结的契约测试（42 个），实现方不许改 |
| `tools/` | 验收脚本：`verify_t4.py`（页面 33 项）、`deploy-desktop.ps1`（同步到桌面） |
| `docs/` | [开源调研](docs/opensource-survey.md) 与 [方案 C 设计](docs/design-plan-c.md) |
| `handoff/` | 三方之间传递的「纸飞机」：任务卡、评审意见、结果回执 |

## 怎么跑

```bash
# 全部单元测试（42 个）
python -m unittest discover -s tests

# 列统计
python -m csvstat data.csv

# 重复规则展开
python -m recur --rule "FREQ=WEEKLY;BYDAY=TU,TH" --start 2026-01-05T19:00:00+08:00 --count 4

# 行星发动机页面：ES module + importmap 需要 http，不能直接双击 html
python -m http.server 8899 --bind 127.0.0.1
# 打开 http://127.0.0.1:8899/web/
```

页面的验收需要本机有 Edge：

```bash
python tools/verify_t4.py      # 33 项：静态检查 + 无头渲染 6 种状态截图
```

## 页面交互

拖拽旋转、滚轮缩放、点击部件拆解/装回、单击看详情；快捷键 `E` 全部拆解、`R` 复位、`L` 标注开关、`T` 深色/浅色白模、`空格` 点火/熄火、`F` 发射（需先点火）。深链参数 `?theme=light&explode=all&select=reactor-core&ignite=1` 可直接复现某个状态。

## 怎么判断这活干完了

每个任务都有可执行判据，不靠「看起来没问题」：

- csvstat / recur：冻结测试 + 不变量模糊检查（退出码只能是 0/2、stdout 必须单行合法 JSON、错误码必须在规格表内）
- 行星发动机：33 项脚本验收，其中包括无头浏览器真的渲染 6 种状态

评审由 Codex 以只读模式跑（`codex exec -s read-only`），它能改的东西为零，只能提意见；是否采纳由规格所有者判断，最终合并由人批准。