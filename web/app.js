import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ==========================================================================
   行星发动机 · 交互拆解页
   单一 PARTS 数据表驱动三维构建、详情面板、部件列表与标注。
   所有尺寸单位：1 单位 = 1 米。
   ========================================================================== */

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const IGNITION_SECONDS = 3;
const EXPLODE_SECONDS = 0.8;
const CYAN = 0x36d9ff;
const ORANGE = 0xff7a1a;
const ORANGE_DARK = 0x8f3f0c;
const CAMERA_POS = [16000, 9000, 16000];
const CAMERA_TARGET = [0, 4200, 0];

const CASING_Y0 = 3000;
const CASING_Y1 = 11000;
const CASING_R0 = 5200;
const CASING_R1 = 3000;
const BAND_COUNT = 6;
const BAND_GAP = 40;
const BAND_H = (CASING_Y1 - CASING_Y0 - BAND_GAP * (BAND_COUNT - 1)) / BAND_COUNT;
const CUT_ANGLE = 45 * DEG;
const CUT_HALF = 38 * DEG;
const CUT_BANDS = [1, 2];

const state = {
  theme: 'dark',
  labels: true,
  selected: null,
  ignited: false,
  ignition: 0,
  ignitionFrom: 0,
  ignitionTarget: 0,
  ignitionStart: 0,
  launched: false,
  launchLevel: 0,
  launchFrom: 0,
  launchTarget: 0,
  launchStart: 0,
  shake: 0,
  shakeEnd: 0,
  time: 0,
  hudClock: 0,
  hudDirty: true,
};

let lowQuality = false;

/* --------------------------------------------------------------------------
   1. 单一数据表：部件定义
   -------------------------------------------------------------------------- */

const PART_DEFS = [
  {
    id: 'base-ring',
    name: '基座环',
    en: 'BASE RING',
    params: [['直径', '10,000 m'], ['高', '400 m'], ['材质', '混凝土+合金']],
    desc: '承载整机质量与点火反冲，并锚固于发射基台的环形承力结构。',
    anchor: [5150, 480, 0],
    explodeDir: [0.82, 0.42, 0.38],
    explodeDistance: 1900,
    build: buildBaseRing,
  },
  {
    id: 'bolt-rings',
    name: '锚固螺栓',
    en: 'ANCHOR BOLTS',
    params: [['规格', 'M1200×4000'], ['数量', '8,192'], ['预紧力', '9,600 kN']],
    desc: '以超高压预紧力将基座环与地基锁死的巨型锚固螺栓群。',
    anchor: [-4700, 500, 1710],
    // explodeDir 水平分量与 anchor 径向同向
    explodeDir: [-0.85, 0.65, 0.31],
    explodeDistance: 2600,
    build: buildBolts,
  },
  {
    id: 'truss-tower',
    name: '桁架塔',
    en: 'TRUSS TOWER',
    params: [['组数', '12'], ['高', '2,600 m'], ['材质', 'Q460 钢']],
    desc: '环绕机体提供抗风与抗振支撑的十二组空间桁架。',
    anchor: [-5200, 2900, 3000],
    explodeDir: [-0.66, 0.5, 0.56],
    explodeDistance: 3200,
    build: buildTrussTower,
  },
  {
    id: 'reactor-core',
    name: '主反应堆',
    en: 'REACTOR CORE',
    params: [['高度', '1,200 m'], ['温度', '1.0×10⁸ K'], ['功率', '3.2×10¹³ W']],
    desc: '为行星发动机提供持续能量输出的主聚变反应堆。',
    anchor: [0, 5900, 0],
    explodeDir: [0, 1, 0],
    explodeDistance: 3500,
    build: buildReactorCore,
  },
  {
    id: 'fuel-pipes',
    name: '燃料管路',
    en: 'FUEL PIPES',
    params: [['条数', '48'], ['管径', '60 m'], ['介质', '重元素浆料']],
    desc: '向下部燃烧室输送重元素浆料的耐压管路系统。',
    anchor: [-800, 9600, 3150],
    explodeDir: [0.3, 0.35, 0.9],
    explodeDistance: 2800,
    build: buildFuelPipes,
  },
  {
    id: 'casing',
    name: '机体外壳',
    en: 'CASING',
    params: [['高', '8,000 m'], ['外壳厚', '120 m'], ['分段', '6 段']],
    desc: '承受内压并隔绝高温的主承力锥台外壳。',
    anchor: [3595, 8800, 0],
    explodeDir: [0, 0.9, -0.44],
    explodeDistance: 3000,
    build: buildCasing,
  },
  {
    id: 'heat-sink-fins',
    name: '散热鳍片',
    en: 'HEAT SINKS',
    params: [['片数', '64'], ['单片面积', '1.2×10⁵ m²']],
    desc: '将外壳废热辐射排散的径向高比表面积鳍片。',
    anchor: [-4500, 7800, 0],
    // explodeDir 水平分量与 anchor 径向同向
    explodeDir: [-0.9, 0.3, 0],
    explodeDistance: 2900,
    build: buildHeatSinkFins,
  },
  {
    id: 'control-ring',
    name: '检修环廊',
    en: 'ACCESS GALLERIES',
    params: [['直径', '3,600 m'], ['舱室', '2,400 间']],
    desc: '供检修人员环绕反应堆作业的三层密闭环廊。',
    anchor: [-1800, 5050, 0],
    // explodeDir 水平分量与 anchor 径向同向
    explodeDir: [-0.9, 0.3, 0],
    explodeDistance: 2400,
    build: buildControlRing,
  },
  {
    id: 'main-nozzle',
    name: '主喷口',
    en: 'MAIN NOZZLE',
    params: [['出口直径', '4,000 m'], ['比冲', '3.0×10⁴ m/s']],
    desc: '将反应堆能量转化为巨量推力的主喷管。',
    anchor: [0, 500, 0],
    explodeDir: [0.12, 0.1, 1],
    explodeDistance: 2100,
    build: buildMainNozzle,
  },
  {
    id: 'vernier-nozzle',
    name: '姿态喷口',
    en: 'VERNIER NOZZLES',
    params: [['数量', '8'], ['单台推力', '1.2×10⁷ N']],
    desc: '用于姿态微调与推力矢量修正的八台小型喷口。',
    anchor: [0, 420, 5620],
    explodeDir: [-0.62, 0.38, 0.68],
    explodeDistance: 2500,
    build: buildVernierNozzle,
  },
];

/* --------------------------------------------------------------------------
   2. 全局对象与临时量（帧循环内不新建向量）
   -------------------------------------------------------------------------- */

let scene = null;
let camera = null;
let renderer = null;
let controls = null;
let clock = null;
let textures = null;
let envMaps = null;

let hemiLight = null;
let keyLight = null;
let fillCyanLight = null;
let fillOrangeLight = null;
let ignitionLight = null;
let reactorLight = null;

let groundMat = null;
let contactShadow = null;
let contactShadowMat = null;
let pitMat = null;
let rimMat = null;
let gridCoarse = null;
let gridFine = null;
let ringMats = [];
let stars = null;
let starMat = null;

let plumeGroup = null;
let plumeOuterMat = null;
let plumeMidMat = null;
let plumeCoreMat = null;
let plumeGlow = null;
let plumeGlowMat = null;
let nozzleSprite = null;
let nozzleSpriteMat = null;
let padGlowMat = null;
let padGlowMesh = null;
let launchRing = null;
let launchRingMat = null;

let outlineHullMat = null;
let outlineCageMat = null;
let outlineNodes = [];
let lightOutlineMat = null;
const lightOutlineMeshes = [];

const cameraFit = {
  active: false,
  explodedCount: 0,
  baseDistance: 0,
  baseTargetY: 0,
  lastUserZoom: -10,
  goal: 0,
};

const parts = [];
const partById = new Map();
const pickTargets = [];
const vernierAnim = [];

const ui = {};
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();

const _dummy = new THREE.Object3D();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _color = new THREE.Color();
const _labelWorld = new THREE.Vector3();
const _labelCamera = new THREE.Vector3();
const _labelProjected = new THREE.Vector3();
const _shakeOffset = new THREE.Vector3();
const cameraBasePosition = new THREE.Vector3();
const _fitBox = new THREE.Box3();
const _fitBoxPart = new THREE.Box3();
const _fitSphere = new THREE.Sphere();
const _fitSize = new THREE.Vector3();
const _fitCenter = new THREE.Vector3();
const _fitDirection = new THREE.Vector3();
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const ZERO = new THREE.Vector3();
const SUP_DIGITS = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];

let toastTimer = 0;
let flashTimer = 0;
let lastPointerWasDrag = false;
let ignoreNextClick = false;
let pointerDownInfo = null;
let dragDistance = 0;

/* --------------------------------------------------------------------------
   3. 通用工具
   -------------------------------------------------------------------------- */

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function smoothstep(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function superscript(value) {
  return String(value)
    .split('')
    .map((ch) => SUP_DIGITS[Number(ch)] || ch)
    .join('');
}

function formatScientific(value, unit) {
  if (!Number.isFinite(value) || value <= 0.001) return `0 ${unit}`;
  if (value < 10000) return `${Math.round(value).toLocaleString('en-US')} ${unit}`;
  let exponent = Math.floor(Math.log10(value));
  let mantissa = value / Math.pow(10, exponent);
  if (mantissa >= 9.95) {
    mantissa /= 10;
    exponent += 1;
  }
  return `${mantissa.toFixed(1)}×10${superscript(exponent)} ${unit}`;
}

function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function casingRadius(y) {
  const t = clamp((y - CASING_Y0) / (CASING_Y1 - CASING_Y0), 0, 1);
  return CASING_R0 + (CASING_R1 - CASING_R0) * t;
}

function casingBandRange(index) {
  const start = CASING_Y0 + index * (BAND_H + BAND_GAP);
  return [start, start + BAND_H];
}

function isCutBand(index) {
  return CUT_BANDS.indexOf(index) !== -1;
}

function angleInCutWindow(angle) {
  const a = ((angle % TAU) + TAU) % TAU;
  return a > CUT_ANGLE - CUT_HALF && a < CUT_ANGLE + CUT_HALF;
}

function byId(id) {
  return document.getElementById(id);
}

function detectSoftwareRenderer() {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    if (!gl) return false;
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const name = debugInfo
      ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
  } catch (error) {
    return false;
  }
}

function targetPixelRatio() {
  const dpr = window.devicePixelRatio || 1;
  if (lowQuality) return Math.min(dpr, 1) * 0.65;
  return Math.min(dpr, 2);
}

function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

/* --------------------------------------------------------------------------
   4. 程序化贴图与环境（全部本地生成，无外部资源）
   -------------------------------------------------------------------------- */

function makeTexture(draw, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  draw(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function initTextures() {
  const rng = makeRng(0x51c3a7);
  const metal = makeTexture((ctx, size) => {
    ctx.fillStyle = '#d8dce0';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 260; i += 1) {
      const y = rng() * size;
      const alpha = 0.025 + rng() * 0.09;
      ctx.strokeStyle = rng() > 0.45 ? `rgba(255,255,255,${alpha})` : `rgba(45,52,58,${alpha})`;
      ctx.lineWidth = 0.6 + rng() * 1.8;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y + (rng() - 0.5) * 3);
      ctx.stroke();
    }
    for (let i = 0; i < 900; i += 1) {
      const x = rng() * size;
      const y = rng() * size;
      const shade = rng() > 0.5 ? 255 : 30;
      ctx.fillStyle = `rgba(${shade},${shade},${shade},${0.02 + rng() * 0.05})`;
      ctx.fillRect(x, y, 1 + rng() * 2, 1 + rng() * 2);
    }
    ctx.strokeStyle = 'rgba(40,46,52,0.22)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i += 1) {
      const y = (i + 0.5) * (size / 4);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }
  }, 256);
  metal.repeat.set(8, 10);

  const hazard = makeTexture((ctx, size) => {
    ctx.fillStyle = '#1b1a17';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#c46518';
    ctx.lineWidth = size / 11;
    for (let i = -size; i < size * 2; i += size / 4) {
      ctx.beginPath();
      ctx.moveTo(i, size);
      ctx.lineTo(i + size, 0);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    for (let i = 0; i < 120; i += 1) {
      ctx.fillRect(rng() * size, rng() * size, 1, 1);
    }
  }, 128);
  hazard.repeat.set(10, 1);

  const glow = makeTexture((ctx, size) => {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.22, 'rgba(255,255,255,0.62)');
    gradient.addColorStop(0.55, 'rgba(255,255,255,0.16)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }, 128);
  glow.wrapS = THREE.ClampToEdgeWrapping;
  glow.wrapT = THREE.ClampToEdgeWrapping;

  // 浅色模式下的地面接触影（径向渐变，本地 CanvasTexture 生成）
  const contact = makeTexture((ctx, size) => {
    const gradient = ctx.createRadialGradient(
      size / 2, size / 2, size * 0.04,
      size / 2, size / 2, size * 0.5,
    );
    gradient.addColorStop(0, 'rgba(18,26,34,0.62)');
    gradient.addColorStop(0.45, 'rgba(18,26,34,0.34)');
    gradient.addColorStop(0.75, 'rgba(18,26,34,0.1)');
    gradient.addColorStop(1, 'rgba(18,26,34,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }, 256);
  contact.wrapS = THREE.ClampToEdgeWrapping;
  contact.wrapT = THREE.ClampToEdgeWrapping;

  textures = { metal, hazard, glow, contact };
}

function makeEnvironment(theme) {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 384;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  if (theme === 'light') {
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.46, '#e8edf3');
    gradient.addColorStop(0.55, '#c9d1da');
    gradient.addColorStop(1, '#aeb8c2');
  } else {
    gradient.addColorStop(0, '#5d7d9c');
    gradient.addColorStop(0.36, '#233746');
    gradient.addColorStop(0.55, '#101820');
    gradient.addColorStop(1, '#030407');
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);

  const glow = (x, y, rx, ry, color) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rx, y - ry, rx * 2, ry * 2);
  };

  if (theme === 'light') {
    glow(w * 0.24, h * 0.18, w * 0.24, h * 0.2, 'rgba(255,255,255,0.95)');
    glow(w * 0.76, h * 0.3, w * 0.18, h * 0.16, 'rgba(255,246,232,0.8)');
    glow(w * 0.52, h * 0.58, w * 0.3, h * 0.12, 'rgba(255,255,255,0.35)');
    ctx.fillStyle = 'rgba(70,88,100,0.35)';
    ctx.fillRect(0, h * 0.74, w, h * 0.26);
  } else {
    glow(w * 0.2, h * 0.2, w * 0.18, h * 0.22, 'rgba(196,224,245,0.95)');
    glow(w * 0.6, h * 0.25, w * 0.12, h * 0.16, 'rgba(54,217,255,0.55)');
    glow(w * 0.85, h * 0.46, w * 0.16, h * 0.2, 'rgba(255,122,26,0.55)');
    glow(w * 0.45, h * 0.5, w * 0.05, h * 0.08, 'rgba(255,255,255,0.65)');
    ctx.fillStyle = 'rgba(2,5,8,0.8)';
    ctx.fillRect(0, h * 0.7, w, h * 0.3);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const target = pmrem.fromEquirectangular(texture);
  texture.dispose();
  pmrem.dispose();
  return target.texture;
}

/* --------------------------------------------------------------------------
   5. 材质与几何辅助
   -------------------------------------------------------------------------- */

function partMaterial(part, options = {}) {
  const base = {
    color: options.color !== undefined ? options.color : 0x5a6068,
    metalness: options.metalness !== undefined ? options.metalness : 0.84,
    roughness: options.roughness !== undefined ? options.roughness : 0.44,
    map: options.map || null,
    emissive: options.emissive !== undefined ? options.emissive : 0x000000,
    emissiveIntensity: options.emissiveIntensity !== undefined ? options.emissiveIntensity : 0,
    side: options.side || THREE.FrontSide,
    transparent: options.transparent || false,
    opacity: options.opacity !== undefined ? options.opacity : 1,
    depthWrite: options.depthWrite !== undefined ? options.depthWrite : true,
    envMapIntensity: options.envMapIntensity !== undefined ? options.envMapIntensity : 0.9,
    flatShading: options.flatShading || false,
  };
  const mat = new THREE.MeshStandardMaterial(base);
  mat.userData.isPartMaterial = true;
  mat.userData.base = {
    color: base.color,
    metalness: base.metalness,
    roughness: base.roughness,
    map: base.map,
    emissive: base.emissive,
    emissiveIntensity: base.emissiveIntensity,
    envMapIntensity: base.envMapIntensity,
  };
  mat.userData.baseOpacity = base.opacity;
  mat.userData.baseTransparent = base.transparent;
  mat.userData.baseDepthWrite = base.depthWrite;
  mat.userData.glow = Boolean(options.glow);
  mat.userData.glowMax = options.glowMax !== undefined ? options.glowMax : 1;
  mat.userData.glowColor = options.glowColor !== undefined ? options.glowColor : CYAN;
  part.materials.push(mat);
  return mat;
}

function accentMaterial(part, options = {}) {
  const mat = new THREE.MeshBasicMaterial({
    color: options.color !== undefined ? options.color : CYAN,
    transparent: true,
    opacity: options.opacity !== undefined ? options.opacity : 0.8,
    depthWrite: options.depthWrite !== undefined ? options.depthWrite : false,
    blending: options.blending || THREE.NormalBlending,
    side: options.side || THREE.FrontSide,
    fog: options.fog !== undefined ? options.fog : false,
  });
  mat.userData.isAccentMaterial = true;
  mat.userData.baseOpacity = mat.opacity;
  part.materials.push(mat);
  return mat;
}

function ignitionEffectMaterial(color, maxOpacity) {
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  mat.userData.ignitionMax = maxOpacity;
  return mat;
}

function addMesh(part, geometry, material, options = {}) {
  const mesh = new THREE.Mesh(geometry, material);
  if (options.position) mesh.position.set(options.position[0], options.position[1], options.position[2]);
  if (options.rotation) mesh.rotation.set(options.rotation[0], options.rotation[1], options.rotation[2]);
  if (options.scale) mesh.scale.set(options.scale[0], options.scale[1], options.scale[2]);
  if (options.name) mesh.name = options.name;
  return registerMesh(part, mesh, part.root);
}

function registerMesh(part, mesh, parent) {
  mesh.userData.partId = part.id;
  parent.add(mesh);
  part.pickMeshes.push(mesh);
  return mesh;
}

function addInstances(part, geometry, material, count, fill, options = {}) {
  if (count <= 0) return null;
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  let tinted = false;
  for (let i = 0; i < count; i += 1) {
    _dummy.position.set(0, 0, 0);
    _dummy.quaternion.identity();
    _dummy.scale.set(1, 1, 1);
    fill(i, _dummy, _color);
    _dummy.updateMatrix();
    mesh.setMatrixAt(i, _dummy.matrix);
    if (options.tint) {
      options.tint(i, _color);
      mesh.setColorAt(i, _color);
      tinted = true;
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (tinted && mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
    // 构建时留一份原始实例色，供深色主题精确还原（避免来回切换漂移）
    mesh.userData.baseInstanceColor = mesh.instanceColor.array.slice();
  }
  mesh.frustumCulled = false;
  mesh.userData.partId = part.id;
  if (options.name) mesh.name = options.name;
  part.root.add(mesh);
  part.pickMeshes.push(mesh);
  return mesh;
}

function makeBeamInstances(part, beams, material, options = {}) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const mesh = addInstances(part, geometry, material, beams.length, (i, dummy) => {
    const beam = beams[i];
    const ax = beam.a[0];
    const ay = beam.a[1];
    const az = beam.a[2];
    const bx = beam.b[0];
    const by = beam.b[1];
    const bz = beam.b[2];
    _v1.set(bx - ax, by - ay, bz - az);
    const length = _v1.length() || 1;
    dummy.position.set((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5);
    dummy.quaternion.setFromUnitVectors(Y_AXIS, _v1.normalize());
    dummy.scale.set(beam.w, length, beam.d !== undefined ? beam.d : beam.w);
  }, { name: options.name });
  return mesh;
}

function addCylinderBetween(part, ax, ay, az, bx, by, bz, radius, material, radialSegments = 12) {
  _v1.set(bx - ax, by - ay, bz - az);
  const length = _v1.length() || 1;
  const geometry = new THREE.CylinderGeometry(radius, radius, length, radialSegments, 1, false);
  const mesh = addMesh(part, geometry, material, {
    position: [(ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5],
  });
  mesh.quaternion.setFromUnitVectors(Y_AXIS, _v1.normalize());
  return mesh;
}

function addCasingBand(part, index, radius, centerY, height, material, thicknessOffset) {
  const cut = isCutBand(index);
  const phiStart = cut ? CUT_ANGLE + CUT_HALF : 0;
  const phiLength = cut ? TAU - CUT_HALF * 2 : TAU;
  const r = radius + (thicknessOffset || 0);
  const geometry = new THREE.CylinderGeometry(r, r, height, 120, 1, true, phiStart, phiLength);
  return addMesh(part, geometry, material, { position: [0, centerY, 0] });
}

/* --------------------------------------------------------------------------
   6. 零件建造 —— 基座环 / 锚固螺栓
   -------------------------------------------------------------------------- */

function buildBaseRing(part) {
  const concrete = partMaterial(part, {
    color: 0x3f4247,
    metalness: 0.6,
    roughness: 0.8,
    envMapIntensity: 0.55,
  });
  const steel = partMaterial(part, {
    color: 0x626a73,
    metalness: 0.9,
    roughness: 0.38,
    map: textures.metal,
  });
  const darkSteel = partMaterial(part, {
    color: 0x3b4148,
    metalness: 0.88,
    roughness: 0.5,
  });
  const hazard = partMaterial(part, {
    color: 0xffffff,
    metalness: 0.6,
    roughness: 0.66,
    map: textures.hazard,
    side: THREE.DoubleSide,
  });

  const shape = new THREE.Shape();
  shape.absarc(0, 0, 5000, 0, TAU, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, 4300, 0, TAU, true);
  shape.holes.push(hole);
  const ringGeometry = new THREE.ExtrudeGeometry(shape, {
    depth: 400,
    bevelEnabled: false,
    curveSegments: 96,
  });
  ringGeometry.rotateX(-Math.PI / 2);
  addMesh(part, ringGeometry, concrete, { name: 'base-ring-slab' });

  const topDeck = new THREE.RingGeometry(4300, 5000, 96, 1);
  topDeck.rotateX(-Math.PI / 2);
  addMesh(part, topDeck, steel, { position: [0, 402, 0] });

  const innerLip = new THREE.CylinderGeometry(4310, 4310, 130, 96, 1, true);
  addMesh(part, innerLip, darkSteel, { position: [0, 330, 0] });

  const warningBand = new THREE.CylinderGeometry(5014, 5014, 110, 96, 1, true);
  addMesh(part, warningBand, hazard, { position: [0, 292, 0] });

  const ribGeometry = new THREE.BoxGeometry(760, 400, 150);
  addInstances(part, ribGeometry, steel, 24, (i, dummy) => {
    const angle = (i / 24) * TAU;
    dummy.position.set(Math.cos(angle) * 5110, 215, Math.sin(angle) * 5110);
    dummy.rotation.y = -angle;
  }, { name: 'base-ring-ribs-24' });

  const lugGeometry = new THREE.BoxGeometry(120, 300, 120);
  addInstances(part, lugGeometry, darkSteel, 8, (i, dummy) => {
    const angle = (i / 8) * TAU + TAU / 16;
    dummy.position.set(Math.cos(angle) * 5160, 560, Math.sin(angle) * 5160);
    dummy.rotation.y = -angle;
  }, { name: 'base-ring-lifting-lugs' });

  const anchorPlateGeometry = new THREE.BoxGeometry(520, 60, 340);
  addInstances(part, anchorPlateGeometry, steel, 24, (i, dummy) => {
    const angle = (i / 24) * TAU + TAU / 48;
    dummy.position.set(Math.cos(angle) * 4630, 435, Math.sin(angle) * 4630);
    dummy.rotation.y = -angle;
  }, { name: 'base-ring-anchor-plates' });
}

function buildBolts(part) {
  const boltMaterial = partMaterial(part, {
    color: 0x7a828b,
    metalness: 0.96,
    roughness: 0.3,
    map: textures.metal,
  });
  const geometry = new THREE.CylinderGeometry(54, 62, 66, 6, 1, false);
  geometry.rotateY(Math.PI / 6);
  const perRing = 4096;
  const total = 8192;
  const rng = makeRng(0x8192a1);

  const mesh = addInstances(part, geometry, boltMaterial, total, (i, dummy) => {
    const ring = Math.floor(i / perRing);
    const index = i % perRing;
    const radius = ring === 0 ? 4470 : 4800;
    const angle = (index / perRing) * TAU + (rng() - 0.5) * (TAU / perRing) * 0.6;
    const jitter = (rng() - 0.5) * 10;
    dummy.position.set(Math.cos(angle) * (radius + jitter), 438, Math.sin(angle) * (radius + jitter));
    dummy.rotation.y = angle + rng() * 0.4;
    const scale = 0.86 + rng() * 0.28;
    dummy.scale.set(scale, 0.9 + rng() * 0.25, scale);
  }, {
    name: 'anchor-bolts-8192',
    tint: (i, color) => {
      const light = 0.32 + rng() * 0.2;
      color.setRGB(light, light * 1.02, light * 1.07);
    },
  });
  mesh.userData.boltCount = total;
}

/* --------------------------------------------------------------------------
   7. 零件建造 —— 桁架塔
   -------------------------------------------------------------------------- */

function buildTrussTower(part) {
  const steel = partMaterial(part, {
    color: 0x5c646d,
    metalness: 0.78,
    roughness: 0.48,
    map: textures.metal,
  });
  const steelLight = partMaterial(part, {
    color: 0x737b84,
    metalness: 0.86,
    roughness: 0.36,
  });
  const darkSteel = partMaterial(part, {
    color: 0x343a41,
    metalness: 0.8,
    roughness: 0.56,
  });
  const orange = partMaterial(part, {
    color: ORANGE_DARK,
    metalness: 0.6,
    roughness: 0.6,
  });

  const groupCount = 12;
  const towerRadius = 5750;
  const postHalfAngle = 4.2 * DEG;
  const postHeight = 2600;
  const footY = 180;
  const topY = footY + postHeight;
  const posts = [];
  const braces = [];
  const ladders = [];
  const pads = [];

  for (let g = 0; g < groupCount; g += 1) {
    const angle = (g / groupCount) * TAU;
    const a1 = angle - postHalfAngle;
    const a2 = angle + postHalfAngle;
    const p1 = [Math.cos(a1) * towerRadius, footY, Math.sin(a1) * towerRadius];
    const p2 = [Math.cos(a2) * towerRadius, footY, Math.sin(a2) * towerRadius];
    const t1 = [Math.cos(a1) * towerRadius, topY, Math.sin(a1) * towerRadius];
    const t2 = [Math.cos(a2) * towerRadius, topY, Math.sin(a2) * towerRadius];

    posts.push({ a: p1, b: t1, w: 170, d: 170 });
    posts.push({ a: p2, b: t2, w: 170, d: 170 });

    pads.push({ angle, x1: p1[0], z1: p1[2], x2: p2[0], z2: p2[2] });

    const levels = 4;
    for (let s = 0; s < levels; s += 1) {
      const y0 = footY + (s / levels) * postHeight;
      const y1 = footY + ((s + 1) / levels) * postHeight;
      const a1y0 = [Math.cos(a1) * towerRadius, y0, Math.sin(a1) * towerRadius];
      const a2y0 = [Math.cos(a2) * towerRadius, y0, Math.sin(a2) * towerRadius];
      const a1y1 = [Math.cos(a1) * towerRadius, y1, Math.sin(a1) * towerRadius];
      const a2y1 = [Math.cos(a2) * towerRadius, y1, Math.sin(a2) * towerRadius];
      braces.push({ a: a1y0, b: a2y1, w: 72 });
      braces.push({ a: a2y0, b: a1y1, w: 72 });
      braces.push({ a: a1y0, b: a2y0, w: 88 });
    }
    braces.push({ a: t1, b: t2, w: 92 });

    // 与机体连接的径向斜撑
    const midY = 900;
    braces.push({
      a: [Math.cos(a1) * (towerRadius - 40), midY, Math.sin(a1) * (towerRadius - 40)],
      b: [Math.cos(angle) * 5060, 360, Math.sin(angle) * 5060],
      w: 100,
    });
    braces.push({
      a: [Math.cos(a2) * (towerRadius - 40), midY, Math.sin(a2) * (towerRadius - 40)],
      b: [Math.cos(angle) * 5120, 390, Math.sin(angle) * 5120],
      w: 100,
    });

    // 顶部与壳体连接的短撑
    braces.push({
      a: [Math.cos(a1) * towerRadius, topY, Math.sin(a1) * towerRadius],
      b: [Math.cos(a1) * 5270, 2950, Math.sin(a1) * 5270],
      w: 110,
    });
    braces.push({
      a: [Math.cos(a2) * towerRadius, topY, Math.sin(a2) * towerRadius],
      b: [Math.cos(a2) * 5270, 2950, Math.sin(a2) * 5270],
      w: 110,
    });

    // 每隔一组设置检修梯
    if (g % 2 === 0) {
      const ladderAngle = angle + 0.5 * DEG;
      const r = towerRadius + 135;
      const tw = 0.0018;
      const rail1 = [Math.cos(ladderAngle - tw) * r, 260, Math.sin(ladderAngle - tw) * r];
      const rail2 = [Math.cos(ladderAngle + tw) * r, 260, Math.sin(ladderAngle + tw) * r];
      ladders.push({ a: rail1, b: [rail1[0], 2680, rail1[2]], w: 34 });
      ladders.push({ a: rail2, b: [rail2[0], 2680, rail2[2]], w: 34 });
      for (let s = 0; s < 10; s += 1) {
        const y = 360 + s * 230;
        ladders.push({
          a: [rail1[0], y, rail1[2]],
          b: [rail2[0], y, rail2[2]],
          w: 22,
        });
      }
    }
  }

  makeBeamInstances(part, posts, steel, { name: 'truss-posts-24' });
  makeBeamInstances(part, braces, darkSteel, { name: 'truss-braces' });
  makeBeamInstances(part, ladders, steelLight, { name: 'truss-ladders' });

  const padGeometry = new THREE.BoxGeometry(620, 180, 620);
  addInstances(part, padGeometry, steel, groupCount * 2, (i, dummy) => {
    const pad = pads[Math.floor(i / 2)];
    const isSecond = i % 2 === 1;
    dummy.position.set(isSecond ? pad.x2 : pad.x1, 90, isSecond ? pad.z2 : pad.z1);
    dummy.rotation.y = -pad.angle;
  }, { name: 'truss-footings-24' });

  const capGeometry = new THREE.BoxGeometry(250, 110, 250);
  addInstances(part, capGeometry, orange, groupCount * 2, (i, dummy) => {
    const g = Math.floor(i / 2);
    const angle = (g / groupCount) * TAU + (i % 2 === 0 ? -postHalfAngle : postHalfAngle);
    dummy.position.set(Math.cos(angle) * towerRadius, topY + 55, Math.sin(angle) * towerRadius);
    dummy.rotation.y = -angle;
  }, { name: 'truss-top-caps' });

  const hoops = [800, 1780, 2720];
  hoops.forEach((y) => {
    const geometry = new THREE.TorusGeometry(towerRadius, 34, 6, 144);
    geometry.rotateX(Math.PI / 2);
    addMesh(part, geometry, steelLight, { position: [0, y, 0], name: `truss-hoop-${y}` });
  });
}

/* --------------------------------------------------------------------------
   8. 零件建造 —— 主反应堆
   -------------------------------------------------------------------------- */

function buildReactorCore(part) {
  const metal = partMaterial(part, {
    color: 0x4d565f,
    metalness: 0.9,
    roughness: 0.4,
    map: textures.metal,
  });
  const flangeMat = partMaterial(part, {
    color: 0x6b737c,
    metalness: 0.92,
    roughness: 0.34,
    map: textures.metal,
  });
  const darkMetal = partMaterial(part, {
    color: 0x2e353c,
    metalness: 0.86,
    roughness: 0.5,
  });
  const orange = partMaterial(part, {
    color: ORANGE_DARK,
    metalness: 0.6,
    roughness: 0.62,
    emissive: 0x2a0d02,
    emissiveIntensity: 0.25,
  });
  const coilMat = partMaterial(part, {
    color: 0x1f4c56,
    metalness: 0.78,
    roughness: 0.32,
    glow: true,
    glowMax: 2.1,
    glowColor: CYAN,
    emissive: CYAN,
    emissiveIntensity: 0,
  });
  const stripMat = partMaterial(part, {
    color: 0x123039,
    metalness: 0.6,
    roughness: 0.4,
    glow: true,
    glowMax: 1.7,
    glowColor: CYAN,
    emissive: CYAN,
    emissiveIntensity: 0,
  });

  const core = new THREE.CylinderGeometry(1050, 1050, 1200, 72, 1, false);
  addMesh(part, core, metal, { position: [0, 5100, 0], name: 'reactor-barrel' });

  const ribGeometry = new THREE.BoxGeometry(150, 1160, 70);
  addInstances(part, ribGeometry, darkMetal, 24, (i, dummy) => {
    const angle = (i / 24) * TAU;
    dummy.position.set(Math.cos(angle) * 1075, 5100, Math.sin(angle) * 1075);
    dummy.rotation.y = -angle;
  }, { name: 'reactor-vertical-ribs' });

  [4575, 5625].forEach((y) => {
    const flange = new THREE.CylinderGeometry(1420, 1420, 150, 72, 1, false);
    addMesh(part, flange, flangeMat, { position: [0, y, 0] });
    const rim = new THREE.TorusGeometry(1440, 58, 10, 72);
    rim.rotateX(Math.PI / 2);
    addMesh(part, rim, darkMetal, { position: [0, y, 0] });
    const stripe = new THREE.CylinderGeometry(1434, 1434, 34, 72, 1, true);
    addMesh(part, stripe, orange, { position: [0, y + 58, 0] });
  });

  const boltGeometry = new THREE.CylinderGeometry(28, 32, 42, 6);
  addInstances(part, boltGeometry, flangeMat, 72, (i, dummy) => {
    const ring = Math.floor(i / 36);
    const idx = i % 36;
    const angle = (idx / 36) * TAU;
    const radius = 1310;
    dummy.position.set(Math.cos(angle) * radius, ring === 0 ? 4656 : 5544, Math.sin(angle) * radius);
    dummy.rotation.y = angle;
  }, { name: 'reactor-flange-bolts' });

  const coilGeometry = new THREE.TorusGeometry(1160, 54, 10, 80);
  coilGeometry.rotateX(Math.PI / 2);
  addInstances(part, coilGeometry, coilMat, 12, (i, dummy) => {
    dummy.position.set(0, 4690 + i * 74.8, 0);
  }, { name: 'reactor-coils-12' });

  const stripGeometry = new THREE.BoxGeometry(16, 720, 26);
  addInstances(part, stripGeometry, stripMat, 18, (i, dummy) => {
    const angle = (i / 18) * TAU;
    dummy.position.set(Math.cos(angle) * 1086, 5100, Math.sin(angle) * 1086);
    dummy.rotation.y = -angle;
  }, { name: 'reactor-energy-strips' });

  const capTop = new THREE.CylinderGeometry(1120, 1040, 110, 48, 1, false);
  addMesh(part, capTop, darkMetal, { position: [0, 5755, 0] });
  const capBottom = new THREE.CylinderGeometry(1040, 1220, 110, 48, 1, false);
  addMesh(part, capBottom, darkMetal, { position: [0, 4445, 0] });

  // 顶部能量环与俯视可见的核心辉光
  const crownGlow = new THREE.TorusGeometry(1030, 76, 10, 64);
  crownGlow.rotateX(Math.PI / 2);
  addMesh(part, crownGlow, coilMat, { position: [0, 5818, 0] });

  const topDiscMat = ignitionEffectMaterial(CYAN, 0.85);
  const topDisc = new THREE.CircleGeometry(1000, 48);
  topDisc.rotateX(-Math.PI / 2);
  addMesh(part, topDisc, topDiscMat, { position: [0, 5826, 0] });
  part.ignitionEffects.push({ material: topDiscMat, max: 0.85 });

  const bloomMat = new THREE.SpriteMaterial({
    map: textures.glow,
    color: CYAN,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
  const bloom = new THREE.Sprite(bloomMat);
  bloom.position.set(0, 5150, 0);
  bloom.scale.set(5200, 5200, 1);
  part.root.add(bloom);
  part.ignitionEffects.push({ material: bloomMat, max: 0.55 });
}

/* --------------------------------------------------------------------------
   9. 零件建造 —— 燃料管路
   -------------------------------------------------------------------------- */

const PIPE_COUNT = 48;
const PIPE_YS = [3560, 4900, 6240, 7580, 8920, 9460];
const PIPE_TOP_ELBOW_Y = 9460;
const PIPE_BOTTOM_ELBOW_Y = 3560;
const ELBOW_RADIUS = 180;

function pipeRadiusAt(y) {
  return casingRadius(y) + 250;
}

function buildPipeSet(part, indices, material, suffix) {
  const slotsPerPipe = PIPE_YS.length - 1 + 2;
  const segmentCount = indices.length * slotsPerPipe;
  const segGeometry = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
  addInstances(part, segGeometry, material, segmentCount, (k, dummy) => {
    const pipeIndex = indices[Math.floor(k / slotsPerPipe)];
    const slot = k % slotsPerPipe;
    const angle = (pipeIndex / PIPE_COUNT) * TAU;
    if (slot < PIPE_YS.length - 1) {
      const y0 = PIPE_YS[slot];
      const y1 = PIPE_YS[slot + 1];
      const r0 = pipeRadiusAt(y0);
      const r1 = pipeRadiusAt(y1);
      const ax = Math.cos(angle) * r0;
      const az = Math.sin(angle) * r0;
      const bx = Math.cos(angle) * r1;
      const bz = Math.sin(angle) * r1;
      _v1.set(bx - ax, y1 - y0, bz - az);
      const length = _v1.length();
      dummy.position.set((ax + bx) * 0.5, (y0 + y1) * 0.5, (az + bz) * 0.5);
      dummy.quaternion.setFromUnitVectors(Y_AXIS, _v1.normalize());
      dummy.scale.set(48, length, 48);
    } else if (slot === PIPE_YS.length - 1) {
      // 底部弯头前的短直段
      const y = 3380;
      const outer = pipeRadiusAt(PIPE_BOTTOM_ELBOW_Y) - ELBOW_RADIUS;
      const inner = casingRadius(y) + 35;
      const mid = (outer + inner) * 0.5;
      _v1.set(1, 0, 0);
      dummy.position.set(Math.cos(angle) * mid, y, Math.sin(angle) * mid);
      dummy.rotation.set(0, -angle, Math.PI / 2);
      dummy.quaternion.setFromAxisAngle(Z_AXIS, Math.PI / 2);
      _q1.setFromAxisAngle(Y_AXIS, -angle);
      dummy.quaternion.premultiply(_q1);
      dummy.scale.set(48, Math.abs(outer - inner), 48);
    } else {
      // 顶部弯头前的短直段
      const y = 9640;
      const outer = pipeRadiusAt(PIPE_TOP_ELBOW_Y) - ELBOW_RADIUS;
      const inner = casingRadius(y) + 35;
      const mid = (outer + inner) * 0.5;
      dummy.position.set(Math.cos(angle) * mid, y, Math.sin(angle) * mid);
      dummy.quaternion.setFromAxisAngle(Z_AXIS, Math.PI / 2);
      _q1.setFromAxisAngle(Y_AXIS, -angle);
      dummy.quaternion.premultiply(_q1);
      dummy.scale.set(48, Math.abs(outer - inner), 48);
    }
  }, { name: `fuel-pipes-segments-${suffix}` });

  const flangeCount = indices.length * (PIPE_YS.length + 2);
  const flangeGeometry = new THREE.CylinderGeometry(1, 1, 1, 18, 1, false);
  addInstances(part, flangeGeometry, material, flangeCount, (k, dummy) => {
    const perPipe = PIPE_YS.length + 2;
    const pipeIndex = indices[Math.floor(k / perPipe)];
    const slot = k % perPipe;
    const angle = (pipeIndex / PIPE_COUNT) * TAU;
    let y;
    if (slot === 0) {
      y = 3380;
    } else if (slot === PIPE_YS.length + 1) {
      y = 9640;
    } else {
      y = PIPE_YS[slot - 1];
    }
    const r = pipeRadiusAt(y);
    dummy.position.set(Math.cos(angle) * r, y, Math.sin(angle) * r);
    dummy.quaternion.setFromAxisAngle(Y_AXIS, -angle);
    dummy.scale.set(92, 68, 92);
  }, { name: `fuel-pipes-flanges-${suffix}` });

  const elbowGeometry = new THREE.TorusGeometry(1, 0.34, 8, 20, Math.PI / 2);
  addInstances(part, elbowGeometry, material, indices.length * 2, (k, dummy) => {
    const pipeIndex = indices[Math.floor(k / 2)];
    const isTop = k % 2 === 1;
    const angle = (pipeIndex / PIPE_COUNT) * TAU;
    if (isTop) {
      const r = pipeRadiusAt(PIPE_TOP_ELBOW_Y) - ELBOW_RADIUS;
      dummy.position.set(Math.cos(angle) * r, PIPE_TOP_ELBOW_Y, Math.sin(angle) * r);
      dummy.quaternion.setFromAxisAngle(Y_AXIS, -angle);
    } else {
      const r = pipeRadiusAt(PIPE_BOTTOM_ELBOW_Y) - ELBOW_RADIUS;
      dummy.position.set(Math.cos(angle) * r, PIPE_BOTTOM_ELBOW_Y, Math.sin(angle) * r);
      dummy.quaternion.setFromAxisAngle(Y_AXIS, -angle);
      _q1.setFromAxisAngle(Z_AXIS, -Math.PI / 2);
      dummy.quaternion.multiply(_q1);
    }
    dummy.scale.set(ELBOW_RADIUS, ELBOW_RADIUS, ELBOW_RADIUS);
  }, { name: `fuel-pipes-elbows-${suffix}` });

  const bracketGeometry = new THREE.BoxGeometry(250, 48, 90);
  addInstances(part, bracketGeometry, material, indices.length * 4, (k, dummy) => {
    const pipeIndex = indices[Math.floor(k / 4)];
    const slot = k % 4;
    const angle = (pipeIndex / PIPE_COUNT) * TAU;
    const y = 4100 + slot * 1400;
    const casingR = casingRadius(y);
    const r = casingR + 125;
    dummy.position.set(Math.cos(angle) * r, y, Math.sin(angle) * r);
    dummy.rotation.y = -angle;
  }, { name: `fuel-pipes-brackets-${suffix}` });
}

function buildFuelPipes(part) {
  const steel = partMaterial(part, {
    color: 0x626b74,
    metalness: 0.8,
    roughness: 0.44,
    map: textures.metal,
  });
  const orange = partMaterial(part, {
    color: 0x91430f,
    metalness: 0.6,
    roughness: 0.52,
    map: textures.metal,
  });

  const grey = [];
  const warm = [];
  for (let i = 0; i < PIPE_COUNT; i += 1) {
    if (i % 6 === 0) warm.push(i);
    else grey.push(i);
  }
  buildPipeSet(part, grey, steel, 'steel');
  buildPipeSet(part, warm, orange, 'warning');
}

/* --------------------------------------------------------------------------
   10. 零件建造 —— 机体外壳
   -------------------------------------------------------------------------- */

function buildCasing(part) {
  const shellMat = partMaterial(part, {
    color: 0x5a636d,
    metalness: 0.7,
    roughness: 0.54,
    map: textures.metal,
    side: THREE.DoubleSide,
  });
  const trimMat = partMaterial(part, {
    color: 0x7c858e,
    metalness: 0.82,
    roughness: 0.4,
    map: textures.metal,
  });
  const darkMat = partMaterial(part, {
    color: 0x2c3238,
    metalness: 0.8,
    roughness: 0.55,
  });
  const orange = partMaterial(part, {
    color: ORANGE_DARK,
    metalness: 0.6,
    roughness: 0.58,
    emissive: 0x1c0801,
    emissiveIntensity: 0.18,
  });
  const hazard = partMaterial(part, {
    color: 0xffffff,
    metalness: 0.6,
    roughness: 0.66,
    map: textures.hazard,
    side: THREE.DoubleSide,
  });
  const beacon = accentMaterial(part, { color: CYAN, opacity: 0.9 });
  const innerGlow = partMaterial(part, {
    color: 0x15323a,
    metalness: 0.6,
    roughness: 0.42,
    emissive: CYAN,
    emissiveIntensity: 0.22,
  });

  for (let band = 0; band < BAND_COUNT; band += 1) {
    const [y0, y1] = casingBandRange(band);
    const r0 = casingRadius(y0);
    const r1 = casingRadius(y1);
    const cut = isCutBand(band);
    const phiStart = cut ? CUT_ANGLE + CUT_HALF : 0;
    const phiLength = cut ? TAU - CUT_HALF * 2 : TAU;
    const profile = [
      new THREE.Vector2(r0 + 70, 0),
      new THREE.Vector2(r0, 45),
      new THREE.Vector2(r0 + (r1 - r0) * 0.5 + 18, BAND_H * 0.5),
      new THREE.Vector2(r1, BAND_H - 45),
      new THREE.Vector2(r1 - 70, BAND_H),
    ];
    const geometry = new THREE.LatheGeometry(profile, 120, phiStart, phiLength);
    addMesh(part, geometry, shellMat, {
      position: [0, y0, 0],
      name: `casing-band-${band + 1}`,
    });

    // 每段上下两条环向加强肋
    addCasingBand(part, band, casingRadius(y0), y0 + 55, 110, trimMat, 62);
    addCasingBand(part, band, casingRadius(y1), y1 - 55, 110, trimMat, 62);

    // 段内的检修面板 / 灯带
    if (band === 0 || band === 4) {
      addCasingBand(part, band, casingRadius(y0 + 520), y0 + 520, 26, innerGlow, 68);
    }
  }

  // 切面边框与警示块
  [CUT_ANGLE - CUT_HALF, CUT_ANGLE + CUT_HALF].forEach((angle) => {
    const cutTop = casingBandRange(CUT_BANDS[CUT_BANDS.length - 1])[1];
    const cutBottom = casingBandRange(CUT_BANDS[0])[0];
    const midY = (cutTop + cutBottom) * 0.5;
    const height = cutTop - cutBottom;
    const radius = casingRadius(midY) + 105;
    const frame = new THREE.BoxGeometry(300, height + 30, 260);
    addMesh(part, frame, trimMat, {
      position: [Math.cos(angle) * radius, midY, Math.sin(angle) * radius],
      rotation: [0, -angle, 0],
    });
    for (let w = 0; w < 3; w += 1) {
      const plate = new THREE.BoxGeometry(42, 520, 118);
      const py = cutBottom + height * (0.2 + w * 0.3);
      addMesh(part, plate, w === 1 ? hazard : orange, {
        position: [Math.cos(angle) * (radius + 172), py, Math.sin(angle) * (radius + 172)],
        rotation: [0, -angle, 0],
      });
    }
  });

  // 环向分段肋骨（切窗部分随段一起留空）
  for (let band = 0; band < BAND_COUNT; band += 1) {
    const [y0, y1] = casingBandRange(band);
    const cut = isCutBand(band);
    const thetaStart = cut ? CUT_ANGLE + CUT_HALF : 0;
    const thetaLength = cut ? TAU - CUT_HALF * 2 : TAU;
    [y0 + 20, y1 - 20].forEach((y) => {
      const r = casingRadius(y) + 88;
      const geometry = new THREE.CylinderGeometry(r, r, 70, 120, 1, true, thetaStart, thetaLength);
      addMesh(part, geometry, darkMat, { position: [0, y, 0] });
    });
  }

  // 竖向加劲肋：切窗角度内跳过
  const ribs = [];
  for (let i = 0; i < 24; i += 1) {
    const angle = (i / 24) * TAU;
    if (angleInCutWindow(angle)) continue;
    const bottomR = casingRadius(CASING_Y0) + 92;
    const topR = casingRadius(CASING_Y1) + 92;
    ribs.push({
      a: [Math.cos(angle) * bottomR, CASING_Y0 + 60, Math.sin(angle) * bottomR],
      b: [Math.cos(angle) * topR, CASING_Y1 - 60, Math.sin(angle) * topR],
      w: 130,
      d: 150,
    });
  }
  makeBeamInstances(part, ribs, trimMat, { name: 'casing-vertical-ribs' });

  // 外壳上的分段铆钉
  const rivetGeometry = new THREE.CylinderGeometry(24, 28, 34, 6);
  const rivetRows = [3180, 7200, 9000, 10700];
  addInstances(part, rivetGeometry, trimMat, rivetRows.length * 72, (i, dummy) => {
    const row = Math.floor(i / 72);
    const idx = i % 72;
    const y = rivetRows[row];
    const angle = (idx / 72) * TAU + row * 0.02;
    const r = casingRadius(y) + 104;
    dummy.position.set(Math.cos(angle) * r, y, Math.sin(angle) * r);
    dummy.rotation.y = angle;
  }, { name: 'casing-rivets' });

  // 底部 / 中部 / 顶部警示带（均位于未切开的完整分段）
  [3210, 8420, 10450].forEach((y) => {
    const r = casingRadius(y) + 70;
    const geometry = new THREE.CylinderGeometry(r, r, 74, 120, 1, true, 0, TAU);
    addMesh(part, geometry, orange, { position: [0, y, 0] });
  });

  // 顶圈与机械顶盖
  const crown = new THREE.CylinderGeometry(3110, 3110, 190, 120, 1, true);
  addMesh(part, crown, trimMat, { position: [0, 10905, 0] });
  const crownTorus = new THREE.TorusGeometry(3110, 92, 10, 120);
  crownTorus.rotateX(Math.PI / 2);
  addMesh(part, crownTorus, darkMat, { position: [0, 11000, 0] });
  const topRing = new THREE.RingGeometry(2350, 3080, 120, 1);
  topRing.rotateX(-Math.PI / 2);
  addMesh(part, topRing, darkMat, { position: [0, 10996, 0] });

  const ventGeometry = new THREE.BoxGeometry(360, 150, 190);
  addInstances(part, ventGeometry, trimMat, 12, (i, dummy) => {
    const angle = (i / 12) * TAU;
    dummy.position.set(Math.cos(angle) * 2700, 11060, Math.sin(angle) * 2700);
    dummy.rotation.y = -angle;
  }, { name: 'casing-top-vents' });

  const beaconGeometry = new THREE.BoxGeometry(56, 56, 56);
  addInstances(part, beaconGeometry, beacon, 12, (i, dummy) => {
    const angle = (i / 12) * TAU + TAU / 24;
    dummy.position.set(Math.cos(angle) * 3060, 10820, Math.sin(angle) * 3060);
    dummy.rotation.y = -angle;
  }, { name: 'casing-beacons' });
}

/* --------------------------------------------------------------------------
   11. 零件建造 —— 散热鳍片
   -------------------------------------------------------------------------- */

function buildHeatSinkFins(part) {
  const finMat = partMaterial(part, {
    color: 0x454c54,
    metalness: 0.78,
    roughness: 0.52,
    map: textures.metal,
    side: THREE.DoubleSide,
  });
  const edgeMat = partMaterial(part, {
    color: 0x8a420f,
    metalness: 0.6,
    roughness: 0.55,
  });
  const hoopMat = partMaterial(part, {
    color: 0x6e767f,
    metalness: 0.9,
    roughness: 0.34,
  });

  const yCenter = 7800;
  const height = 1600;
  const innerR = 3770;
  const depth = 700;
  const finGeometry = new THREE.BoxGeometry(depth, height, 42);
  addInstances(part, finGeometry, finMat, 64, (i, dummy) => {
    const angle = (i / 64) * TAU;
    dummy.position.set(Math.cos(angle) * (innerR + depth * 0.5), yCenter, Math.sin(angle) * (innerR + depth * 0.5));
    dummy.rotation.y = -angle;
  }, {
    name: 'heat-sink-fins-64',
    tint: (i, color) => {
      const shade = 0.7 + ((i * 37) % 11) / 55;
      color.setRGB(shade, shade, shade);
    },
  });

  const tipGeometry = new THREE.BoxGeometry(22, height, 82);
  addInstances(part, tipGeometry, edgeMat, 64, (i, dummy) => {
    const angle = (i / 64) * TAU;
    const r = innerR + depth - 5;
    dummy.position.set(Math.cos(angle) * r, yCenter, Math.sin(angle) * r);
    dummy.rotation.y = -angle;
  }, { name: 'heat-sink-tips' });

  [7300, 7800, 8300].forEach((y) => {
    const geometry = new THREE.TorusGeometry(innerR + depth - 12, 24, 6, 128);
    geometry.rotateX(Math.PI / 2);
    addMesh(part, geometry, hoopMat, { position: [0, y, 0] });
  });

  const braceGeometry = new THREE.BoxGeometry(130, 120, 120);
  addInstances(part, braceGeometry, hoopMat, 16, (i, dummy) => {
    const angle = (i / 16) * TAU + TAU / 32;
    dummy.position.set(Math.cos(angle) * (innerR - 40), 7800, Math.sin(angle) * (innerR - 40));
    dummy.rotation.y = -angle;
  }, { name: 'heat-sink-mounts' });
}

/* --------------------------------------------------------------------------
   12. 零件建造 —— 检修环廊
   -------------------------------------------------------------------------- */

function buildControlRing(part) {
  const deckMat = partMaterial(part, {
    color: 0x505860,
    metalness: 0.88,
    roughness: 0.42,
    map: textures.metal,
    side: THREE.DoubleSide,
  });
  const railMat = partMaterial(part, {
    color: 0x818a93,
    metalness: 0.92,
    roughness: 0.32,
  });
  const cabinMat = partMaterial(part, {
    color: 0x6e767e,
    metalness: 0.62,
    roughness: 0.55,
    map: textures.metal,
  });
  const darkMat = partMaterial(part, {
    color: 0x30373e,
    metalness: 0.82,
    roughness: 0.54,
  });
  const windowMat = accentMaterial(part, { color: 0xffb15a, opacity: 0.78 });

  const levels = [4660, 4940, 5220];
  const cabinsPerLevel = 800;

  levels.forEach((y, levelIndex) => {
    const deck = new THREE.RingGeometry(1500, 1800, 96, 1);
    deck.rotateX(-Math.PI / 2);
    addMesh(part, deck, deckMat, { position: [0, y, 0], name: `gallery-deck-${levelIndex + 1}` });

    [120, 225].forEach((dy) => {
      const rail = new THREE.TorusGeometry(1786, 15, 6, 96);
      rail.rotateX(Math.PI / 2);
      addMesh(part, rail, railMat, { position: [0, y + dy, 0] });
    });

    const postGeometry = new THREE.BoxGeometry(14, 235, 14);
    addInstances(part, postGeometry, railMat, 48, (i, dummy) => {
      const angle = (i / 48) * TAU;
      dummy.position.set(Math.cos(angle) * 1786, y + 117, Math.sin(angle) * 1786);
      dummy.rotation.y = -angle;
    }, { name: `gallery-rail-posts-${levelIndex}` });

    const cabinGeometry = new THREE.BoxGeometry(10, 44, 16);
    addInstances(part, cabinGeometry, cabinMat, cabinsPerLevel, (i, dummy) => {
      const angle = (i / cabinsPerLevel) * TAU;
      dummy.position.set(Math.cos(angle) * 1734, y + 50, Math.sin(angle) * 1734);
      dummy.rotation.y = -angle;
    }, {
      name: `gallery-cabins-${levelIndex}`,
      tint: (i, color) => {
        const shade = 0.62 + ((i * 29) % 17) / 60;
        color.setRGB(shade, shade * 1.02, shade * 1.05);
      },
    });

    const windowGeometry = new THREE.BoxGeometry(7, 7, 2);
    addInstances(part, windowGeometry, windowMat, cabinsPerLevel, (i, dummy) => {
      const angle = (i / cabinsPerLevel) * TAU;
      dummy.position.set(Math.cos(angle) * 1745, y + 55, Math.sin(angle) * 1745);
      dummy.rotation.y = -angle;
    }, { name: `gallery-windows-${levelIndex}` });
  });

  const columnGeometry = new THREE.BoxGeometry(80, 620, 80);
  addInstances(part, columnGeometry, darkMat, 12, (i, dummy) => {
    const angle = (i / 12) * TAU + TAU / 24;
    dummy.position.set(Math.cos(angle) * 1760, 4940, Math.sin(angle) * 1760);
    dummy.rotation.y = -angle;
  }, { name: 'gallery-support-columns' });

  const bridgeGeometry = new THREE.BoxGeometry(3200, 26, 150);
  addInstances(part, bridgeGeometry, deckMat, 12, (i, dummy) => {
    const level = Math.floor(i / 4);
    const angle = ((i % 4) / 4) * TAU;
    dummy.position.set(Math.cos(angle) * 3200, levels[level] - 20, Math.sin(angle) * 3200);
    dummy.rotation.y = -angle;
  }, { name: 'gallery-access-bridges' });
}

/* --------------------------------------------------------------------------
   13. 零件建造 —— 主喷口
   -------------------------------------------------------------------------- */

const NOZZLE_POINTS = [
  [2000, 60],
  [1980, 92],
  [1900, 185],
  [1750, 335],
  [1550, 565],
  [1330, 835],
  [1130, 1120],
  [970, 1400],
  [860, 1650],
  [790, 1900],
  [760, 2150],
  [820, 2300],
];

function nozzleRadiusAt(y) {
  for (let i = 0; i < NOZZLE_POINTS.length - 1; i += 1) {
    const a = NOZZLE_POINTS[i];
    const b = NOZZLE_POINTS[i + 1];
    if (y >= a[1] && y <= b[1]) {
      const t = (y - a[1]) / (b[1] - a[1] || 1);
      return a[0] + (b[0] - a[0]) * t;
    }
  }
  return NOZZLE_POINTS[NOZZLE_POINTS.length - 1][0];
}

function buildMainNozzle(part) {
  const metal = partMaterial(part, {
    color: 0x545b63,
    metalness: 0.9,
    roughness: 0.38,
    map: textures.metal,
    side: THREE.DoubleSide,
  });
  const darkMetal = partMaterial(part, {
    color: 0x2e343b,
    metalness: 0.86,
    roughness: 0.5,
    side: THREE.DoubleSide,
  });
  const trim = partMaterial(part, {
    color: 0x7b838c,
    metalness: 0.92,
    roughness: 0.32,
  });
  const orange = partMaterial(part, {
    color: ORANGE_DARK,
    metalness: 0.6,
    roughness: 0.55,
    emissive: 0x220a01,
    emissiveIntensity: 0.2,
  });
  const glowMat = partMaterial(part, {
    color: 0x55290e,
    metalness: 0.6,
    roughness: 0.4,
    emissive: ORANGE,
    emissiveIntensity: 0,
    glow: true,
    glowMax: 1.6,
    glowColor: ORANGE,
    side: THREE.DoubleSide,
  });

  const profile = NOZZLE_POINTS.map((p) => new THREE.Vector2(p[0], p[1]));
  const bellGeometry = new THREE.LatheGeometry(profile, 120);
  addMesh(part, bellGeometry, metal, { name: 'main-nozzle-bell' });

  const lipGeometry = new THREE.TorusGeometry(2000, 88, 12, 120);
  lipGeometry.rotateX(Math.PI / 2);
  addMesh(part, lipGeometry, trim, { position: [0, 70, 0] });

  const stiffenerY = [280, 650, 1020, 1400, 1780, 2120];
  const stiffenerGeometry = new THREE.TorusGeometry(1, 0.03, 8, 96);
  stiffenerGeometry.rotateX(Math.PI / 2);
  addInstances(part, stiffenerGeometry, trim, stiffenerY.length, (i, dummy) => {
    const radius = nozzleRadiusAt(stiffenerY[i]) + 48;
    dummy.position.set(0, stiffenerY[i], 0);
    dummy.scale.set(radius, radius, radius);
  }, { name: 'main-nozzle-stiffeners' });

  const innerY = [500, 980, 1460];
  const innerGeometry = new THREE.TorusGeometry(1, 0.05, 8, 72);
  innerGeometry.rotateX(Math.PI / 2);
  addInstances(part, innerGeometry, glowMat, innerY.length, (i, dummy) => {
    const radius = nozzleRadiusAt(innerY[i]) - 45;
    dummy.position.set(0, innerY[i], 0);
    dummy.scale.set(radius, radius, radius);
  }, { name: 'main-nozzle-contraction-rings-3' });

  const ribBeams = [];
  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * TAU;
    const y0 = 220;
    const y1 = 2240;
    const r0 = nozzleRadiusAt(y0) + 35;
    const r1 = nozzleRadiusAt(y1) + 35;
    ribBeams.push({
      a: [Math.cos(angle) * r0, y0, Math.sin(angle) * r0],
      b: [Math.cos(angle) * r1, y1, Math.sin(angle) * r1],
      w: 82,
      d: 110,
    });
  }
  makeBeamInstances(part, ribBeams, darkMetal, { name: 'main-nozzle-external-ribs' });

  // 四个液压作动筒
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * TAU + Math.PI / 4;
    const ax = Math.cos(angle) * 2200;
    const az = Math.sin(angle) * 2200;
    const bx = Math.cos(angle) * 1120;
    const bz = Math.sin(angle) * 1120;
    addCylinderBetween(part, ax, 360, az, bx, 1560, bz, 64, trim, 12);
    addCylinderBetween(part, ax * 0.98, 470, az * 0.98, bx * 1.02, 1420, bz * 1.02, 24, orange, 8);
  }

  // 喷口内壁下部发光盘
  const discMaterial = ignitionEffectMaterial(ORANGE, 0.72);
  const disc = new THREE.CircleGeometry(1900, 96);
  disc.rotateX(-Math.PI / 2);
  addMesh(part, disc, discMaterial, { position: [0, 66, 0] });
  part.ignitionEffects.push({ material: discMaterial, max: 0.72 });

  // 喉部过渡段
  const collar = new THREE.CylinderGeometry(830, 780, 520, 72, 1, true);
  addMesh(part, collar, darkMetal, { position: [0, 2555, 0] });
  const collarRing = new THREE.TorusGeometry(840, 58, 8, 72);
  collarRing.rotateX(Math.PI / 2);
  addMesh(part, collarRing, trim, { position: [0, 2805, 0] });

  // 出口唇口的橙色警示块
  const warningBlock = new THREE.BoxGeometry(90, 260, 120);
  addInstances(part, warningBlock, orange, 16, (i, dummy) => {
    const angle = (i / 16) * TAU;
    dummy.position.set(Math.cos(angle) * 1970, 190, Math.sin(angle) * 1970);
    dummy.rotation.y = -angle;
  }, { name: 'main-nozzle-warning-blocks' });
}

/* --------------------------------------------------------------------------
   14. 零件建造 —— 姿态喷口
   -------------------------------------------------------------------------- */

function buildVernierNozzle(part) {
  const metal = partMaterial(part, {
    color: 0x5d646c,
    metalness: 0.9,
    roughness: 0.36,
    map: textures.metal,
    side: THREE.DoubleSide,
  });
  const darkMetal = partMaterial(part, {
    color: 0x30363d,
    metalness: 0.84,
    roughness: 0.52,
  });
  const trim = partMaterial(part, {
    color: 0x7d858e,
    metalness: 0.92,
    roughness: 0.32,
  });
  const orange = partMaterial(part, {
    color: ORANGE_DARK,
    metalness: 0.6,
    roughness: 0.58,
  });
  const nozzleGlow = partMaterial(part, {
    color: 0x4b2410,
    metalness: 0.6,
    roughness: 0.4,
    emissive: ORANGE,
    emissiveIntensity: 0,
    glow: true,
    glowMax: 1.2,
    glowColor: ORANGE,
    side: THREE.DoubleSide,
  });

  const exitGlowMat = ignitionEffectMaterial(ORANGE, 0.8);
  part.ignitionEffects.push({ material: exitGlowMat, max: 0.8 });

  const bellProfile = [
    new THREE.Vector2(150, 0),
    new THREE.Vector2(188, -105),
    new THREE.Vector2(242, -280),
    new THREE.Vector2(300, -470),
    new THREE.Vector2(342, -610),
    new THREE.Vector2(362, -660),
  ];
  const bellGeometry = new THREE.LatheGeometry(bellProfile, 48);
  const lipGeometry = new THREE.TorusGeometry(346, 30, 8, 48);
  lipGeometry.rotateX(Math.PI / 2);
  const exitRingGeometry = new THREE.TorusGeometry(300, 28, 8, 48);
  exitRingGeometry.rotateX(Math.PI / 2);
  const exitDiscGeometry = new THREE.CircleGeometry(320, 48);
  exitDiscGeometry.rotateX(-Math.PI / 2);

  const mountGeometry = new THREE.BoxGeometry(420, 520, 500);
  const actuatorGeometry = new THREE.CylinderGeometry(28, 28, 420, 8);

  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * TAU;
    const mountRadius = 5135;
    const mx = Math.cos(angle) * mountRadius;
    const mz = Math.sin(angle) * mountRadius;

    addMesh(part, mountGeometry, darkMetal, {
      position: [mx, 470, mz],
      rotation: [0, -angle, 0],
      name: `vernier-mount-${i + 1}`,
    });

    const plate = new THREE.BoxGeometry(90, 220, 300);
    addMesh(part, plate, orange, {
      position: [Math.cos(angle) * 5350, 560, Math.sin(angle) * 5350],
      rotation: [0, -angle, 0],
    });

    const pivot = new THREE.Group();
    pivot.position.set(Math.cos(angle) * 5420, 680, Math.sin(angle) * 5420);
    pivot.rotation.y = -angle;
    const baseTilt = 18 * DEG;
    pivot.rotation.z = baseTilt;
    part.root.add(pivot);

    const bell = new THREE.Mesh(bellGeometry, metal);
    registerMesh(part, bell, pivot);

    const lip = new THREE.Mesh(lipGeometry, trim);
    lip.position.y = -650;
    registerMesh(part, lip, pivot);

    const glowRing = new THREE.Mesh(exitRingGeometry, nozzleGlow);
    glowRing.position.y = -642;
    registerMesh(part, glowRing, pivot);

    const exitDisc = new THREE.Mesh(exitDiscGeometry, exitGlowMat);
    exitDisc.position.y = -652;
    registerMesh(part, exitDisc, pivot);

    const actuator1 = new THREE.Mesh(actuatorGeometry, trim);
    actuator1.position.set(150, -210, 170);
    actuator1.rotation.z = 0.4;
    registerMesh(part, actuator1, pivot);

    const actuator2 = new THREE.Mesh(actuatorGeometry, trim);
    actuator2.position.set(150, -210, -170);
    actuator2.rotation.z = 0.4;
    registerMesh(part, actuator2, pivot);

    const boltGeometry = new THREE.CylinderGeometry(20, 24, 30, 6);
    for (let b = 0; b < 4; b += 1) {
      const ba = angle + (b - 1.5) * 0.06;
      const bolt = new THREE.Mesh(boltGeometry, trim);
      bolt.position.set(Math.cos(ba) * 5370, 250, Math.sin(ba) * 5370);
      bolt.rotation.y = -ba;
      registerMesh(part, bolt, part.root);
    }

    vernierAnim.push({ pivot, phase: i * 0.83, baseTilt });
  }
}

/* --------------------------------------------------------------------------
   15. 场景、灯光、地面、羽流
   -------------------------------------------------------------------------- */

function buildScene() {
  scene.background = new THREE.Color(0x05070b);
  scene.fog = new THREE.Fog(0x05070b, 30000, 90000);
  scene.environment = lowQuality ? null : envMaps.dark;

  hemiLight = new THREE.HemisphereLight(0xa9c4dd, 0x11151b, 1.2);
  scene.add(hemiLight);

  keyLight = new THREE.DirectionalLight(0xfff2e2, 3.1);
  keyLight.position.set(13000, 25000, -9000);
  scene.add(keyLight);

  fillCyanLight = new THREE.PointLight(0xbfe4ff, 3.6, 90000, 0);
  fillCyanLight.position.set(-2000, 13000, 26000);
  scene.add(fillCyanLight);

  fillOrangeLight = new THREE.PointLight(ORANGE, 1.7, 80000, 0);
  fillOrangeLight.position.set(16000, 4500, 8000);
  scene.add(fillOrangeLight);

  ignitionLight = new THREE.PointLight(0xff6a18, 0, 65000, 0);
  ignitionLight.position.set(0, 260, 0);
  scene.add(ignitionLight);

  reactorLight = new THREE.PointLight(CYAN, 2.6, 22000, 0);
  reactorLight.position.set(0, 5100, 0);
  scene.add(reactorLight);

  buildGround();
  buildStars();
  buildPlume();
  buildOutlineMaterials();
}

function buildGround() {
  groundMat = new THREE.MeshStandardMaterial({
    color: 0x05080c,
    metalness: 0.12,
    roughness: 0.95,
    side: THREE.DoubleSide,
  });
  const groundGeometry = new THREE.RingGeometry(2800, 32000, 128, 1);
  groundGeometry.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(groundGeometry, groundMat);
  ground.position.y = -150;
  scene.add(ground);

  // 浅色白模的接触影：径向渐变压暗发射台周围地面
  contactShadowMat = new THREE.MeshBasicMaterial({
    map: textures.contact,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    color: 0xffffff,
  });
  const contactGeometry = new THREE.PlaneGeometry(22000, 22000);
  contactGeometry.rotateX(-Math.PI / 2);
  contactShadow = new THREE.Mesh(contactGeometry, contactShadowMat);
  contactShadow.position.y = -145;
  contactShadow.visible = false;
  contactShadow.renderOrder = 1;
  scene.add(contactShadow);

  // 点火时从发射台中心溢出的橙色辉光
  padGlowMat = new THREE.MeshBasicMaterial({
    map: textures.glow,
    color: 0xff6a14,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const padGlowGeometry = new THREE.PlaneGeometry(32000, 32000);
  padGlowMesh = new THREE.Mesh(padGlowGeometry, padGlowMat);
  padGlowMesh.rotation.x = -Math.PI / 2;
  padGlowMesh.position.y = -128;
  padGlowMesh.visible = false;
  scene.add(padGlowMesh);

  launchRingMat = new THREE.MeshBasicMaterial({
    color: 0xff7a1c,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const launchRingGeometry = new THREE.TorusGeometry(7100, 95, 8, 160);
  launchRingGeometry.rotateX(Math.PI / 2);
  launchRing = new THREE.Mesh(launchRingGeometry, launchRingMat);
  launchRing.position.y = -122;
  launchRing.visible = false;
  scene.add(launchRing);

  pitMat = new THREE.MeshStandardMaterial({
    color: 0x080b0e,
    metalness: 0.25,
    roughness: 0.88,
    side: THREE.BackSide,
  });
  const pitGeometry = new THREE.CylinderGeometry(2795, 2795, 2100, 96, 1, true);
  const pit = new THREE.Mesh(pitGeometry, pitMat);
  pit.position.y = -1200;
  scene.add(pit);

  rimMat = new THREE.MeshBasicMaterial({
    color: ORANGE,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const rimGeometry = new THREE.TorusGeometry(2800, 26, 8, 128);
  rimGeometry.rotateX(Math.PI / 2);
  const rim = new THREE.Mesh(rimGeometry, rimMat);
  rim.position.y = -138;
  scene.add(rim);

  gridCoarse = new THREE.GridHelper(64000, 64, 0x2e5562, 0x152a33);
  gridCoarse.position.y = -118;
  gridCoarse.material.transparent = true;
  gridCoarse.material.opacity = 0.3;
  gridCoarse.material.depthWrite = false;
  scene.add(gridCoarse);

  gridFine = new THREE.GridHelper(18000, 72, 0x3b6d7c, 0x1d3943);
  gridFine.position.y = -112;
  gridFine.material.transparent = true;
  gridFine.material.opacity = 0.18;
  gridFine.material.depthWrite = false;
  scene.add(gridFine);

  const ringRadii = [9000, 15000, 22500];
  ringRadii.forEach((radius, i) => {
    const material = new THREE.MeshBasicMaterial({
      color: i === 0 ? CYAN : 0x5f8a98,
      transparent: true,
      opacity: i === 0 ? 0.26 : 0.14,
      depthWrite: false,
    });
    const geometry = new THREE.TorusGeometry(radius, i === 0 ? 18 : 12, 6, 160);
    geometry.rotateX(Math.PI / 2);
    const ring = new THREE.Mesh(geometry, material);
    ring.position.y = -114;
    scene.add(ring);
    ringMats.push(material);
  });

  // 地面导向刻度
  const tickMaterial = new THREE.MeshBasicMaterial({
    color: 0x3e6b78,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
  });
  ringMats.push(tickMaterial);
  const tickGeometry = new THREE.BoxGeometry(24, 4, 620);
  const ticks = new THREE.InstancedMesh(tickGeometry, tickMaterial, 48);
  for (let i = 0; i < 48; i += 1) {
    const angle = (i / 48) * TAU;
    _dummy.position.set(Math.cos(angle) * 8300, -112, Math.sin(angle) * 8300);
    _dummy.rotation.set(0, -angle, 0);
    _dummy.scale.set(1, 1, 1);
    _dummy.updateMatrix();
    ticks.setMatrixAt(i, _dummy.matrix);
  }
  ticks.instanceMatrix.needsUpdate = true;
  scene.add(ticks);
}

function buildStars() {
  const count = 1500;
  const positions = new Float32Array(count * 3);
  const rng = makeRng(0x5eed42);
  for (let i = 0; i < count; i += 1) {
    const radius = 42000 + rng() * 42000;
    const theta = rng() * TAU;
    const phi = Math.acos(2 * rng() - 1);
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.cos(phi) * 0.75 + 5000;
    positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  starMat = new THREE.PointsMaterial({
    color: 0xa9d9ea,
    size: 105,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    fog: false,
    blending: THREE.AdditiveBlending,
  });
  stars = new THREE.Points(geometry, starMat);
  stars.frustumCulled = false;
  scene.add(stars);
}

function buildPlume() {
  plumeGroup = new THREE.Group();
  plumeGroup.name = 'exhaust-plume';
  plumeGroup.position.y = 52;
  plumeGroup.visible = false;
  scene.add(plumeGroup);

  plumeOuterMat = new THREE.MeshBasicMaterial({
    color: 0xff4c00,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const outerGeometry = new THREE.ConeGeometry(2350, 4400, 40, 1, true);
  outerGeometry.rotateX(Math.PI);
  outerGeometry.translate(0, -2200, 0);
  const outer = new THREE.Mesh(outerGeometry, plumeOuterMat);
  plumeGroup.add(outer);

  plumeMidMat = new THREE.MeshBasicMaterial({
    color: 0xff8b1f,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const midGeometry = new THREE.ConeGeometry(1450, 3400, 32, 1, true);
  midGeometry.rotateX(Math.PI);
  midGeometry.translate(0, -1700, 0);
  const mid = new THREE.Mesh(midGeometry, plumeMidMat);
  plumeGroup.add(mid);

  plumeCoreMat = new THREE.MeshBasicMaterial({
    color: 0xffdca6,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const coreGeometry = new THREE.ConeGeometry(680, 2300, 24, 1, true);
  coreGeometry.rotateX(Math.PI);
  coreGeometry.translate(0, -1150, 0);
  const core = new THREE.Mesh(coreGeometry, plumeCoreMat);
  plumeGroup.add(core);

  plumeGlowMat = new THREE.MeshBasicMaterial({
    color: 0xff7b1c,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const glowGeometry = new THREE.CircleGeometry(2120, 72);
  glowGeometry.rotateX(-Math.PI / 2);
  plumeGlow = new THREE.Mesh(glowGeometry, plumeGlowMat);
  plumeGlow.position.y = 40;
  scene.add(plumeGlow);

  nozzleSpriteMat = new THREE.SpriteMaterial({
    map: textures.glow,
    color: 0xff8428,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
  nozzleSprite = new THREE.Sprite(nozzleSpriteMat);
  nozzleSprite.position.set(0, 420, 0);
  nozzleSprite.scale.set(15000, 15000, 1);
  nozzleSprite.visible = false;
  scene.add(nozzleSprite);
}

function buildOutlineMaterials() {
  outlineHullMat = new THREE.MeshBasicMaterial({
    color: CYAN,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.34,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  outlineCageMat = new THREE.LineBasicMaterial({
    color: CYAN,
    transparent: true,
    opacity: 0.72,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });

  // 浅色模式下常驻的极淡 backside 描边，用于分离形体
  lightOutlineMat = new THREE.MeshBasicMaterial({
    color: 0x33404d,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    fog: false,
  });
}

function buildLightOutlines() {
  if (!lightOutlineMat) return;
  const targets = [];
  parts.forEach((part) => {
    part.root.traverse((obj) => {
      if (!obj.isMesh || obj.isInstancedMesh) return;
      if (obj.userData.isOutline) return;
      if (obj.material && obj.material.transparent) return;
      targets.push(obj);
    });
  });
  targets.forEach((mesh) => {
    const shell = new THREE.Mesh(mesh.geometry, lightOutlineMat);
    shell.scale.setScalar(1.012);
    shell.userData.isOutline = true;
    shell.userData.isLightOutline = true;
    shell.raycast = () => {};
    shell.renderOrder = 3;
    shell.visible = false;
    mesh.add(shell);
    lightOutlineMeshes.push(shell);
  });
}

/* --------------------------------------------------------------------------
   16. 组装全部零件
   -------------------------------------------------------------------------- */

function buildParts() {
  PART_DEFS.forEach((def) => {
    const part = {
      id: def.id,
      name: def.name,
      en: def.en,
      params: def.params,
      desc: def.desc,
      anchorArray: def.anchor,
      explodeDir: def.explodeDir,
      explodeDistance: def.explodeDistance,
      materials: [],
      pickMeshes: [],
      ignitionEffects: [],
      exploded: false,
      labelEl: null,
      labelVisible: false,
      rowEl: null,
      flagEl: null,
      anim: {
        active: false,
        t: 0,
        startedAt: 0,
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
      },
      root: new THREE.Group(),
    };
    part.root.name = def.id;
    part.root.userData.partId = def.id;
    part.explodeOffset = new THREE.Vector3(def.explodeDir[0], def.explodeDir[1], def.explodeDir[2])
      .normalize()
      .multiplyScalar(def.explodeDistance);
    part.labelAnchor = new THREE.Vector3(def.anchor[0], def.anchor[1], def.anchor[2]);
    def.build(part);
    // 构建时的局部包围盒；拆解动画中只需加上 root.position 即可得到当前包围盒
    part.localBox = new THREE.Box3().setFromObject(part.root);
    scene.add(part.root);
    parts.push(part);
    partById.set(part.id, part);
    part.pickMeshes.forEach((mesh) => pickTargets.push(mesh));
  });
}

/* --------------------------------------------------------------------------
   17. 选中 / 描边 / 拆解
   -------------------------------------------------------------------------- */

function clearOutline() {
  outlineNodes.forEach((entry) => {
    if (entry.node.parent) entry.node.parent.remove(entry.node);
    if (entry.geometry) entry.geometry.dispose();
  });
  outlineNodes = [];
}

function buildOutline(part) {
  clearOutline();
  if (!part) return;
  part.root.updateMatrixWorld(true);

  const meshes = [];
  part.root.traverse((obj) => {
    if (!obj.isMesh || obj.isInstancedMesh) return;
    if (obj.userData.isOutline) return;
    meshes.push(obj);
  });

  meshes.forEach((mesh) => {
    const shell = new THREE.Mesh(mesh.geometry, outlineHullMat);
    shell.scale.setScalar(1.018);
    shell.userData.isOutline = true;
    shell.raycast = () => {};
    shell.renderOrder = 4;
    mesh.add(shell);
    outlineNodes.push({ node: shell, parent: mesh, geometry: null });
  });

  const box = new THREE.Box3().setFromObject(part.root);
  if (!box.isEmpty()) {
    const size = box.getSize(_v1);
    const center = box.getCenter(_v2);
    const cageGeometry = new THREE.EdgesGeometry(
      new THREE.BoxGeometry(size.x * 1.035, size.y * 1.035, size.z * 1.035),
    );
    const cage = new THREE.LineSegments(cageGeometry, outlineCageMat);
    cage.userData.isOutline = true;
    cage.raycast = () => {};
    cage.position.set(
      center.x - part.root.position.x,
      center.y - part.root.position.y,
      center.z - part.root.position.z,
    );
    part.root.add(cage);
    outlineNodes.push({ node: cage, parent: part.root, geometry: cageGeometry });
  }
}

function applySelectionVisuals() {
  const selectedPart = state.selected ? partById.get(state.selected) : null;
  parts.forEach((part) => {
    const isSelected = part === selectedPart;
    const dim = Boolean(selectedPart) && !isSelected;
    part.materials.forEach((mat) => {
      if (mat.userData.isPartMaterial) {
        const wantTransparent = dim || mat.userData.baseTransparent;
        if (mat.transparent !== wantTransparent) {
          mat.transparent = wantTransparent;
          mat.needsUpdate = true;
        }
        mat.opacity = dim ? 0.45 : mat.userData.baseOpacity;
        mat.depthWrite = dim ? false : mat.userData.baseDepthWrite;

        if (isSelected) {
          mat.emissive.setHex(CYAN);
          mat.emissiveIntensity = Math.max(1.15, mat.userData.glow ? state.ignition * mat.userData.glowMax : 0);
        } else if (mat.userData.glow) {
          mat.emissive.setHex(mat.userData.glowColor);
          mat.emissiveIntensity = state.ignition * mat.userData.glowMax;
        } else if (state.theme === 'light') {
          mat.emissive.setHex(0x000000);
          mat.emissiveIntensity = 0;
        } else {
          mat.emissive.setHex(mat.userData.base.emissive);
          mat.emissiveIntensity = mat.userData.base.emissiveIntensity;
        }
      } else if (mat.userData.isAccentMaterial) {
        mat.opacity = dim ? 0.45 : mat.userData.baseOpacity;
      }
    });
  });
}

function selectPart(id) {
  if (id && !partById.has(id)) return;
  state.selected = id || null;
  const part = state.selected ? partById.get(state.selected) : null;

  parts.forEach((p) => {
    const selected = p === part;
    if (p.rowEl) p.rowEl.classList.toggle('is-selected', selected);
    if (p.labelEl) p.labelEl.classList.toggle('is-selected', selected);
  });

  applySelectionVisuals();
  buildOutline(part);
  renderDetail(part);
  updateExplodeCounter();

  if (part && window.innerWidth <= 900) {
    document.body.classList.remove('drawer-parts', 'drawer-guide');
    document.body.classList.add('drawer-detail');
    updateDrawerButtons();
  }
}

function clearSelection() {
  selectPart(null);
}

function setExploded(part, exploded, delay) {
  if (part.exploded === exploded) return;
  part.exploded = exploded;
  cameraFit.explodedCount += exploded ? 1 : -1;
  if (exploded && cameraFit.explodedCount === 1) {
    // 第一次进入拆解态时记下相机距离与视点高度，复位时平滑回到这里
    cameraFit.baseDistance = cameraDistance();
    cameraFit.baseTargetY = controls.target.y;
  }
  cameraFit.active = true;
  part.anim.from.copy(part.root.position);
  part.anim.to.copy(exploded ? part.explodeOffset : ZERO);
  part.anim.t = 0;
  part.anim.startedAt = (clock ? clock.elapsedTime : 0) + (delay || 0);
  part.anim.active = true;

  if (part.rowEl) {
    part.rowEl.classList.toggle('is-exploded', exploded);
    setText(part.flagEl, exploded ? '已拆' : '在位');
  }
  if (part.labelEl) part.labelEl.classList.toggle('is-exploded', exploded);
  if (state.selected === part.id) updateDetailAssembly(part);
  updateExplodeCounter();
}

function updateExplode() {
  const now = clock ? clock.elapsedTime : 0;
  parts.forEach((part) => {
    const anim = part.anim;
    if (!anim.active) return;
    const elapsed = now - anim.startedAt;
    if (elapsed < 0) return;
    anim.t = Math.min(1, elapsed / EXPLODE_SECONDS);
    const eased = easeInOutCubic(anim.t);
    part.root.position.lerpVectors(anim.from, anim.to, eased);
    if (anim.t >= 1) anim.active = false;
  });
}

function cameraDistance() {
  if (!camera || !controls) return 0;
  return camera.position.distanceTo(controls.target);
}

function partsBounds(target) {
  target.makeEmpty();
  parts.forEach((part) => {
    if (!part.localBox || part.localBox.isEmpty()) return;
    _fitBoxPart.copy(part.localBox).translate(part.root.position);
    target.union(_fitBoxPart);
  });
  return target;
}

function requiredFitDistance() {
  partsBounds(_fitBox);
  if (_fitBox.isEmpty()) return 0;
  _fitBox.getSize(_fitSize);
  _fitBox.getCenter(_fitCenter);
  const verticalHalf = camera.fov * DEG * 0.5;
  const horizontalHalf = Math.atan(Math.tan(verticalHalf) * camera.aspect);
  // 用视平面上的轴向半径代替包围球：细高机体的包围球会把相机推得过于保守
  const radiusV = (Math.max(_fitSize.y * 0.5, Math.abs(_fitCenter.y - controls.target.y)) + 400) * 1.14;
  const radiusH = (Math.max(_fitSize.x, _fitSize.z) * 0.5 + 400) * 1.14;
  const depth = Math.max(_fitSize.x, _fitSize.z) * 0.45;
  const needV = radiusV / Math.tan(verticalHalf);
  const needH = radiusH / Math.tan(horizontalHalf);
  // 俯视时远端的部件会被透视放大，留 10% 余量
  return (Math.max(needV, needH) + depth) * 1.10;
}

function updateCameraFit(dt, now) {
  if (!cameraFit.active || !camera || !controls) return;
  // 用户手动缩放后 1 秒内不自动拉远
  if (now - cameraFit.lastUserZoom < 1) return;

  const k = 1 - Math.exp(-3.5 * Math.min(dt, 0.1));

  // 拆解时视点跟随包围盒中心上抬，复位时回到原始高度
  let targetY = cameraFit.baseTargetY;
  if (cameraFit.explodedCount > 0) {
    partsBounds(_fitBox);
    if (!_fitBox.isEmpty()) targetY = _fitBox.getCenter(_fitCenter).y;
  }
  if (Math.abs(controls.target.y - targetY) > 0.5) controls.target.y += (targetY - controls.target.y) * k;
  else controls.target.y = targetY;

  let goal = cameraFit.baseDistance || cameraDistance();
  if (cameraFit.explodedCount > 0) goal = Math.max(goal, requiredFitDistance());
  goal = clamp(goal, controls.minDistance, controls.maxDistance);
  cameraFit.goal = goal;

  const current = cameraDistance();
  _fitDirection.copy(camera.position).sub(controls.target);
  if (_fitDirection.lengthSq() < 1e-6) {
    cameraFit.active = false;
    return;
  }
  _fitDirection.normalize();

  const animating = parts.some((part) => part.anim.active);
  if (Math.abs(current - goal) < 1.5 && !animating) {
    camera.position.copy(controls.target).addScaledVector(_fitDirection, goal);
    cameraFit.active = false;
    return;
  }

  const next = current + (goal - current) * k;
  camera.position.copy(controls.target).addScaledVector(_fitDirection, next);
}

function markUserZoom() {
  cameraFit.lastUserZoom = clock ? clock.elapsedTime : 0;
}

function explodeAll() {
  parts.forEach((part, index) => {
    if (part.exploded) return;
    setExploded(part, true, index * 0.035);
  });
}

function resetAll() {
  parts.forEach((part, index) => {
    if (part.exploded) setExploded(part, false, index * 0.02);
  });
  clearSelection();
}

function updateExplodeCounter() {
  const count = parts.filter((p) => p.exploded).length;
  setText(ui.explodeCounter, `${count} / ${parts.length} 已拆解`);
  if (ui.btnExplode) ui.btnExplode.classList.toggle('is-active', count === parts.length);
  if (ui.btnReset) ui.btnReset.classList.toggle('is-active', count === 0);
}

function activatePart(id) {
  const part = partById.get(id);
  if (!part) return;
  const alreadySelected = state.selected === id;
  if (!alreadySelected) selectPart(id);
  setExploded(part, !part.exploded);
  if (alreadySelected && part.exploded) {
    // setExploded 已经完成复位；保持详情面板显示该件。
    renderDetail(part);
  }
}

/* --------------------------------------------------------------------------
   18. 点选
   -------------------------------------------------------------------------- */

function partFromObject(object) {
  let node = object;
  while (node) {
    if (node.userData && node.userData.partId) {
      return partById.get(node.userData.partId) || null;
    }
    node = node.parent;
  }
  return null;
}

function pick(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNDC.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(pointerNDC, camera);
  const hits = raycaster.intersectObjects(pickTargets, false);
  for (let i = 0; i < hits.length; i += 1) {
    const part = partFromObject(hits[i]['object']);
    if (part) return part;
  }
  return null;
}

function handlePick(clientX, clientY) {
  const part = pick(clientX, clientY);
  if (part) activatePart(part.id);
  else clearSelection();
}

/* --------------------------------------------------------------------------
   19. 系统状态：点火 / 熄火 / 发射 / 主题
   -------------------------------------------------------------------------- */

function currentStatus() {
  if (state.launched) return '发射';
  if (state.ignited) return state.ignition >= 0.995 ? '点火' : '运转';
  if (state.ignition > 0.01) return '运转';
  return '待机';
}

function dataState() {
  if (state.launched) return 'launched';
  if (state.ignited) return 'ignited';
  return 'idle';
}

function ignite(force) {
  state.ignited = typeof force === 'boolean' ? force : !state.ignited;
  const now = clock ? clock.elapsedTime : 0;
  state.ignitionFrom = state.ignition;
  state.ignitionTarget = state.ignited ? 1 : 0;
  state.ignitionStart = now;

  if (!state.ignited) {
    state.launched = false;
    state.launchFrom = state.launchLevel;
    state.launchTarget = 0;
    state.launchStart = now;
    state.shake = 0;
    state.shakeEnd = now;
    showToast('点火序列已切断');
  } else {
    showToast('点火序列启动 · 3.0 s 渐变');
  }
  state.hudDirty = true;
  updateHUD(true);
}

function launch() {
  if (!state.ignited) {
    showToast('需先点火');
    return;
  }
  const now = clock ? clock.elapsedTime : 0;
  state.launched = true;
  state.launchFrom = state.launchLevel;
  state.launchTarget = 1;
  state.launchStart = now;
  state.shake = 1.2;
  state.shakeEnd = now + 1.2;
  state.hudDirty = true;
  triggerFlash();
  showToast('发射程序启动 · 主推力上升');
  updateHUD(true);
}

function triggerFlash() {
  const body = document.body;
  body.classList.remove('firing');
  void body.offsetWidth;
  body.classList.add('firing');
  if (flashTimer) window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => {
    body.classList.remove('firing');
    flashTimer = 0;
  }, 1120);
}

function applyInstanceTheme(mesh, light) {
  if (!mesh.instanceColor || !mesh.userData.baseInstanceColor) return;
  const array = mesh.instanceColor.array;
  if (light) {
    _color.setHex(0xc9ced6);
    for (let i = 0; i < array.length; i += 3) {
      array[i] = _color.r;
      array[i + 1] = _color.g;
      array[i + 2] = _color.b;
    }
  } else {
    array.set(mesh.userData.baseInstanceColor);
  }
  mesh.instanceColor.needsUpdate = true;
}

function setTheme(theme, silent) {
  state.theme = theme;
  document.body.dataset.theme = theme;
  const light = theme === 'light';

  if (scene) {
    scene.background.setHex(light ? 0xe9edf2 : 0x05070b);
    scene.fog.color.setHex(light ? 0xe9edf2 : 0x05070b);
    scene.fog.near = light ? 34000 : 30000;
    scene.fog.far = light ? 100000 : 90000;
    scene.environment = lowQuality ? null : (light ? envMaps.light : envMaps.dark);
  }

  if (renderer) renderer.toneMappingExposure = light ? 1.05 : 1.16;

  if (hemiLight) {
    hemiLight.color.setHex(light ? 0xffffff : 0x9db9d3);
    hemiLight.groundColor.setHex(light ? 0xc9d2db : 0x0a0d11);
    hemiLight.intensity = light ? 1.2 : 0.9;
  }
  if (keyLight) keyLight.intensity = light ? 2.4 : 3.1;
  if (fillCyanLight) fillCyanLight.intensity = light ? 0.5 : 3.6;
  if (fillOrangeLight) fillOrangeLight.intensity = light ? 0.55 : 1.7;
  if (reactorLight) reactorLight.intensity = light ? 0.8 : 2.6;

  if (groundMat) groundMat.color.setHex(light ? 0xbfc9d2 : 0x05080c);
  if (pitMat) pitMat.color.setHex(light ? 0x9aa7b3 : 0x080b0e);
  if (rimMat) rimMat.opacity = light ? 0.2 : 0.55;
  if (gridCoarse) gridCoarse.material.opacity = light ? 0.09 : 0.3;
  if (gridFine) gridFine.material.opacity = light ? 0.06 : 0.18;
  ringMats.forEach((mat) => {
    mat.opacity = light ? 0.06 : mat === ringMats[0] ? 0.26 : 0.16;
  });
  if (stars) stars.visible = !light;
  if (starMat) starMat.opacity = light ? 0.15 : 0.6;

  parts.forEach((part) => {
    part.materials.forEach((mat) => {
      if (mat.userData.isPartMaterial) {
        if (light) {
          mat.color.setHex(0xdfe3e8);
          mat.metalness = 0.05;
          mat.roughness = 0.9;
          mat.map = null;
          mat.envMapIntensity = 0.4;
          mat.needsUpdate = true;
        } else {
          const base = mat.userData.base;
          mat.color.setHex(base.color);
          mat.metalness = base.metalness;
          mat.roughness = base.roughness;
          mat.map = base.map;
          mat.envMapIntensity = base.envMapIntensity;
          mat.needsUpdate = true;
        }
      }
    });
    // InstancedMesh 的实例色也要跟随主题；原色在构建时已备份
    part.root.traverse((obj) => {
      if (obj.isInstancedMesh) applyInstanceTheme(obj, light);
    });
  });

  lightOutlineMeshes.forEach((mesh) => {
    mesh.visible = light;
  });
  if (contactShadow) contactShadow.visible = light;

  applySelectionVisuals();

  if (ui.btnTheme) {
    const label = ui.btnTheme.querySelector('.btn-text');
    if (label) label.textContent = light ? '深色科技' : '浅色白模';
    ui.btnTheme.setAttribute('aria-pressed', String(light));
  }
  state.hudDirty = true;
  updateHUD(true);

  if (!silent) showToast(light ? '已切换：浅色白模' : '已切换：深色科技');
}

function toggleTheme() {
  setTheme(state.theme === 'light' ? 'dark' : 'light', false);
}

function setLabels(visible, silent) {
  state.labels = visible;
  document.body.classList.toggle('labels-on', visible);
  if (ui.btnLabels) {
    ui.btnLabels.classList.toggle('is-active', visible);
    ui.btnLabels.setAttribute('aria-pressed', String(visible));
  }
  if (!silent) showToast(visible ? '标注已开启' : '标注已关闭');
}

function toggleLabels() {
  setLabels(!state.labels, false);
}

/* --------------------------------------------------------------------------
   20. 帧更新
   -------------------------------------------------------------------------- */

function updateSystems() {
  const now = clock ? clock.elapsedTime : 0;

  const ignitionProgress = clamp((now - state.ignitionStart) / IGNITION_SECONDS, 0, 1);
  state.ignition = state.ignitionFrom + (state.ignitionTarget - state.ignitionFrom) * ignitionProgress;

  const launchDuration = state.launchTarget > state.launchFrom ? 1.45 : 1.0;
  const launchProgress = clamp((now - state.launchStart) / launchDuration, 0, 1);
  state.launchLevel = state.launchFrom + (state.launchTarget - state.launchFrom) * launchProgress;

  state.shake = Math.max(0, state.shakeEnd - now);

  if (ignitionLight) {
    ignitionLight.intensity = 8 * state.ignition;
  }
  if (reactorLight) {
    const lightTheme = state.theme === 'light';
    reactorLight.intensity = (lightTheme ? 0.8 : 2.6) + state.ignition * 2.8;
  }

  updateGlow();
  updatePlume();
  updateVerniers();
}

function updateGlow() {
  const selectedId = state.selected;
  parts.forEach((part) => {
    const isSelected = part.id === selectedId;
    // 选中其他部件时，点火特效应与本件材质按同一系数淡出
    const dim = Boolean(selectedId) && !isSelected;
    part.materials.forEach((mat) => {
      if (mat.userData.glow && !isSelected) {
        mat.emissiveIntensity = state.ignition * mat.userData.glowMax;
      }
    });
    part.ignitionEffects.forEach((effect) => {
      effect.material.opacity = effect.max * state.ignition * (dim ? 0.45 : 1);
    });
  });
  if (outlineNodes.length) {
    const pulse = 0.5 + 0.5 * Math.sin(state.time * 5.2);
    outlineHullMat.opacity = 0.26 + pulse * 0.16;
    outlineCageMat.opacity = 0.55 + pulse * 0.3;
  }
}

function updatePlume() {
  if (!plumeGroup) return;
  const visible = state.ignition > 0.003;
  plumeGroup.visible = visible;
  plumeGlow.visible = visible;
  if (!visible) {
    plumeOuterMat.opacity = 0;
    plumeMidMat.opacity = 0;
    plumeCoreMat.opacity = 0;
    plumeGlowMat.opacity = 0;
    if (nozzleSprite) nozzleSprite.visible = false;
    if (padGlowMesh) padGlowMesh.visible = false;
    if (launchRing) launchRing.visible = false;
    return;
  }

  const jitterBase = 0.02 + state.launchLevel * 0.075;
  const flicker =
    1 +
    Math.sin(state.time * 17 + 0.7) * jitterBase +
    Math.sin(state.time * 31.7) * jitterBase * 0.45;
  const stretch = (1 + state.launchLevel * 1.5) *
    (1 + Math.sin(state.time * 13.3) * 0.008 * (1 + state.launchLevel * 2));
  const widthX = 1 + Math.sin(state.time * 11.1) * 0.035 * (1 + state.launchLevel * 2);
  const widthZ = 1 + Math.cos(state.time * 9.7) * 0.038 * (1 + state.launchLevel * 2);

  plumeGroup.scale.set(widthX, stretch, widthZ);
  plumeGroup.rotation.y = Math.sin(state.time * 2.1) * 0.03;

  plumeOuterMat.opacity = 0.32 * state.ignition * flicker * (1 + state.launchLevel * 0.35);
  plumeMidMat.opacity = 0.5 * state.ignition * (1 + state.launchLevel * 0.2);
  plumeCoreMat.opacity = 0.62 * state.ignition * flicker;
  plumeGlowMat.opacity = 0.5 * state.ignition * (0.9 + 0.1 * Math.sin(state.time * 19));

  plumeGlow.scale.setScalar(1 + state.launchLevel * 0.24);

  if (nozzleSpriteMat) {
    nozzleSprite.visible = true;
    nozzleSpriteMat.opacity = state.ignition * (0.36 + state.launchLevel * 0.3) * flicker;
  }
  if (padGlowMat) {
    padGlowMesh.visible = true;
    padGlowMat.opacity = state.ignition * (0.06 + state.launchLevel * 0.25) * flicker;
  }
  if (launchRing && launchRingMat) {
    launchRing.visible = true;
    launchRingMat.opacity = state.ignition * (0.055 + state.launchLevel * 0.24) * flicker;
    launchRing.scale.setScalar(1 + state.launchLevel * 0.08);
  }
}

function updateVerniers() {
  const amplitude = 0.018 + state.launchLevel * 0.08;
  for (let i = 0; i < vernierAnim.length; i += 1) {
    const entry = vernierAnim[i];
    entry.pivot.rotation.x = Math.sin(state.time * 1.35 + entry.phase) * amplitude * 0.7;
    entry.pivot.rotation.z =
      entry.baseTilt + Math.sin(state.time * 1.75 + entry.phase * 1.9) * amplitude;
  }
}

function applyShake() {
  if (!camera) return;
  // 以本次 controls.update() 之后的干净位置为基准，抖动只作为独立偏移
  cameraBasePosition.copy(camera.position);
  if (state.shake <= 0) {
    _shakeOffset.set(0, 0, 0);
    return;
  }
  const k = state.shake / 1.2;
  const amp = 12 * k;
  _shakeOffset.set(
    Math.sin(state.time * 71.3) * amp,
    Math.cos(state.time * 63.7) * amp * 0.55,
    Math.sin(state.time * 57.1 + 1.3) * amp,
  );
  camera.position.copy(cameraBasePosition).add(_shakeOffset);
}

function updateLabels() {
  if (!state.labels) return;
  const width = window.innerWidth;
  const height = window.innerHeight;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    const el = part.labelEl;
    if (!el) continue;
    _labelWorld.copy(part.labelAnchor).add(part.root.position);
    _labelCamera.copy(_labelWorld).applyMatrix4(camera.matrixWorldInverse);
    let visible = _labelCamera.z < -1;
    if (visible && _labelCamera.length() > 46000) visible = false;
    if (visible) {
      _labelProjected.copy(_labelWorld).project(camera);
      if (
        _labelProjected.z < -1 ||
        _labelProjected.z > 1 ||
        Math.abs(_labelProjected.x) > 1.08 ||
        Math.abs(_labelProjected.y) > 1.08
      ) {
        visible = false;
      } else {
        const x = (_labelProjected.x * 0.5 + 0.5) * width;
        const y = (-_labelProjected.y * 0.5 + 0.5) * height;
        el.style.left = `${x.toFixed(1)}px`;
        el.style.top = `${y.toFixed(1)}px`;
      }
    }
    if (visible !== part.labelVisible) {
      part.labelVisible = visible;
      el.classList.toggle('is-visible', visible);
    }
  }
}

function updateHUD(force) {
  if (!ui.statusText) return;
  const status = currentStatus();
  const statusChanged = ui.lastStatus !== status;
  if (statusChanged) {
    ui.lastStatus = status;
    setText(ui.statusText, status);
    setText(ui.detailState, status);
    setText(ui.detailSystemState, status);
  }

  const nextDataState = dataState();
  if (document.body.dataset.state !== nextDataState) {
    document.body.dataset.state = nextDataState;
  }

  const igniteLabel = state.ignited ? '熄火' : '点火';
  if (ui.igniteText && ui.igniteText.textContent !== igniteLabel) ui.igniteText.textContent = igniteLabel;
  if (ui.btnIgnite) {
    ui.btnIgnite.classList.toggle('is-active', state.ignited);
    ui.btnIgnite.setAttribute('aria-pressed', String(state.ignited));
  }
  if (ui.btnLaunch) {
    ui.btnLaunch.classList.toggle('is-active', state.launched);
    ui.btnLaunch.setAttribute('aria-pressed', String(state.launched));
  }

  if (!force && !state.hudDirty && state.hudClock < 0.09) return;
  state.hudClock = 0;
  state.hudDirty = false;

  const igniteEase = smoothstep(state.ignition);
  const launchEase = smoothstep(state.launchLevel);
  setText(ui.hudPower, formatScientific(3.2e13 * igniteEase, 'W'));
  setText(ui.hudTemp, formatScientific(1.0e8 * igniteEase, 'K'));
  setText(ui.hudThrust, formatScientific(1.5e9 * launchEase, 'N'));
  const pct = Math.round(state.ignition * 100);
  setText(ui.ignitionPct, `${pct}%`);
  if (ui.ignitionBar) ui.ignitionBar.style.width = `${state.ignition * 100}%`;
  if (ui.powerBar) ui.powerBar.style.width = `${state.ignition * 100}%`;
  if (ui.tempBar) ui.tempBar.style.width = `${state.ignition * 100}%`;
  if (ui.thrustBar) ui.thrustBar.style.width = `${state.launchLevel * 100}%`;
}

function tick() {
  window.requestAnimationFrame(tick);
  const frameDelta = clock.getDelta();
  state.time = clock.elapsedTime;
  state.hudClock += Math.min(frameDelta, 0.25);

  updateSystems();
  updateExplode();
  // 先撤销上一帧的抖动偏移，让 OrbitControls 始终基于干净位置计算
  if (_shakeOffset.lengthSq() > 0) camera.position.sub(_shakeOffset);
  controls.update();
  updateCameraFit(frameDelta, state.time);
  applyShake();
  camera.updateMatrixWorld();
  updateLabels();
  updateHUD(false);
  renderer.render(scene, camera);
}

/* --------------------------------------------------------------------------
   21. UI 构建与事件
   -------------------------------------------------------------------------- */

function buildUI() {
  ui.partList = byId('part-list');
  ui.partsCount = byId('parts-count');
  ui.explodeCounter = byId('explode-counter');
  ui.labelsLayer = byId('labels');
  ui.detailEmpty = byId('detail-empty');
  ui.detailBody = byId('detail-body');
  ui.detailIndex = byId('detail-index');
  ui.detailId = byId('detail-id');
  ui.detailName = byId('detail-name');
  ui.detailDesc = byId('detail-desc');
  ui.detailParams = byId('detail-params');
  ui.detailAssembly = byId('detail-assembly');
  ui.detailState = byId('detail-state');
  ui.detailSystemState = byId('detail-system-state');
  ui.detailToggle = byId('detail-toggle');
  ui.statusText = byId('status-text');
  ui.ignitionBar = byId('ignition-bar');
  ui.ignitionPct = byId('ignition-pct');
  ui.hudPower = byId('hud-power');
  ui.hudTemp = byId('hud-temp');
  ui.hudThrust = byId('hud-thrust');
  ui.powerBar = byId('hud-power-bar');
  ui.tempBar = byId('hud-temp-bar');
  ui.thrustBar = byId('hud-thrust-bar');
  ui.btnExplode = byId('btn-explode');
  ui.btnReset = byId('btn-reset');
  ui.btnIgnite = byId('btn-ignite');
  ui.btnLaunch = byId('btn-launch');
  ui.btnLabels = byId('btn-labels');
  ui.btnTheme = byId('btn-theme');
  ui.igniteText = ui.btnIgnite ? ui.btnIgnite.querySelector('.btn-text') : null;
  ui.toast = byId('toast');
  ui.boot = byId('boot');

  setText(ui.partsCount, String(parts.length));

  const listFragment = document.createDocumentFragment();
  const labelFragment = document.createDocumentFragment();

  parts.forEach((part, index) => {
    const number = String(index + 1).padStart(2, '0');
    const li = document.createElement('li');
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'part-row';
    row.dataset.part = part.id;
    row.setAttribute('aria-label', `${part.name}（${part.id}）`);
    row.innerHTML =
      `<span class="part-num">${number}</span>` +
      `<span class="part-main"><span class="part-name">${part.name}</span>` +
      `<span class="part-id">${part.id}</span></span>` +
      `<span class="part-flag">在位</span>`;
    row.addEventListener('click', () => activatePart(part.id));
    li.appendChild(row);
    listFragment.appendChild(li);
    part.rowEl = row;
    part.flagEl = row.querySelector('.part-flag');

    const label = document.createElement('div');
    label.className = 'part-label';
    label.dataset.part = part.id;
    label.innerHTML =
      `<span class="part-label-dot"></span>` +
      `<span class="part-label-index">${number}</span>` +
      `<span class="part-label-name">${part.name}</span>`;
    labelFragment.appendChild(label);
    part.labelEl = label;
  });

  ui.partList.appendChild(listFragment);
  ui.labelsLayer.appendChild(labelFragment);

  ui.detailToggle.addEventListener('click', () => {
    if (state.selected) activatePart(state.selected);
  });

  ui.btnExplode.addEventListener('click', explodeAll);
  ui.btnReset.addEventListener('click', resetAll);
  ui.btnIgnite.addEventListener('click', () => ignite());
  ui.btnLaunch.addEventListener('click', launch);
  ui.btnLabels.addEventListener('click', toggleLabels);
  ui.btnTheme.addEventListener('click', toggleTheme);

  document.querySelectorAll('.panel-close').forEach((button) => {
    button.addEventListener('click', () => {
      const name = button.dataset.close;
      document.body.classList.remove(`drawer-${name}`);
      updateDrawerButtons();
    });
  });

  document.querySelectorAll('#mobile-bar button').forEach((button) => {
    button.addEventListener('click', () => toggleDrawer(button.dataset.drawer));
  });

  const canvas = renderer.domElement;

  // 记录用户手动缩放，自动取景在 1 秒内让位给用户
  canvas.addEventListener('wheel', markUserZoom, { passive: true });
  canvas.addEventListener('touchmove', (event) => {
    if (event.touches.length >= 2) markUserZoom();
  }, { passive: true });

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    pointerDownInfo = { x: event.clientX, y: event.clientY, id: event.pointerId, time: performance.now() };
    dragDistance = 0;
    ignoreNextClick = true;
    closeDrawers();
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!pointerDownInfo || event.pointerId !== pointerDownInfo.id) return;
    const dx = event.clientX - pointerDownInfo.x;
    const dy = event.clientY - pointerDownInfo.y;
    dragDistance = Math.max(dragDistance, Math.sqrt(dx * dx + dy * dy));
  });

  canvas.addEventListener('pointerup', (event) => {
    if (!pointerDownInfo || event.pointerId !== pointerDownInfo.id) return;
    const dx = event.clientX - pointerDownInfo.x;
    const dy = event.clientY - pointerDownInfo.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const elapsed = performance.now() - pointerDownInfo.time;
    lastPointerWasDrag = distance > 6 || dragDistance > 6;
    if (!lastPointerWasDrag && elapsed < 1500) {
      handlePick(event.clientX, event.clientY);
    }
    pointerDownInfo = null;
  });

  canvas.addEventListener('pointercancel', () => {
    pointerDownInfo = null;
    lastPointerWasDrag = true;
  });

  // 兼容只派发 click 的自动化测试；真实指针序列产生的 click 已被 pointerup 消费
  canvas.addEventListener('click', (event) => {
    if (ignoreNextClick) {
      ignoreNextClick = false;
      lastPointerWasDrag = false;
      return;
    }
    handlePick(event.clientX, event.clientY);
  });

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    showToast('图形上下文丢失，请刷新页面');
  });

  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  window.addEventListener('keydown', (event) => {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;
    if (active && active.tagName === 'BUTTON' && (event.code === 'Space' || event.code === 'Enter')) return;

    switch (event.code) {
      case 'KeyE':
        explodeAll();
        event.preventDefault();
        break;
      case 'KeyR':
        resetAll();
        event.preventDefault();
        break;
      case 'KeyL':
        toggleLabels();
        event.preventDefault();
        break;
      case 'KeyT':
        toggleTheme();
        event.preventDefault();
        break;
      case 'Space':
        ignite();
        event.preventDefault();
        break;
      case 'KeyF':
        launch();
        event.preventDefault();
        break;
      default:
        break;
    }
  });

  document.addEventListener('pointerup', (event) => {
    const target = event.target;
    if (target && target.closest && target.closest('button')) {
      target.closest('button').blur();
    }
  }, true);

  setLabels(true, true);
  renderDetail(null);
  updateExplodeCounter();
  updateDrawerButtons();
  updateHUD(true);
}

function renderDetail(part) {
  if (!ui.detailBody) return;
  if (!part) {
    ui.detailEmpty.hidden = false;
    ui.detailBody.hidden = true;
    return;
  }
  ui.detailEmpty.hidden = true;
  ui.detailBody.hidden = false;

  const index = parts.indexOf(part);
  setText(ui.detailIndex, String(index + 1).padStart(2, '0'));
  setText(ui.detailId, part.id);
  setText(ui.detailName, part.name);
  setText(ui.detailDesc, part.desc);

  ui.detailParams.replaceChildren();
  const rows = document.createDocumentFragment();
  part.params.forEach(([key, value]) => {
    const row = document.createElement('div');
    row.className = 'param-row';
    const dt = document.createElement('dt');
    dt.textContent = key;
    const dd = document.createElement('dd');
    dd.textContent = value;
    row.appendChild(dt);
    row.appendChild(dd);
    rows.appendChild(row);
  });
  ui.detailParams.appendChild(rows);

  setText(ui.detailToggle, part.exploded ? '复位部件' : '拆解部件');
  updateDetailAssembly(part);
  updateHUD(true);
}

function updateDetailAssembly(part) {
  if (!part || state.selected !== part.id) return;
  setText(ui.detailAssembly, part.exploded ? '已拆解' : '在位');
  if (ui.detailAssembly) ui.detailAssembly.classList.toggle('is-exploded', part.exploded);
  setText(ui.detailToggle, part.exploded ? '复位部件' : '拆解部件');
}

function updateDrawerButtons() {
  document.querySelectorAll('#mobile-bar button').forEach((button) => {
    const open = document.body.classList.contains(`drawer-${button.dataset.drawer}`);
    button.classList.toggle('is-active', open);
    button.setAttribute('aria-pressed', String(open));
  });
}

function toggleDrawer(name) {
  const className = `drawer-${name}`;
  const open = document.body.classList.contains(className);
  closeDrawers();
  if (!open) {
    document.body.classList.add(className);
    updateDrawerButtons();
  }
}

function closeDrawers() {
  document.body.classList.remove('drawer-parts', 'drawer-detail', 'drawer-guide');
  updateDrawerButtons();
}

function showToast(message) {
  if (!ui.toast) return;
  ui.toast.textContent = message;
  ui.toast.classList.add('show');
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    ui.toast.classList.remove('show');
    toastTimer = 0;
  }, 2200);
}

function onResize() {
  if (!renderer || !camera) return;
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setPixelRatio(targetPixelRatio());
  renderer.setSize(width, height);
  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
  state.hudDirty = true;
}

/* --------------------------------------------------------------------------
   22. 初始化
   -------------------------------------------------------------------------- */

function hideBoot() {
  if (!ui.boot) return;
  ui.boot.classList.add('boot--done');
  document.body.classList.remove('booting');
  window.setTimeout(() => {
    if (ui.boot && ui.boot.parentNode) ui.boot.parentNode.removeChild(ui.boot);
    ui.boot = null;
  }, 800);
}

function failBoot(message) {
  const boot = byId('boot');
  if (!boot) return;
  const title = boot.querySelector('.boot-title');
  if (title) title.textContent = message;
  boot.classList.remove('boot--done');
}

function buildRenderer() {
  const stage = byId('stage');
  renderer = new THREE.WebGLRenderer({
    antialias: !lowQuality,
    powerPreference: 'high-performance',
    alpha: false,
    stencil: false,
  });
  renderer.setPixelRatio(targetPixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.16;
  renderer.domElement.id = 'engine-canvas';
  renderer.domElement.setAttribute('aria-label', '行星发动机三维模型，可拖拽旋转、缩放与点击拆解');
  stage.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(46, window.innerWidth / Math.max(1, window.innerHeight), 10, 200000);
  camera.position.set(CAMERA_POS[0], CAMERA_POS[1], CAMERA_POS[2]);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(CAMERA_TARGET[0], CAMERA_TARGET[1], CAMERA_TARGET[2]);
  controls.enableDamping = true;
  controls.dampingFactor = 0.065;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.8;
  controls.enablePan = false;
  controls.minDistance = 2000;
  controls.maxDistance = 60000;
  controls.maxPolarAngle = 1.55;
  controls.minPolarAngle = 0.08;
  controls.update();
}

function init() {
  lowQuality = detectSoftwareRenderer();
  buildRenderer();
  initTextures();
  envMaps = lowQuality
    ? { dark: null, light: null }
    : { dark: makeEnvironment('dark'), light: makeEnvironment('light') };
  buildScene();
  buildParts();
  buildLightOutlines();
  buildUI();
  setTheme('dark', true);

  clock = new THREE.Clock();
  clock.start();
  window.requestAnimationFrame(tick);

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(hideBoot);
  });

  window.__PLANET_ENGINE__ = {
    get parts() {
      return parts.map((part) => ({ id: part.id, name: part.name, exploded: part.exploded }));
    },
    get state() {
      return {
        theme: state.theme,
        selected: state.selected,
        ignition: state.ignition,
        ignited: state.ignited,
        launched: state.launched,
        status: currentStatus(),
        quality: lowQuality ? 'low' : 'high',
      };
    },
    get scene() {
      return scene;
    },
    get camera() {
      return camera;
    },
    get renderer() {
      return renderer;
    },
    get controls() {
      return controls;
    },
    select: (id) => selectPart(id),
    activate: (id) => activatePart(id),
    ignite: () => ignite(),
    launch: () => launch(),
    explodeAll,
    resetAll,
    setTheme,
  };

  applyDeepLink();
}

/* 深链 / 验收钩子：?theme=light&explode=all&ignite=1&launch=1&select=casing
   用于分享某个视角，以及让无头浏览器给每种状态截图。 */
function applyDeepLink() {
  const query = new URLSearchParams(window.location.search);
  const applied = [];

  const theme = query.get('theme');
  if (theme === 'light' || theme === 'dark') {
    setTheme(theme, true);
    applied.push('theme=' + theme);
  }

  if (query.get('explode') === 'all') {
    explodeAll();
    applied.push('explode=all');
  }

  const select = query.get('select');
  if (select && partById.has(select)) {
    selectPart(select);
    applied.push('select=' + select);
  }

  if (query.get('ignite') === '1' || query.get('launch') === '1') {
    ignite(true);
    applied.push('ignite=1');
  }

  if (query.get('launch') === '1') {
    launch();
    applied.push('launch=1');
  }

  document.body.dataset.qa = applied.join('&');
}

try {
  init();
} catch (error) {
  window.__BOOT_ERROR__ = error && (error.stack || error.message || String(error));
  failBoot('发动机装配失败 · 请检查 WebGL 支持');
}
