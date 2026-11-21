# T4b 修复轮 —— 只修下列 6 条，不要重写

评审方（Codex）与验收方（DSH）在 T4 交付物里确认了 6 个问题。**只允许修改 `web/app.js`、`web/style.css`、`web/index.html` 三个文件**，其余一律不准动（尤其不要删 `applyDeepLink()` 与 `window.__PLANET_ENGINE__`，那是验收钩子）。

修完后把 `handoff/result-T4b.json` 写成：
```json
{"task":"T4b","agent":"claude","status":"done","changed_files":[...],"fixed":["#1 ...","#2 ..."],
 "verify":{"command":"...","exit_code":0,"summary":"..."},"notes":"≤120 字"}
```

## 必须修的 6 条

### 1. [高] 浅色白模下实例色没重置（Codex: app.js:2408 附近）
`setTheme` 只改了 `part.materials` 里的基础材质，但用 `InstancedMesh` 的部件（锚固螺栓 8192、散热鳍片 64、检修环廊舱室 2400）设置了 `instanceColor`，那些深灰仍与近白材质相乘，浅色下出现大片脏黑点。

要求：浅色时把实例色一起改成与 clay 同族的浅灰（例如 `0xc9ced6`），深色时恢复原始实例色；来回切换 3 次不得漂移（原始颜色要在构建时存一份）。验收方会截图对比螺栓区域。

### 2. [中] 选中淡出没覆盖点火特效（Codex: app.js:2496 附近）
`part.ignitionEffects` 里的辉光（反应堆顶部、主喷口内盘、姿态喷口发光盘）不参与「选中其他部件时本件 opacity → 0.45」的逻辑：点火后选外壳，喷口和反应堆仍满亮度。

要求：选中态淡出时，把该部件的 ignitionEffects 也按同一系数降到 0.45（它们本来就是 `transparent` 材质）；取消选中恢复。

### 3. [中] 三个部件的拆解方向反了（Codex: app.js:77）
`bolt-rings`（anchor `[-4700, 500, 1710]`，explodeDir `[0.55, 0.65, -0.45]`）、`heat-sink-fins`（`[-4500, 7800, 0]` / `[0.62, 0.3, -0.72]`）、`control-ring`（`[-1800, 5050, 0]` / `[0.85, 0.3, 0.42]`）的**水平**分量与自身 anchor 的径向夹角 > 90°，实际是朝轴心另一侧飞、穿过机体。

要求：把这三个部件的 `explodeDir` 水平分量改成与 anchor 径向同向（点积 > 0.6），竖直分量保留「略微上抬」。改完在注释里写明「explodeDir 水平分量与 anchor 径向同向」。

### 4. [低] 发射抖动被永久写进相机位置（Codex: app.js:2577）
抖动偏移逐帧 `camera.position.x += ...` 累加，从不减回；每次发射相机漂得越来越远。

要求：抖动用独立的 `shakeOffset` 向量，`tick` 里 `camera.position.copy(basePosition).add(shakeOffset)`，抖动结束后 `shakeOffset.set(0,0,0)`，相机精确回到原位。验收：连续发射 3 次后 `__PLANET_ENGINE__.camera.position` 与首次一致（误差 < 1）。

### 5. [DSH] 全部拆解后视野溢出
实测截图：点「全部拆解」后机体顶部被切出画面（`casing`、`reactor-core` 的上移量 + 3000 距离超出视锥）。

要求：拆解状态变化时按「当前所有部件包围盒」平滑调整相机距离（`controls.maxDistance` 内），复位时平滑回原位；不要瞬移、不要禁用用户手动缩放（用户手动缩放后 1 秒内不要再次自动拉远）。

### 6. [DSH] 浅色白模对比度太低
实测截图：浅色下整机发白、结构糊在一起。

要求：浅色模式加可见的形体分离——建议 `MeshStandardMaterial` 保持 metalness 0.05/roughness 0.9，但把环境光强度降到 1.2 左右、主光提高到 2.4、并给机体加一层极淡的轮廓（`EdgesGeometry` 线或 backside 描边，opacity ≤ 0.18），地面加深色接触影（径向渐变贴图用 `CanvasTexture` 生成，禁止外部图片）。

## 验收（DSH 会跑）

```bash
python tools/verify_t4.py --worktree <repo>
```
33 项静态+无头渲染检查必须全绿；另外会用
`?theme=light`、`?explode=all`、`?ignite=1`、`?launch=1`、`?select=reactor-core&explode=all` 五种深链截图人工比对。