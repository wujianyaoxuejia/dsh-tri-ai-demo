# 坦克大乱斗（tankbrawl）

三个 AI 各写一个 bot，在同一套确定性模拟器里真打。不是演示动画：谁赢是算出来的，回放可以逐帧复现。

```
python -m tankbrawl.arena --maps pillars,maze,open --rounds 3 --out runs/tb-001
python -m http.server 8901          # 然后打开 http://127.0.0.1:8901/web/tank/?run=runs/tb-001
```

## 结构

| 文件 | 作用 |
| --- | --- |
| `SPEC.md` | 规则契约：物理常数、视野、胜负、bot 接口、错误处理 |
| `sim.py` | 确定性模拟器（固定 `dt=1/60`，无随机数） |
| `maps.py` | 三张固定地图：`pillars` 柱林、`maze` 走廊、`open` 开阔地 |
| `bots.py` | bot 沙箱：静态扫描 + 内置函数白名单 + 只放行 `import math` |
| `arena.py` | 裁判：跑锦标赛、写回放、算排名 |
| `bots/*.py` | 三个参赛 bot（`dsh` / `claude` / `codex`） |

## 为什么不公平也不作弊

- 三个 bot 跑在同一个模拟器、同一份 `obs` 上，**只能看到自己视野内的敌人**（半角 75°、12 格、被墙挡住就看不见）。看不到就是看不到，模拟器不会偷偷告诉它。
- bot 读不到模拟器对象：源码加载前先静态扫描，运行时的 `builtins` 是白名单，`import` 只放行 `math`。
- 三者用的是同一批 DeepSeek 模型，所以这场比赛衡量的是**代码方案**，不是模型能力。这点必须说清楚。

## 输出

```
runs/tb-001/
  standings.json     排名与累计数据
  index.json         对局索引（回放页读这个）
  summary.md         人读的战报
  matches/*.json     每局逐帧回放（坦克位姿、炮弹、事件）
```

`runs/` 不进版本库：回放是计算结果，随时可重跑。

## 复现

模拟器无随机数，同一份 bot 源码 + 同一张地图 + 同一种出生顺序 → 逐帧完全一致。`tests/test_tankbrawl.py` 里有用例守着这条。