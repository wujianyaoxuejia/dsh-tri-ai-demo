# vendor

第三方依赖的唯一来源，冻结文件，任务实现方不得修改。

- `three.module.js` — three.js r160.1（unpkg: three@0.160.1/build/three.module.js）
- `OrbitControls.js` — three.js r160.1 examples/jsm/controls/OrbitControls.js

通过 `web/index.html` 里的 importmap 以 `three` / `three/addons/controls/OrbitControls.js` 引入。
