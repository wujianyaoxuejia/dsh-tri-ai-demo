# 任务 T4 — 行星发动机交互拆解页（Three.js）

你是实现方（Claude）。DSH 是规格所有者与验收方，禁止改规格；Codex 会只读评审你的代码。

## 0. 硬约束

- 只能新建/修改这三个文件：`web/index.html`、`web/app.js`、`web/style.css`。
- **禁止**改 `vendor/`、`tests/`、`README.md`、`csvstat/`、`recur/`、`handoff/`（除本卡要求的 `handoff/result-T4.json`）。
- **禁止**任何外部网络依赖：不得出现 CDN、`https://` 资源、字体、贴图、GLB/GLTF/OBJ/FBX/GLTF 模型文件。只用 `vendor/three.module.js` 与 `vendor/OrbitControls.js`（已存在，用 importmap 引入）。
- 纯 JavaScript（ES module），无构建步骤，无 TypeScript，无 npm 包。
- 页面必须能被 `python -m http.server` 直接访问跑起来（module 需要 http，不用管 file://）。
- 若你发现本卡自相矛盾或做不出来，**停下来**把 `handoff/result-T4.json` 的 `status` 写成 `blocked` 并说明，不要自行改需求。

## 1. 视觉目标

复刻《流浪地球》行星发动机的**重工业 + 苏式粗野**气质：巨大的锥台机体、环向加强肋、外露桁架、密集管路、底部喷口、周身检修环廊。不是科幻飞船那种光滑流线。

- 形状语言：圆锥台、圆柱、环、桁架、螺栓。用 `BoxGeometry`/`CylinderGeometry`/`TorusGeometry`/`LatheGeometry` 组合，禁止用现成模型。
- 材质：`MeshStandardMaterial`，metalness 0.6–1.0，roughness 0.3–0.8；配色深灰金属 + 暗橙警示条 + 青蓝自发光。
- 灯光：1 个半球光 + 1 个主方向光 + 2 个补光；点火后有强橙色点光源与喷口自发光。

## 2. 部件表（必须逐条实现，id/名称/参数必须一字不差）

| id | 名称 | 形态要求 | 参数（用于详情面板） |
|---|---|---|---|
| base-ring | 基座环 | 空心圆柱环，外径 10000、内径 8600、高 400，环向 24 段加强肋 | 直径 10,000 m；高 400 m；混凝土+合金 |
| bolt-rings | 锚固螺栓 | `InstancedMesh` 一次画 **8192 个** M1200 螺栓（头顶六角），沿基座环顶面双圈排布 | 规格 M1200×4000；数量 8,192；预紧力 9,600 kN |
| truss-tower | 桁架塔 | 12 组竖向桁架，高 2600，每组由斜撑（交叉 Box）+ 立杆组成，环绕机体 | 组数 12；高 2,600 m；Q460 钢 |
| reactor-core | 主反应堆 | 中部圆柱 + 上下法兰 + 环向线圈（Torus ×12），可自发光 | 高度 1,200 m；温度 1.0×10⁸ K；功率 3.2×10¹³ W |
| fuel-pipes | 燃料管路 | 48 条沿机体外侧竖向抱箍的管路（Cylinder 分段 + 弯头 Torus），带法兰节 | 条数 48；管径 60 m；介质 重元素浆料 |
| casing | 机体外壳 | `LatheGeometry` 生成的锥台外壳，分 6 段，段间留 40 缝隙，带环向加强筋 | 高 8,000 m；外壳厚 120 m；分 6 段 |
| heat-sink-fins | 散热鳍片 | 64 片径向薄板，贴在外壳中部 | 片数 64；单片面积 1.2×10⁵ m² |
| control-ring | 检修环廊 | 三道环廊（Torus 截面 Box 网格化更佳），带栏杆与舱室块 | 直径 3,600 m；舱室 2,400 间 |
| main-nozzle | 主喷口 | 底部大喇叭（Lathe 曲线），内壁 3 层收缩环，可发光 | 出口直径 4,000 m；比冲 3.0×10⁴ m/s |
| vernier-nozzle | 姿态喷口 | 8 个小喷口均布在基座环外侧，可单独摆动 | 数量 8；单台推力 1.2×10⁷ N |

**总装比例**：整体高约 11,000 单位（1 单位 = 1 m），底部喷口在 y=0 附近，机体向上生长。相机初始位置 `(16000, 9000, 16000)`，`OrbitControls` 目标 `(0, 4200, 0)`，`minDistance 2000`，`maxDistance 60000`。

## 3. 交互（逐条验收）

1. **轨道/缩放**：`OrbitControls` 开启 damping，禁用 pan 越界（`maxPolarAngle` ≈ 1.55）。
2. **点击拆解**：Raycaster 命中部件 → 该部件沿「从轴心指向自身的方向 + 向上」飞出（explode 目标距离 1500–3500，按部件尺寸），`requestAnimationFrame` 里用缓动（easeInOutCubic，0.8 s）过渡；再次点击已拆部件则复位；顶栏「全部拆解/全部复位」按钮对 10 个部件批量执行。
3. **高亮**：选中部件 `emissive` 提升到 `#36d9ff`，未选中部件 `opacity` 降到 0.45（`transparent=true`）；选中件外加一层略微放大的描边壳（同几何体 + `MeshBasicMaterial` backside）或轮廓环，必须有可辨识的发光边。
4. **详情面板**：右侧面板显示 id、名称、全部参数（逐行 key/value）、一句功能描述（≤40 字）、当前状态（`待机/运转/点火/发射` 之一，随全局状态变）。
5. **点火**：按钮触发 3 秒渐变——反应堆与喷口自发光由 0 → 1，喷口出现锥形羽流（`ConeGeometry` + `MeshBasicMaterial` 叠加，`AdditiveBlending`，带轻微噪声缩放动画），橙色点光源强度 0 → 8，HUD 数值从待机跳到额定（功率/温度滚动上升到目标值）。再点一次熄火复原。
6. **发射**：发射按钮先要求已点火，否则提示「需先点火」；触发后羽流长度 ×2.5、抖动加剧、相机轻微 shake（±12 抖动 1.2 s）、屏幕边缘橙光闪烁一次，HUD 推力从 0 → 1.5×10⁹ N 滚动。
7. **主题切换**：深色科技（背景 #05070b，地面网格可见，暗色调）/ 浅色白模（背景 #e9edf2，材质换成近白哑光 clay：metalness 0.05、roughness 0.9、颜色 #dfe3e8，网格淡化，面板转浅色）。切换必须同时改 3D 与 DOM（`<body data-theme="light">` + CSS 变量），不能只改背景。
8. **标注**：每个部件有一个 HTML 标签（`position:absolute`，每帧用 `vector.project(camera)` 定位），显示名称；标签在相机背面或太远时隐藏；可按 `L` 键或按钮开关。
9. **部件列表面板**（左侧）：10 行，显示名称 + 是否已拆；点击行 = 点击 3D 部件；当前选中行高亮。
10. **操作引导面板**（左下或右上）：4 步引导（拖拽旋转 / 滚轮缩放 / 点击部件拆解 / 点火→发射）+ 快捷键表：`E` 全部拆解、`R` 全部复位、`L` 标注、`T` 主题、`空格` 点火/熄火、`F` 发射。

## 4. 工程质量要求

- 单一 `PARTS` 数据表驱动：3D 构建、详情面板、左列表、标签**全部**从同一份数据生成，禁止三处各写一遍名字/参数。
- `app.js` 函数化分块：`buildScene`、`buildParts`、`buildBolts`（InstancedMesh）、`updateExplode`、`pick`、`setTheme`、`ignite`、`launch`、`tick`。每个部件对象需带 `userData.partId`。
- 帧循环用单一时钟，`clock.getDelta()` 驱动；不得每帧 new 对象（向量/材质复用）。
- 无 console.error / console.warn；不得有未处理 Promise。
- 响应式：窗口 resize 重算相机与 renderer 尺寸；窄屏（<900px）面板可折叠为图标。
- 性能：桌面 60fps 目标；8192 螺栓必须用 InstancedMesh，不得循环 add 到场景。

## 5. 验收方式（DSH 会真的跑）

1. `python -m http.server 8899 --directory .` 后无头 Edge 截图 `web/index.html`，人工看画面是否像发动机、是否有 10 个部件、面板是否齐全。
2. 检查 `web/*.js` 内不存在 `http://`/`https://`/`.glb`/`.gltf`/`.obj`/`.fbx`。
3. 检查 `PARTS` 长度 == 10，左列表行数 == 10，id 与上表一致。
4. 检查 8192 螺栓确实是 InstancedMesh（`grep InstancedMesh`）。
5. 交互冒烟：headless 下用 CDP 点击画布中心，断言详情面板文本变化；点「点火」断言 `data-state="ignited"`。

## 6. 产出

`handoff/result-T4.json`：
```json
{"task":"T4","agent":"claude","status":"done|blocked","changed_files":["web/index.html","web/app.js","web/style.css"],
 "verify":{"command":"","exit_code":0,"summary":""},
 "notes":"实现假设与取舍，≤200 字"}
```
`verify.command` 必须是你真跑过的命令（至少一次 `python -m http.server` 探测 200，或 `node --check web/app.js`）。