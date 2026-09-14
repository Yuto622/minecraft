// BLOCKWILD — ブロックの世界
// オリジナルのボクセル・サンドボックス。地形生成・光伝播・チャンク分割メッシュ・
// 生き物・クラフト・昼夜まで、すべてこのリポジトリ内で完結している。
import * as THREE from './three.module.js';
import { ID, IT, TOOL, blocks, items, isItem, name as blockName, color as blockColor } from './src/blocks.js';
import { buildAtlas, iconURL, blockTextures, tileTexture, cloudTexture, discTexture, layer as texLayer } from './src/textures.js';
import * as W3 from './src/world.js';
import { W, H, SEA, CH, CX, getBlock, setRaw, getMeta, setMeta, relight, relightAll, surface, isSolid, heightMap, biomeMap } from './src/world.js';
import { generate, setSeed, findSpawn, biomeName, biomeTint, villages } from './src/worldgen.js';
import { buildChunk, blockBoxes } from './src/mesher.js';
import { voxelMaterial, makeSky } from './src/shaders.js';
import { Mobs, Particles, Arrows, RemoteMobs } from './src/entities.js';
import { Net } from './src/net.js';
import { decodeCode, pretty } from './src/code.js';
import { Inventory, SLOTS, HOTBAR, maxStack, findRecipe, craftOnce, recipes, fuels, smelting } from './src/inventory.js';
import { Drops } from './src/drops.js';
import * as Snd from './src/audio.js';
import * as Save from './src/save.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------------------
// 設定
// ---------------------------------------------------------------------------
const defaults = { dist: 7, fov: 76, sens: 18, vol: 55, music: 45, hints: true, bob: true, buttons: false, dropOnDeath: true, shadows: true, bloom: true };
const settings = Object.assign({}, defaults, JSON.parse(localStorage.getItem('blockwild-settings') || '{}'));
const saveSettings = () => localStorage.setItem('blockwild-settings', JSON.stringify(settings));

// ---------------------------------------------------------------------------
// レンダラ
// ---------------------------------------------------------------------------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: $('game'), antialias: true, powerPreference: 'high-performance', stencil: false });
} catch (e) {
  $('loadMsg').textContent = 'WebGL を利用できません';
  $('loadTip').textContent = '別のブラウザ、または別の端末で開いてください。';
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, .06, 900);
camera.rotation.order = 'YXZ';
scene.add(camera);

const sky = makeSky();
scene.add(sky);

// 雲の層（本家と同じく、世界の上をゆっくり流れる）
const cloudTex = cloudTexture(256);
cloudTex.repeat.set(8, 8);
const clouds = new THREE.Mesh(
  new THREE.PlaneGeometry(760, 760),
  new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, opacity: .82, depthWrite: false, fog: false, side: THREE.DoubleSide })
);
clouds.rotation.x = -Math.PI / 2;
clouds.position.set(W / 2, H + 30, W / 2);
clouds.renderOrder = -5;
scene.add(clouds);

// 太陽と月（本家と同じ四角）
const makeDisc = kind => {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(kind === 'sun' ? 46 : 38, kind === 'sun' ? 46 : 38),
    new THREE.MeshBasicMaterial({ map: discTexture(kind), transparent: true, depthWrite: false, depthTest: false, fog: false })
  );
  m.renderOrder = -8;
  m.frustumCulled = false;
  scene.add(m);
  return m;
};
const sunDisc = makeDisc('sun'), moonDisc = makeDisc('moon');
scene.fog = new THREE.Fog('#9fd0e8', 30, 150);

// 生き物・パーティクル用の光（地形は自前シェーダで陰影を焼いている）
const hemi = new THREE.HemisphereLight('#dff0ff', '#4a5540', 2.2);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff3d6', 1.9);
sun.position.set(-40, 80, 20);
scene.add(sun);

const atlas = buildAtlas();
const layerOf = k => texLayer[k] ?? -1;
const matSolid = voxelMaterial(atlas, { transparent: false });
const matAlpha = voxelMaterial(atlas, { transparent: true });
const waterLayer = layerOf('water');
matAlpha.depthWrite = true;

const mobs = new Mobs(scene);
const particles = new Particles(scene);

// ---------------------------------------------------------------------------
// 影：太陽から見た深さを描いておき、地形シェーダで比べる
// ---------------------------------------------------------------------------
const SHADOW_RES = 2048, SHADOW_RANGE = 72;
const shadowRT = new THREE.WebGLRenderTarget(SHADOW_RES, SHADOW_RES, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
const shadowCam = new THREE.OrthographicCamera(-SHADOW_RANGE, SHADOW_RANGE, SHADOW_RANGE, -SHADOW_RANGE, 1, 260);
const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
const shadowBias = new THREE.Matrix4().set(.5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1);
const sunDirV = new THREE.Vector3(0, 1, 0);
const lightDirV = new THREE.Vector3(0, 1, 0);   // 太陽か月のうち、いま照らしている方
let sunStrength = 1;
const SKY_LAYER = 1;                             // 影を落とさないもの（空・雲・雨など）
camera.layers.enable(SKY_LAYER);
for (const o of [sky, clouds, sunDisc, moonDisc]) o.layers.set(SKY_LAYER);

function renderShadows() {
  const on = settings.shadows && sunStrength > .05;
  matSolid.uniforms.uShadowOn.value = on ? 1 : 0;
  matAlpha.uniforms.uShadowOn.value = on ? 1 : 0;
  if (!on) return;
  // 影用カメラは光の方向からプレイヤーを見下ろす。ちらつき防止に位置を丸める。
  const cx = Math.round(player.pos.x), cy = Math.round(player.pos.y), cz = Math.round(player.pos.z);
  shadowCam.position.set(cx + lightDirV.x * 150, cy + lightDirV.y * 150, cz + lightDirV.z * 150);
  shadowCam.lookAt(cx, cy, cz);
  shadowCam.updateMatrixWorld();
  shadowCam.updateProjectionMatrix();
  const m = new THREE.Matrix4().multiplyMatrices(shadowCam.projectionMatrix, shadowCam.matrixWorldInverse);
  m.premultiply(shadowBias);
  matSolid.uniforms.uShadowMatrix.value.copy(m);
  matAlpha.uniforms.uShadowMatrix.value.copy(m);
  matSolid.uniforms.uShadowMap.value = shadowRT.texture;
  matAlpha.uniforms.uShadowMap.value = shadowRT.texture;
  const prevOverride = scene.overrideMaterial;
  scene.overrideMaterial = depthMat;
  renderer.setRenderTarget(shadowRT);
  renderer.clear();
  renderer.render(scene, shadowCam);
  renderer.setRenderTarget(null);
  scene.overrideMaterial = prevOverride;
}

// ---------------------------------------------------------------------------
// ブルーム：明るいところだけ取り出してぼかし、重ねる
// ---------------------------------------------------------------------------
const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quadGeo = new THREE.PlaneGeometry(2, 2);
const rtOpts = { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false };
let sceneRT = new THREE.WebGLRenderTarget(2, 2, rtOpts);
let brightRT = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false });
let blurA = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false });
let blurB = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false });
const quadVS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const brightMat = new THREE.ShaderMaterial({
  uniforms: { tDiffuse: { value: null }, uThreshold: { value: 1.0 } },
  vertexShader: quadVS,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uThreshold; varying vec2 vUv;
    void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; float l = dot(c, vec3(.2126,.7152,.0722));
      float k = smoothstep(uThreshold, uThreshold + .8, l); gl_FragColor = vec4(c * k, 1.0); }`,
  depthTest: false, depthWrite: false,
});
const blurMat = new THREE.ShaderMaterial({
  uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2(1, 0) }, uTexel: { value: new THREE.Vector2(1, 1) } },
  vertexShader: quadVS,
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uDir, uTexel; varying vec2 vUv;
    void main(){ vec2 o = uDir * uTexel; vec3 c = texture2D(tDiffuse, vUv).rgb * .227;
      c += (texture2D(tDiffuse, vUv + o * 1.385).rgb + texture2D(tDiffuse, vUv - o * 1.385).rgb) * .316;
      c += (texture2D(tDiffuse, vUv + o * 3.23).rgb + texture2D(tDiffuse, vUv - o * 3.23).rgb) * .07;
      gl_FragColor = vec4(c, 1.0); }`,
  depthTest: false, depthWrite: false,
});
const compositeMat = new THREE.ShaderMaterial({
  uniforms: { tDiffuse: { value: null }, tBloom: { value: null }, uStrength: { value: .55 } },
  vertexShader: quadVS,
  fragmentShader: `uniform sampler2D tDiffuse, tBloom; uniform float uStrength; varying vec2 vUv;
    void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb + texture2D(tBloom, vUv).rgb * uStrength;
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  depthTest: false, depthWrite: false,
});
const quad = new THREE.Mesh(quadGeo, compositeMat);
const quadScene = new THREE.Scene();
quadScene.add(quad);

function resizeTargets() {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const w = Math.max(2, size.x | 0), h = Math.max(2, size.y | 0);
  if (sceneRT.width !== w || sceneRT.height !== h) {
    sceneRT.setSize(w, h);
    brightRT.setSize(w >> 1, h >> 1);
    blurA.setSize(w >> 1, h >> 1);
    blurB.setSize(w >> 1, h >> 1);
    blurMat.uniforms.uTexel.value.set(1 / (w >> 1), 1 / (h >> 1));
  }
}
function drawQuad(mat, target) {
  quad.material = mat;
  renderer.setRenderTarget(target);
  renderer.render(quadScene, quadCam);
}

// 本編を描く。ブルームがオンなら一度テクスチャに描いてから合成する。
function renderMain() {
  if (!settings.bloom) { renderer.setRenderTarget(null); renderer.render(scene, camera); return; }
  resizeTargets();
  renderer.setRenderTarget(sceneRT);
  renderer.clear();
  renderer.render(scene, camera);
  brightMat.uniforms.tDiffuse.value = sceneRT.texture;
  drawQuad(brightMat, brightRT);
  blurMat.uniforms.tDiffuse.value = brightRT.texture; blurMat.uniforms.uDir.value.set(1, 0); drawQuad(blurMat, blurA);
  blurMat.uniforms.tDiffuse.value = blurA.texture; blurMat.uniforms.uDir.value.set(0, 1); drawQuad(blurMat, blurB);
  blurMat.uniforms.tDiffuse.value = blurB.texture; blurMat.uniforms.uDir.value.set(1, 0); drawQuad(blurMat, blurA);
  blurMat.uniforms.tDiffuse.value = blurA.texture; blurMat.uniforms.uDir.value.set(0, 1); drawQuad(blurMat, blurB);
  compositeMat.uniforms.tDiffuse.value = sceneRT.texture;
  compositeMat.uniforms.tBloom.value = blurB.texture;
  drawQuad(compositeMat, null);
}

// 選択中ブロックの枠
const outline = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
  new THREE.LineBasicMaterial({ color: '#f6ffd0', transparent: true, opacity: .9, depthTest: true })
);
outline.visible = false;
outline.layers.set(SKY_LAYER);
scene.add(outline);

// 破壊のひび（10段階）
const crackMat = new THREE.MeshBasicMaterial({
  transparent: true, opacity: .95, depthWrite: false,
  polygonOffset: true, polygonOffsetFactor: -2, alphaTest: .02,
});
const crack = new THREE.Mesh(new THREE.BoxGeometry(1.004, 1.004, 1.004), crackMat);
crack.visible = false;
crack.renderOrder = 3;
crack.layers.set(SKY_LAYER);
scene.add(crack);
let crackStage = -1;
function setCrackStage(n) {
  if (n === crackStage) return;
  crackStage = n;
  crackMat.map = n >= 0 ? tileTexture('crack' + n) : null;
  crackMat.needsUpdate = true;
}

const heldId = () => bag.get(sel)?.id || 0;

// 手に持っている物が光るか（松明・ランタン・グロウストーン・溶岩バケツ）
function heldLightLevel() {
  const st = bag.get(sel);
  if (!st) return 0;
  if (st.id === IT.LAVA_BUCKET) return .9;
  const e = blocks[st.id]?.emit || 0;
  return e ? e / 15 * .85 : 0;
}

// プレイヤーの姿（自分の三人称用にも、友達の表示にも使う）
function makeAvatar(shirt = '#3c6aa8', pants = '#2f4a78') {
  const g = new THREE.Group();
  const box = (w, h, d, color, x, y, z, parent) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
    m.position.set(x, y, z); parent.add(m); return m;
  };
  const limb = (w, h, d, color, x, hipY, z) => {
    const p = new THREE.Group(); p.position.set(x, hipY, z); g.add(p);
    box(w, h, d, color, 0, -h / 2, 0, p); return p;
  };
  const body = box(.52, .72, .28, shirt, 0, 1.1, 0, g);
  const head = box(.46, .46, .46, '#c98f6a', 0, 1.68, 0, g);
  box(.09, .09, .03, '#2a2622', .12, 1.72, .24, head);
  box(.09, .09, .03, '#2a2622', -.12, 1.72, .24, head);
  box(.48, .2, .48, '#4a3526', 0, 1.86, 0, head);
  const arms = [limb(.18, .68, .22, '#c98f6a', .35, 1.44, 0), limb(.18, .68, .22, '#c98f6a', -.35, 1.44, 0)];
  const legs = [limb(.2, .76, .24, pants, .13, .76, 0), limb(.2, .76, .24, pants, -.13, .76, 0)];
  return Object.assign(g, { head, body, arms, legs });
}

// 名前の札（頭の上に浮かぶ）
function makeLabel(text) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const ctx = cv.getContext('2d');
  ctx.font = 'bold 34px "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = Math.min(250, ctx.measureText(text).width + 28);
  ctx.fillStyle = 'rgba(10,20,22,.72)';
  ctx.beginPath(); ctx.roundRect((256 - w) / 2, 12, w, 40, 10); ctx.fill();
  ctx.fillStyle = '#eaf3ee';
  ctx.fillText(text, 128, 33);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, sizeAttenuation: true }));
  sp.scale.set(2.2, .55, 1);
  sp.position.y = 2.35;
  sp.renderOrder = 5;
  return sp;
}

const avatar = makeAvatar();
avatar.visible = false;
scene.add(avatar);

// 手に持っているもの。
// 本編とは別のシーン・別の画角で最後に重ねて描くので、画面の端でも歪まない。
const viewScene = new THREE.Scene();
const viewCamera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, .01, 6);
viewCamera.layers.enable(SKY_LAYER);
const viewHemi = new THREE.HemisphereLight('#ffffff', '#5a6472', 2.2);
const viewSun = new THREE.DirectionalLight('#fff3d6', 2.1);
viewSun.position.set(-.6, 1, .8);
viewScene.add(viewHemi, viewSun);

// 腕。持ち物の後ろにいつも見えている。
const arm = new THREE.Mesh(new THREE.BoxGeometry(.16, .5, .16), new THREE.MeshLambertMaterial({ color: '#c98f6a' }));
arm.rotation.set(-.5, .1, .38);
arm.visible = false;
viewScene.add(arm);

let held = null;
function setHeld(id) {
  if (held) { viewScene.remove(held); held.geometry.dispose(); }
  held = null;
  if (!id) return;
  if (isItem(id)) {
    const it = items[id];
    const g = it.tool ? new THREE.BoxGeometry(.06, .42, .12) : new THREE.BoxGeometry(.16, .16, .16);
    held = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: it.color || '#ccc' }));
  } else if (blocks[id]?.plant) {
    held = new THREE.Mesh(new THREE.BoxGeometry(.07, .34, .07), new THREE.MeshLambertMaterial({ color: blockColor(id) }));
  } else {
    const texs = blockTextures(id);
    held = new THREE.Mesh(new THREE.BoxGeometry(.3, .3, .3),
      texs ? texs.map(t => new THREE.MeshLambertMaterial({ map: t })) : new THREE.MeshLambertMaterial({ color: blockColor(id) }));
  }
  held.rotation.set(.22, -.42, .12);
  viewScene.add(held);
  layoutHeld();
}

// 画面比に合わせて手元のブロックの位置と大きさを決める
// （縦長の端末で巨大化しないように、毎回このサイズを計算し直す）
const heldBase = new THREE.Vector3();
function layoutHeld() {
  const d = .62;
  viewCamera.aspect = camera.aspect;
  viewCamera.updateProjectionMatrix();
  const vh = Math.tan(THREE.MathUtils.degToRad(viewCamera.fov / 2)) * d;
  heldBase.set(Math.min(vh * camera.aspect * .62, vh * 1.15), -vh * .6, -d);
  if (held) {
    held.position.copy(heldBase);
    held.scale.setScalar(vh * .98);
  }
  arm.position.set(heldBase.x + vh * .2, heldBase.y - vh * .5, heldBase.z - .04);
  arm.scale.setScalar(vh * 2.0);
}

// ---------------------------------------------------------------------------
// チャンク管理
// ---------------------------------------------------------------------------
// 「今どこを中心に世界を組み立てるか」。遊んでいる間はプレイヤー、
// メニューの空撮中はカメラの位置を指す。
const focus = new THREE.Vector3(W / 2, 40, W / 2);
const SECT = H / CH;                // 縦の区画数
const chunks = new Map();           // "cx,cy,cz" -> {solid, alpha}
const pending = new Set();          // 作り直し待ち
function key(cx, cy, cz) { return cx + ',' + cy + ',' + cz; }

function disposeChunk(k) {
  const c = chunks.get(k);
  if (!c) return;
  for (const m of [c.solid, c.alpha]) if (m) { scene.remove(m); m.geometry.dispose(); }
  chunks.delete(k);
}

function buildOne(cx, cy, cz) {
  const k = key(cx, cy, cz);
  const { solid, alpha } = buildChunk(cx, cy, cz);
  disposeChunk(k);
  const entry = { solid: null, alpha: null, cx, cy, cz };
  if (solid) { const m = new THREE.Mesh(solid, matSolid); m.frustumCulled = true; scene.add(m); entry.solid = m; }
  if (alpha) { const m = new THREE.Mesh(alpha, matAlpha); m.renderOrder = 2; scene.add(m); entry.alpha = m; }
  chunks.set(k, entry);
}

function markDirty(x0, y0, z0, x1, y1, z1) {
  const cx0 = Math.max(0, Math.floor((x0 - 1) / CH)), cx1 = Math.min(CX - 1, Math.floor((x1 + 1) / CH));
  const cz0 = Math.max(0, Math.floor((z0 - 1) / CH)), cz1 = Math.min(CX - 1, Math.floor((z1 + 1) / CH));
  const cy0 = Math.max(0, Math.floor((y0 - 1) / CH)), cy1 = Math.min(SECT - 1, Math.floor((y1 + 1) / CH));
  for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++)
    for (let cy = cy0; cy <= cy1; cy++) pending.add(key(cx, cy, cz));
}

// 近いところから順に作り直す
function processChunks(budgetMs) {
  if (!pending.size) return;
  const t0 = performance.now();
  const px = focus.x / CH, py = focus.y / CH, pz = focus.z / CH;
  const list = [...pending].sort((a, b) => {
    const [ax, ay, az] = a.split(',').map(Number), [bx, by, bz] = b.split(',').map(Number);
    return ((ax - px) ** 2 + (ay - py) ** 2 * .5 + (az - pz) ** 2) - ((bx - px) ** 2 + (by - py) ** 2 * .5 + (bz - pz) ** 2);
  });
  for (const k of list) {
    const [cx, cy, cz] = k.split(',').map(Number);
    buildOne(cx, cy, cz);
    pending.delete(k);
    if (performance.now() - t0 > budgetMs) break;
  }
}

// 描画距離に応じた表示切り替え
function cullChunks() {
  const d = settings.dist, pcx = focus.x / CH, pcz = focus.z / CH;
  for (const c of chunks.values()) {
    const vis = Math.hypot(c.cx + .5 - pcx, c.cz + .5 - pcz) <= d + .9;
    if (c.solid) c.solid.visible = vis;
    if (c.alpha) c.alpha.visible = vis;
  }
}

// ---------------------------------------------------------------------------
// プレイヤー
// ---------------------------------------------------------------------------
const player = {
  pos: new THREE.Vector3(W / 2, 40, W / 2),
  vel: new THREE.Vector3(),
  yaw: 0, pitch: 0,
  onGround: false, inWater: false, sprint: false, sneak: false, fly: false, view: 0,
  health: 20, food: 20, air: 10, hurtCd: 0, regenT: 0, starveT: 0,
};
const HALF = .3, BODY = 1.8, EYE = 1.62, STEP = 1.02;

// ハーフブロックや階段の形に沿って当たり判定をする
function boxBlocked(x, y, z, height = BODY) {
  for (let bx = Math.floor(x - HALF); bx <= Math.floor(x + HALF); bx++)
    for (let bz = Math.floor(z - HALF); bz <= Math.floor(z + HALF); bz++)
      for (let by = Math.floor(y); by <= Math.floor(y + height - .02); by++) {
        const id = getBlock(bx, by, bz);
        if (!isSolid(id)) continue;
        const b = blocks[id];
        if (b.full !== false) return true;
        const tall = b.tall || 1;
        for (const box of blockBoxes(id, getMeta(bx, by, bz))) {
          if (bx + box[3] > x - HALF && bx + box[0] < x + HALF &&
              bz + box[5] > z - HALF && bz + box[2] < z + HALF &&
              by + box[4] * tall > y && by + box[1] < y + height) return true;
        }
      }
  return false;
}
let stepped = false;
function moveAxis(axis, amount) {
  if (!amount) return;
  const steps = Math.ceil(Math.abs(amount) / .2);
  const d = amount / steps;
  for (let i = 0; i < steps; i++) {
    const p = player.pos.clone();
    p[axis] += d;
    if (axis === 'x') p.x = clamp(p.x, HALF + .01, W - HALF - .01);
    if (axis === 'z') p.z = clamp(p.z, HALF + .01, W - HALF - .01);
    if (!boxBlocked(p.x, p.y, p.z)) {
      // スニーク中は足場の縁で止まる
      if (axis !== 'y' && player.sneak && player.onGround && !player.fly && !onLedge(p.x, p.z)) return;
      player.pos.copy(p);
      if (axis === 'y' && d < 0) player.onGround = false;
      continue;
    }
    if (axis === 'y') { if (d < 0) player.onGround = true; player.vel.y = 0; return; }

    // 1ブロックの段差は自動で上る（いちいち跳ばなくていい）。
    // 1フレームに1段までに制限しているので、壁をよじ登ることはない。
    if (!stepped && (player.onGround || player.inWater) && !player.fly &&
        !boxBlocked(p.x, p.y + STEP, p.z) && !boxBlocked(player.pos.x, player.pos.y + STEP, player.pos.z)) {
      player.pos.set(p.x, player.pos.y + STEP, p.z);
      player.onGround = false;
      stepped = true;
      continue;
    }
    return;
  }
}

// その位置に足場があるか（スニーク用）
function onLedge(x, z) {
  const y = player.pos.y;
  for (let bx = Math.floor(x - HALF); bx <= Math.floor(x + HALF); bx++)
    for (let bz = Math.floor(z - HALF); bz <= Math.floor(z + HALF); bz++)
      if (isSolid(getBlock(bx, Math.floor(y - .08), bz))) return true;
  return false;
}

// 地形の中に埋まってしまったら上へ押し出す（保存データの読み込み直後など）
function unstick() {
  if (!boxBlocked(player.pos.x, player.pos.y, player.pos.z)) return;
  for (let i = 0; i < 6; i++) {
    player.pos.y += 1;
    player.vel.y = 0;
    if (!boxBlocked(player.pos.x, player.pos.y, player.pos.z)) return;
  }
  const sp = findSpawn();
  player.pos.set(sp[0], sp[1], sp[2]);
}

const blockAtFeet = () => getBlock(Math.floor(player.pos.x), Math.floor(player.pos.y + .1), Math.floor(player.pos.z));
const blockAtEye = () => getBlock(Math.floor(player.pos.x), Math.floor(player.pos.y + EYE), Math.floor(player.pos.z));

function armorPoints() {
  return armor.reduce((a, st) => a + (st ? (items[st.id]?.def || 0) : 0), 0);
}
function damage(n, reason) {
  if (mode !== 'survival' || player.hurtCd > 0 || !playing) return;
  const ap = armorPoints();
  if (ap > 0) {                                    // 防具で軽減し、その分すり減る
    n = Math.max(1, Math.round(n * (1 - Math.min(.8, ap * .04))));
    armor.forEach((st, i) => {
      if (!st) return;
      st.dur = (st.dur ?? items[st.id].dur) - 1;
      if (st.dur <= 0) { armor[i] = null; toast(items[st.id].name + ' が壊れた'); }
    });
  }
  player.health = Math.max(0, player.health - n);
  player.hurtCd = .6;
  shakeT = .35;
  document.body.classList.add('hurt');
  setTimeout(() => document.body.classList.remove('hurt'), 130);
  Snd.hurt();
  updateVitals();
  if (player.health <= 0) die(reason);
}
let deathPos = null;
function die(reason) {
  playing = false;
  mining = false;
  document.exitPointerLock?.();
  document.body.classList.remove('playing');
  deathPos = player.pos.clone();
  Snd.hurt();
  if (settings.dropOnDeath) {                       // 本家と同じく持ち物を落とす
    let dropped = 0;
    bag.slots.forEach((st, i) => {
      if (!st) return;
      drops.spawn(st.id, st.n, player.pos.x, player.pos.y + .8, player.pos.z, .9, st.dur);
      bag.set(i, null);
      dropped += st.n;
    });
    $('deathCause').textContent = (reason || '力尽きた') + '。持ち物 ' + dropped + ' 個をその場に落とした。';
  } else {
    $('deathCause').textContent = (reason || '力尽きた') + '。持ち物はそのまま。';
  }
  $('deathStats').innerHTML = `
    <div><b>${deathPos.x.toFixed(0)} / ${deathPos.y.toFixed(0)} / ${deathPos.z.toFixed(0)}</b>たおれた場所</div>
    <div><b>${Math.floor(time / DAY_LEN) + 1}</b>日目</div>
    <div><b>${stats.mined}</b>掘ったブロック</div>`;
  $('death').classList.remove('hidden');
  updateHotbar();
}
function respawn() {
  $('death').classList.add('hidden');
  const s = spawnPoint || findSpawn();
  player.pos.set(s[0], s[1], s[2]);
  player.vel.set(0, 0, 0);
  player.health = 20; player.food = Math.max(6, player.food - 4); player.air = 10;
  unstick();
  updateVitals();
  start();
  if (deathPos) toast('たおれた場所は X ' + deathPos.x.toFixed(0) + ' / Z ' + deathPos.z.toFixed(0));
}
let spawnPoint = null;

// ---------------------------------------------------------------------------
// 視線の先（DDA でボクセルを追う）
// ---------------------------------------------------------------------------
const dir = new THREE.Vector3();
function raycastVoxel(maxDist = 6) {
  camera.getWorldDirection(dir);
  const o = camera.getWorldPosition(new THREE.Vector3());
  let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
  const step = [Math.sign(dir.x), Math.sign(dir.y), Math.sign(dir.z)];
  const tDelta = [Math.abs(1 / dir.x), Math.abs(1 / dir.y), Math.abs(1 / dir.z)];
  const tMax = [
    step[0] > 0 ? (x + 1 - o.x) / dir.x : step[0] < 0 ? (x - o.x) / dir.x : Infinity,
    step[1] > 0 ? (y + 1 - o.y) / dir.y : step[1] < 0 ? (y - o.y) / dir.y : Infinity,
    step[2] > 0 ? (z + 1 - o.z) / dir.z : step[2] < 0 ? (z - o.z) / dir.z : Infinity,
  ];
  let px = x, py = y, pz = z, t = 0;
  for (let i = 0; i < 256 && t <= maxDist; i++) {
    const id = getBlock(x, y, z);
    if (id && id !== ID.WATER) return { x, y, z, id, px, py, pz, dist: t };
    px = x; py = y; pz = z;
    const a = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2);
    t = tMax[a];
    tMax[a] += tDelta[a];
    if (a === 0) x += step[0]; else if (a === 1) y += step[1]; else z += step[2];
    if (y < -1 || y > H) break;
  }
  return null;
}

// ---------------------------------------------------------------------------
// ブロックの設置と破壊
// ---------------------------------------------------------------------------
const soundMat = id => {
  if ([ID.STONE, ID.COBBLE, ID.MOSSY, ID.GRANITE, ID.BRICK, ID.COAL_ORE, ID.IRON_ORE, ID.GOLD_ORE, ID.DIAMOND_ORE, ID.OBSIDIAN, ID.BEDROCK, ID.SANDSTONE].includes(id)) return 'stone';
  if ([ID.LOG, ID.BIRCH_LOG, ID.PINE_LOG, ID.PLANKS, ID.DARK_PLANKS, ID.BENCH].includes(id)) return 'wood';
  if ([ID.SAND, ID.GRAVEL].includes(id)) return 'sand';
  if ([ID.GLASS, ID.ICE].includes(id)) return 'glass';
  if ([ID.SNOW, ID.SNOW_GRASS].includes(id)) return 'snow';
  if (id >= ID.WOOL_W && id <= ID.WOOL_G) return 'wool';
  if ([ID.GRASS, ID.LEAVES, ID.BIRCH_LEAVES, ID.PINE_LEAVES, ID.TALL_GRASS, ID.ROSE, ID.DAISY].includes(id)) return 'grass';
  return 'dirt';
};

// ブロックを書き換えて、光とメッシュを更新する
function changeBlock(x, y, z, id, meta = 0) {
  if (online() && !applyingRemote) net.send({ t: 'block', x, y, z, id, m: meta });
  const old = getBlock(x, y, z);
  const radius = W3.autoRadius(x, y, z, old, id);
  setRaw(x, y, z, id, meta);
  const r = relight(x, y, z, radius);
  if (r) markDirty(r.x0, r.y0, r.z0, r.x1, r.y1, r.z1);
  markDirty(x, y, z, x, y, z);
  const ci = x + z * W;
  if (id === ID.AIR) { if (heightMap[ci] === y) heightMap[ci] = surface(x, z); }
  else if (y > heightMap[ci]) heightMap[ci] = y;
  mapDirty = true;
}

function currentTool() {
  const st = bag.get(sel);
  return st && isItem(st.id) && items[st.id]?.tool ? items[st.id] : null;
}
function breakSeconds(id) {
  const b = blocks[id];
  if (!b || b.hard === Infinity) return Infinity;
  if (mode === 'creative') return .12;
  const t = currentTool();
  const right = t && t.tool === b.tool && b.tool !== TOOL.NONE;
  const speed = right ? t.speed : (t ? 1.15 : 1);
  return Math.max(.05, b.hard * 1.5 / speed);
}
function canHarvest(id) {
  const b = blocks[id];
  if (!b || b.tier === 0) return true;
  const t = currentTool();
  return !!t && t.tool === b.tool && t.tier >= b.tier;
}

// 持ち物に入れる。入りきらない分はその場に落とす。
function give(id, n = 1, dur) {
  const left = bag.add(id, n, dur);
  if (left > 0 && playing) drops.spawn(id, left, player.pos.x, player.pos.y + 1, player.pos.z, .1);
  updateHotbar();
  if (bagOpen) renderScreen();
  return n - left;
}

function damageTool(n = 1) {
  const st = bag.get(sel);
  if (!st || mode === 'creative') return;
  const it = items[st.id];
  if (!it?.tool) return;
  st.dur = (st.dur ?? it.dur) - n;
  if (st.dur <= 0) {
    bag.set(sel, null);
    toast(it.name + ' が壊れてしまった');
    Snd.breakBlock('wood');
  }
  updateHotbar();
}

// 壊したときに何がいくつ落ちるか
function dropsOf(id, m) {
  const b = blocks[id];
  if (id === ID.WHEAT) return m >= 3 ? [[IT.WHEAT_ITEM, 1], [IT.SEEDS, 1 + (Math.random() < .5 ? 1 : 0)]] : [[IT.SEEDS, 1]];
  if (id === ID.TALL_GRASS) return Math.random() < .35 ? [[IT.SEEDS, 1]] : [];
  if (id === ID.LEAVES || id === ID.BIRCH_LEAVES || id === ID.PINE_LEAVES) {
    return Math.random() < .06 ? [[ID.OAK_SAPLING ?? id, 1]] : (Math.random() < .04 ? [[IT.STICK, 1]] : []);
  }
  if (id === ID.GRAVEL && Math.random() < .12) return [[IT.FLINT, 1]];
  if (id === ID.COAL_ORE) return [[IT.COAL, 1 + (Math.random() < .3 ? 1 : 0)]];
  if (id === ID.DIAMOND_ORE) return [[IT.DIAMOND, 1]];
  if (id === ID.IRON_ORE) return [[IT.RAW_IRON, 1]];
  if (id === ID.DOOR) return (m & 4) ? [] : [[ID.DOOR, 1]];
  if (id === ID.BED) return (m & 4) ? [] : [[ID.BED, 1]];
  return [[b.drop ?? id, 1]];
}

function mineBlock(hit) {
  const { x, y, z, id } = hit;
  const b = blocks[id];
  const m = getMeta(x, y, z);
  if (b.hard === Infinity) { toast('岩盤はどうやっても壊せない'); return; }
  if (mode === 'survival' && !canHarvest(id)) {
    const need = ['', '木', '石', '鉄', 'ダイヤ'][b.tier] || '強い';
    toast(need + 'の' + (b.tool === TOOL.AXE ? '斧' : b.tool === TOOL.SHOVEL ? 'シャベル' : 'ツルハシ') + 'が必要だ');
    hint('E で持ち物を開き、木材と棒から道具を作ろう');
    return;
  }
  // ドア・ベッドは相方も壊す
  if (b.door) changeBlock(x, (m & 4) ? y - 1 : y + 1, z, ID.AIR);
  if (b.bed) { const d = bedPartner(x, y, z, m); if (d) changeBlock(d[0], d[1], d[2], ID.AIR); }
  if (b.interact === 'chest') spillContainer(chests, x, y, z);
  if (b.interact === 'furnace') spillContainer(furnaces, x, y, z);

  changeBlock(x, y, z, ID.AIR);
  particles.burst(x, y, z, blockColor(id), 16);
  Snd.breakBlock(soundMat(id));
  if (mode === 'survival') {
    for (const [did, dn] of dropsOf(id, m)) if (did) drops.spawn(did, dn, x + .5, y + .4, z + .5);
    damageTool(1);
  }
  const above = getBlock(x, y + 1, z);
  if (blocks[above]?.plant || above === ID.SNOW) {
    changeBlock(x, y + 1, z, ID.AIR);
    if (mode === 'survival') drops.spawn(above, 1, x + .5, y + 1.4, z + .5);
  }
  queueFall(x, y + 1, z);
  queueLeafCheck(x, y, z, id);
  queueNeighborFluids(x, y, z);
  stats.mined++;
  if ([ID.LOG, ID.BIRCH_LOG, ID.PINE_LOG].includes(id)) advance('wood');
  if (id === ID.DIAMOND_ORE) advance('diamond');
  updateHotbar();
}

// 置く向き（プレイヤーの向きから決める）
function facingFromYaw() {
  const a = ((player.yaw % 6.2832) + 6.2832) % 6.2832;
  if (a < .7854 || a >= 5.4978) return 0;   // -Z を向いている → 正面は +Z
  if (a < 2.3562) return 3;
  if (a < 3.927) return 2;
  return 1;
}
const bedPartner = (x, y, z, m) => {
  const dirs = [[0, 0, 1], [1, 0, 0], [0, 0, -1], [-1, 0, 0]];
  const d = dirs[m & 3];
  return (m & 4) ? [x - d[0], y, z - d[2]] : [x + d[0], y, z + d[2]];
};

function placeBlock(hit) {
  const st = bag.get(sel);
  if (!st) { toast('スロットが空。E で持ち物から選ぼう'); return; }
  const id = st.id;
  if (isItem(id)) { toast(blockName(id) + ' は置けない'); return; }
  let { px, py, pz } = hit;
  const b = blocks[id];

  // ハーフブロックを同じ種類の上に置くと、まとまって1ブロックになる
  if (px < 0 || pz < 0 || px >= W || pz >= W || py < 0 || py >= H) { toast('この世界の外側には置けない'); return; }
  const there = getBlock(px, py, pz);
  if (there && there !== ID.WATER) { toast('そこにはもうブロックがある'); return; }
  if (b.plant && !isSolid(getBlock(px, py - 1, pz))) { toast('地面の上にしか置けない'); return; }
  if (b.door && (getBlock(px, py + 1, pz) || !isSolid(getBlock(px, py - 1, pz)))) { toast('ドアは地面の上、2マス分の空きが要る'); return; }

  const facing = facingFromYaw();
  let meta = b.rot ? facing : 0;
  if (b.bed) {
    const dirs = [[0, 0, 1], [1, 0, 0], [0, 0, -1], [-1, 0, 0]];
    const d = dirs[facing];
    if (getBlock(px + d[0], py, pz + d[2]) || !isSolid(getBlock(px + d[0], py - 1, pz + d[2]))) { toast('ベッドは2マス分の平らな場所が要る'); return; }
  }

  if (b.solid && collidesPlayer(px, py, pz, id, meta)) { toast('自分と重なる。少し離れて置こう'); return; }

  changeBlock(px, py, pz, id, meta);
  if (b.door) changeBlock(px, py + 1, pz, ID.DOOR, meta | 4);
  if (b.bed) { const d = [[0, 0, 1], [1, 0, 0], [0, 0, -1], [-1, 0, 0]][facing]; changeBlock(px + d[0], py, pz + d[2], ID.BED, meta | 4); }
  Snd.place(soundMat(id));
  if (mode !== 'creative') bag.consumeAt(sel);
  stats.placed++;
  if (stats.placed >= 200) advance('build');
  updateHotbar();
  swing();
  queueFall(px, py, pz);
}

// 置こうとしている形がプレイヤーと重なるか
function collidesPlayer(bx, by, bz, id, meta) {
  const p = player.pos;
  for (const box of blockBoxes(id, meta)) {
    if (bx + box[3] > p.x - HALF && bx + box[0] < p.x + HALF &&
        bz + box[5] > p.z - HALF && bz + box[2] < p.z + HALF &&
        by + box[4] > p.y && by + box[1] < p.y + BODY) return true;
  }
  return false;
}

function useItem() {
  const st = bag.get(sel);
  if (!st) return false;
  const it = items[st.id];

  // クワで土を耕す
  if (it?.tool === TOOL.HOE && hit) {
    const t = getBlock(hit.x, hit.y, hit.z);
    if ((t === ID.GRASS || t === ID.DIRT || t === ID.PODZOL) && !getBlock(hit.x, hit.y + 1, hit.z)) {
      changeBlock(hit.x, hit.y, hit.z, ID.FARMLAND);
      Snd.dig('dirt');
      particles.burst(hit.x, hit.y + .9, hit.z, '#6b4a2c', 8, .5);
      damageTool(1);
      hint('耕した土に種をまこう。草を壊すと種が手に入る');
      return true;
    }
  }
  // 種をまく
  if (st.id === IT.SEEDS && hit) {
    const { px, py, pz } = hit;
    if (getBlock(px, py - 1, pz) === ID.FARMLAND && !getBlock(px, py, pz)) {
      changeBlock(px, py, pz, ID.WHEAT, 0);
      plantAt(px, py, pz);
      if (mode !== 'creative') bag.consumeAt(sel);
      Snd.place('grass');
      updateHotbar();
      return true;
    }
  }
  // バケツで水や溶岩をすくう・置く
  if (st.id === IT.BUCKET && hit) {
    const liquid = getBlock(hit.x, hit.y, hit.z);
    if (liquid === ID.WATER || liquid === ID.LAVA) {
      changeBlock(hit.x, hit.y, hit.z, ID.AIR);
      bag.set(sel, { id: liquid === ID.WATER ? IT.WATER_BUCKET : IT.LAVA_BUCKET, n: 1 });
      Snd.splash();
      updateHotbar();
      return true;
    }
  }
  if ((st.id === IT.WATER_BUCKET || st.id === IT.LAVA_BUCKET) && hit) {
    const { px, py, pz } = hit;
    if (!getBlock(px, py, pz)) {
      changeBlock(px, py, pz, st.id === IT.WATER_BUCKET ? ID.WATER : ID.LAVA);
      if (st.id === IT.LAVA_BUCKET) queueFluid(px, py, pz);
      bag.set(sel, { id: IT.BUCKET, n: 1 });
      Snd.splash();
      updateHotbar();
      return true;
    }
  }
  // 村人と取引（小麦3→パン、革2→鉄、石炭6→たいまつ8）
  {
    camera.getWorldDirection(dir);
    const m = mobs.pick(camera.getWorldPosition(new THREE.Vector3()), dir, 4);
    if (m?.def.villager) {
      const trades = [[IT.WHEAT_ITEM, 3, IT.BREAD, 1], [IT.LEATHER, 2, IT.IRON, 1], [IT.COAL, 6, ID.TORCH, 8], [IT.RAW_IRON, 2, IT.IRON, 1]];
      const t = trades.find(x => x[0] === st.id);
      if (!t) { toast('村人：' + ['小麦3つでパンを', '革2枚で鉄を', '石炭6つでたいまつを', '鉄の原石2つで鉄を'][Math.floor(Math.random() * 4)] + '交換しよう'); Snd.mob('villager'); return true; }
      if (bag.count(t[0]) < t[1]) { toast('村人：' + blockName(t[0]) + 'が ' + t[1] + ' 個ないと交換できない'); return true; }
      bag.remove(t[0], t[1]);
      give(t[2], t[3]);
      Snd.craft();
      toast(blockName(t[0]) + '×' + t[1] + ' → ' + blockName(t[2]) + '×' + t[3] + ' と交換した');
      return true;
    }
  }
  // 小麦で動物を手なずける（繁殖）
  if (st.id === IT.WHEAT_ITEM) {
    camera.getWorldDirection(dir);
    const m = mobs.pick(camera.getWorldPosition(new THREE.Vector3()), dir, 4);
    if (m && !m.def.hostile) {
      if (mobs.feed(m)) {
        if (mode !== 'creative') bag.consumeAt(sel);
        particles.burst(m.g.position.x - .5, m.g.position.y + 1, m.g.position.z - .5, '#ff6b8a', 8, .5);
        Snd.pickup();
        updateHotbar();
        return true;
      }
    }
  }
  if (it?.food && player.food < 20 && mode === 'survival') {
    player.food = Math.min(20, player.food + it.food);
    if (st.id === IT.MEAT_RAW && Math.random() < .3) { player.health = Math.max(1, player.health - 1); toast('生肉はおなかを壊しそうだ'); }
    bag.consumeAt(sel);
    Snd.pickup();
    toast(it.name + ' を食べた');
    updateVitals(); updateHotbar();
    return true;
  }
  return false;
}

function attack(mob) {
  const t = currentTool();
  const dmg = t?.dmg || (t ? 2 : 1.5);
  Snd.hit();
  swing();
  particles.burst(mob.g.position.x - .4, mob.g.position.y + .6, mob.g.position.z - .4, '#c0503f', 7, .7);
  const dead = mobs.damage(mob, dmg, player.pos, (drop, n) => {
    if (mode === 'survival') drops.spawn(drop, n, mob.g.position.x, mob.g.position.y + .5, mob.g.position.z);
  });
  if (dead) { Snd.mob(mob.type); stats.hunted++; }
  if (t) damageTool(1);
}

// クリーパーの爆発：まわりのブロックを吹き飛ばす
function explode(x, y, z, radius) {
  Snd.explode();
  particles.burst(x - .5, y - .5, z - .5, '#3a3a3a', 40, 2.4);
  particles.burst(x - .5, y - .5, z - .5, '#ffb45a', 18, 2.8);
  const r = Math.ceil(radius);
  const cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z);
  // まとめて消してから、光とメッシュは一度だけ作り直す（一瞬止まらないように）
  let hitAny = false;
  for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) {
    const d = Math.hypot(a, b, c);
    if (d > radius) continue;
    const bx = cx + a, by = cy + b, bz = cz + c;
    const id = getBlock(bx, by, bz);
    if (!id || id === ID.WATER) continue;
    const hard = blocks[id].hard;
    if (hard === Infinity || hard > 4.5) continue;               // 岩盤や黒曜石は残る
    if (Math.random() > 1 - d / radius * .55) continue;
    setRaw(bx, by, bz, ID.AIR, 0);
    hitAny = true;
    if (mode === 'survival' && Math.random() < .28) for (const [did, dn] of dropsOf(id, 0)) if (did) drops.spawn(did, dn, bx + .5, by + .5, bz + .5);
  }
  if (hitAny) {
    const pad = 8;
    W3.relightRegion(cx - r - pad, cy - r - pad, cz - r - pad, cx + r + pad, cy + r + pad, cz + r + pad);
    markDirty(cx - r - 1, cy - r - 1, cz - r - 1, cx + r + 1, cy + r + 1, cz + r + 1);
    mapDirty = true;
    for (let a = -r; a <= r; a++) for (let c = -r; c <= r; c++) {
      const i = clamp(cx + a, 0, W - 1) + clamp(cz + c, 0, W - 1) * W;
      heightMap[i] = surface(clamp(cx + a, 0, W - 1), clamp(cz + c, 0, W - 1));
    }
  }
  const pd = Math.hypot(player.pos.x - x, player.pos.y + 1 - y, player.pos.z - z);
  if (pd < radius + 2) {
    damage(Math.round(11 * Math.max(.2, 1 - pd / (radius + 2))), 'クリーパーの爆発');
    if (player.health > 0) advance('boom');
    const k = Math.max(.4, 1 - pd / (radius + 2)) * 9;
    player.vel.y = k * .8;
    player.pos.x += (player.pos.x - x) / Math.max(.6, pd) * .6;
    player.pos.z += (player.pos.z - z) / Math.max(.6, pd) * .6;
  }
}

// --- 砂と砂利は落ちる / 葉は枯れる -----------------------------------------
const fallQueue = [];
const leafQueue = [];
function queueFall(x, y, z) {
  for (let i = 0; i < 6; i++) {
    const id = getBlock(x, y + i, z);
    if (!id) break;
    if (id === ID.SAND || id === ID.GRAVEL) fallQueue.push([x, y + i, z]);
  }
}
function queueLeafCheck(x, y, z, id) {
  if (![ID.LOG, ID.BIRCH_LOG, ID.PINE_LOG].includes(id)) return;
  for (let a = -4; a <= 4; a++) for (let b2 = -4; b2 <= 6; b2++) for (let c = -4; c <= 4; c++) {
    const t = getBlock(x + a, y + b2, z + c);
    if (t === ID.LEAVES || t === ID.BIRCH_LEAVES || t === ID.PINE_LEAVES) leafQueue.push([x + a, y + b2, z + c, 1.5 + Math.random() * 4]);
  }
}
function updateBlockPhysics(dt) {
  // 支えを失った砂・砂利
  for (let i = 0; i < 8 && fallQueue.length; i++) {
    const [x, y, z] = fallQueue.shift();
    const id = getBlock(x, y, z);
    if (id !== ID.SAND && id !== ID.GRAVEL) continue;
    let ny = y;
    while (ny > 1 && !getBlock(x, ny - 1, z)) ny--;
    if (ny === y) continue;
    changeBlock(x, y, z, ID.AIR);
    changeBlock(x, ny, z, id);
    particles.burst(x, ny, z, blockColor(id), 5, .4);
    fallQueue.push([x, y + 1, z]);
  }
  // 幹を失った葉
  for (let i = leafQueue.length - 1; i >= 0; i--) {
    leafQueue[i][3] -= dt;
    if (leafQueue[i][3] > 0) continue;
    const [x, y, z] = leafQueue.splice(i, 1)[0];
    const t = getBlock(x, y, z);
    if (![ID.LEAVES, ID.BIRCH_LEAVES, ID.PINE_LEAVES].includes(t)) continue;
    let near = false;
    for (let a = -3; a <= 3 && !near; a++) for (let b2 = -3; b2 <= 3 && !near; b2++) for (let c = -3; c <= 3 && !near; c++)
      if ([ID.LOG, ID.BIRCH_LOG, ID.PINE_LOG].includes(getBlock(x + a, y + b2, z + c))) near = true;
    if (near) continue;
    changeBlock(x, y, z, ID.AIR);
    particles.burst(x, y, z, blockColor(t), 6, .5);
    if (mode === 'survival' && Math.random() < .08) drops.spawn(IT.STICK, 1, x + .5, y + .5, z + .5);
  }
}

// ---------------------------------------------------------------------------
// ゲームの状態
// ---------------------------------------------------------------------------
let mode = 'creative';
let playing = false, started = false, bagOpen = false, ready = false;
let seed = (Math.random() * 1e9) | 0;
let time = 300;                       // 秒。DAY_LEN で1日
const DAY_LEN = 720;
let sel = 0;
const bag = new Inventory();           // 36スロットの持ち物（0-8 がホットバー）
const drops = new Drops(scene);        // 落ちているアイテム
const arrows = new Arrows(scene);      // 飛んでいる矢
const armor = [null, null, null, null]; // 頭・胴・脚・足
const chests = new Map();              // "x,y,z" -> 27スロット
const furnaces = new Map();            // "x,y,z" -> かまどの状態
let stats = { mined: 0, placed: 0, hunted: 0 };
let mapDirty = true;
const keys = {};

const CREATIVE_BAR = [ID.GRASS, ID.DIRT, ID.STONE, ID.COBBLE, ID.SAND, ID.PLANKS, ID.GLASS, ID.LANTERN, ID.TORCH];


// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
let toastT;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), 2600);
}
const shownHints = new Set();
let hintT;
function hint(msg, once = true) {
  if (!settings.hints) return;
  if (once && shownHints.has(msg)) return;
  shownHints.add(msg);
  const el = $('hint');
  el.textContent = '▸ ' + msg;
  el.classList.add('show');
  clearTimeout(hintT);
  hintT = setTimeout(() => el.classList.remove('show'), 5200);
}

function stackHTML(st, showCount = true) {
  if (!st) return '';
  const it = items[st.id];
  const dur = it?.dur && st.dur !== undefined && st.dur < it.dur
    ? `<span class="dur"><i style="width:${Math.max(0, st.dur / it.dur * 100)}%"></i></span>` : '';
  const n = showCount && st.n > 1 ? `<span class="n">${st.n}</span>` : '';
  return `<img src="${iconURL(st.id)}" alt="">${n}${dur}`;
}

function updateHotbar() {
  const el = $('hotbar');
  let html = '';
  for (let i = 0; i < HOTBAR; i++) {
    const st = bag.get(i);
    html += `<button class="slot ${i === sel ? 'active' : ''} ${st ? '' : 'empty'}" data-slot="${i}" title="${st ? blockName(st.id) : ''}">
      <b>${i + 1}</b>${stackHTML(st)}</button>`;
  }
  el.innerHTML = html;
  const st = bag.get(sel);
  $('selectedName').textContent = st ? blockName(st.id) : '';
  setHeld(st ? st.id : 0);
}

// 本家と同じく、ハートと肉のアイコンで表示する
function iconRow(el, n, full, half, empty, max = 10) {
  let html = '';
  for (let i = 0; i < max; i++) {
    const v = n / 2 - i;
    html += `<i class="${v >= 1 ? 'f' : v >= .5 ? 'h' : 'e'}">${v >= 1 ? full : v >= .5 ? half : empty}</i>`;
  }
  el.innerHTML = html;
}
function updateVitals() {
  const surv = mode === 'survival';
  $('vitals').classList.toggle('hidden', !surv);
  if (!surv) return;
  iconRow($('hearts'), player.health, '♥', '♥', '♡');
  const ap = armorPoints();
  const armEl = $('armor');
  armEl.classList.toggle('hidden', ap <= 0);
  iconRow(armEl, Math.min(20, ap), '🛡', '🛡', '·');
  iconRow($('food'), player.food, '🍖', '🍖', '·');
  const airEl = $('air');
  airEl.classList.toggle('hidden', player.air >= 10);
  iconRow(airEl, player.air * 2, '●', '●', '·');
}

// ---------------------------------------------------------------------------
// 持ち物・クラフト・チェスト・かまど
// 本家と同じ操作感：左クリックで丸ごと掴む／置く、右クリックで半分・1個ずつ。
// ---------------------------------------------------------------------------
let screen = 'inventory';          // inventory | bench | chest | furnace
let screenPos = null;              // 開いている設備の座標
let craftGrid = new Array(9).fill(null);
let cursor = null;                 // マウスが掴んでいる山

const containerKey = (x, y, z) => x + ',' + y + ',' + z;
function chestAt(x, y, z) {
  const k = containerKey(x, y, z);
  if (!chests.has(k)) chests.set(k, new Array(27).fill(null));
  return chests.get(k);
}
function furnaceAt(x, y, z) {
  const k = containerKey(x, y, z);
  if (!furnaces.has(k)) furnaces.set(k, { slots: new Array(3).fill(null), fuel: 0, fuelMax: 0, cook: 0, x, y, z });
  return furnaces.get(k);
}
function spillContainer(map, x, y, z) {
  const k = containerKey(x, y, z);
  const c = map.get(k);
  if (!c) return;
  const list = Array.isArray(c) ? c : c.slots;
  for (const st of list) if (st) drops.spawn(st.id, st.n, x + .5, y + .6, z + .5, .4, st.dur);
  map.delete(k);
}

const craftSize = () => (screen === 'bench' ? 3 : 2);
function gridCells() {
  const n = craftSize();
  const out = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) out.push(craftGrid[r * 3 + c]);
  return out;
}
function currentResult() {
  const n = craftSize();
  const cells = gridCells();
  const r = findRecipe(cells, n);
  return r ? { r, stack: { id: r.out[0], n: r.out[1] } } : null;
}

function cellHTML(cont, i, st, extra = '') {
  return `<button class="cell ${extra}" data-cont="${cont}" data-i="${i}" title="${st ? blockName(st.id) : ''}">${stackHTML(st)}</button>`;
}
function gridHTML(cont, list, from = 0, to = list.length, sel2 = -1) {
  let h = '';
  for (let i = from; i < to; i++) h += cellHTML(cont, i, list[i], i === sel2 ? 'sel' : '');
  return h;
}

function renderScreen() {
  const creative = mode === 'creative';
  $('screenKind').textContent = { inventory: 'INVENTORY', bench: 'CRAFTING TABLE', chest: 'CHEST', furnace: 'FURNACE' }[screen];
  $('screenTitle').textContent = { inventory: '持ち物', bench: '作業台', chest: 'チェスト', furnace: 'かまど' }[screen];

  // 上段：クラフト格子 / チェスト / かまど
  const top = $('screenTop');
  if (screen === 'chest') {
    const c = chestAt(...screenPos);
    top.innerHTML = `<div class="panelbox"><div class="rowhead"><span>チェストの中身</span><small>27マス</small></div>
      <div class="grid">${gridHTML('chest', c)}</div></div>`;
  } else if (screen === 'furnace') {
    const f = furnaceAt(...screenPos);
    const prog = f.cook > 0 ? Math.min(1, f.cook / COOK_TIME) : 0;
    top.innerHTML = `<div class="panelbox"><div class="rowhead"><span>かまど</span><small>燃料を入れて、焼きたいものを上へ</small></div>
      <div class="crafting">
        <div class="fuelcol">${cellHTML('furnace', 0, f.slots[0])}<span class="flame ${f.fuel > 0 ? 'on' : ''}"></span>${cellHTML('furnace', 1, f.slots[1])}</div>
        <div class="resultwrap"><div class="progbar"><i style="width:${(prog * 100).toFixed(0)}%"></i></div><span>焼き上がり</span></div>
        <div class="resultwrap">${cellHTML('furnace', 2, f.slots[2])}<span>取り出す</span></div>
      </div></div>`;
  } else {
    const n = craftSize();
    const res = currentResult();
    let cells = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) cells += cellHTML('craft', r * 3 + c, craftGrid[r * 3 + c]);
    const armorNames = ['頭', '胴', '脚', '足'];
    const armorCells = armor.map((st, i) => cellHTML('armor', i, st, 'armorslot') + `<span>${armorNames[i]}</span>`).join('');
    top.innerHTML = `<div class="panelbox"><div class="rowhead"><span>クラフト</span><small>${n === 3 ? '3×3（作業台）' : '2×2（作業台を置くと3×3）'}</small></div>
      <div class="crafting">
        <div class="armorcol">${armorCells}</div>
        <div class="craftgrid g${n}">${cells}</div>
        <div class="craftarrow">➜</div>
        <div class="resultwrap">${cellHTML('result', 0, res ? res.stack : null)}<span>できるもの</span></div>
      </div></div>`;
  }

  // クリエイティブの全ブロック一覧
  const cbox = $('creativeBox');
  cbox.classList.toggle('hidden', !creative);
  if (creative) {
    const list = blocks.filter(b => b && b.id !== ID.AIR && b.id !== ID.BEDROCK && b.id !== ID.FURNACE_LIT).map(b => b.id)
      .concat(Object.keys(items).map(Number));
    $('creativeGrid').innerHTML = list.map(id => `<button class="cell" data-cont="creative" data-i="${id}" title="${blockName(id)}"><img src="${iconURL(id)}" alt=""></button>`).join('');
  }

  $('invGrid').innerHTML = gridHTML('inv', bag.slots, HOTBAR, SLOTS);
  $('hotGrid').innerHTML = gridHTML('inv', bag.slots, 0, HOTBAR, sel);

  // レシピ帳
  const book = recipes.filter(r => !r.pattern || r.pattern.length <= craftSize());
  $('recipes').innerHTML = book.map((r, i) => {
    const idx = recipes.indexOf(r);
    return `<button data-recipe="${idx}" title="材料を格子に並べます">
      <img src="${iconURL(r.out[0])}" alt="">
      <span class="body"><b>${blockName(r.out[0])}${r.out[1] > 1 ? ' ×' + r.out[1] : ''}</b><small>${recipeText(r)}</small></span></button>`;
  }).join('');
  drawCursor();
}

function recipeText(r) {
  const names = new Map();
  const add = k => {
    const id = Array.isArray(k) ? k[0] : k;
    names.set(id, (names.get(id) || 0) + 1);
  };
  if (r.pattern) r.pattern.forEach(row => [...row].forEach(ch => { if (ch !== ' ') add(r.key[ch]); }));
  else r.shapeless.forEach(add);
  return [...names].map(([id, n]) => blockName(id) + (n > 1 ? '×' + n : '')).join(' ＋ ');
}

// レシピ帳から材料を格子へ並べる
function layoutRecipe(ri) {
  const r = recipes[ri];
  const n = craftSize();
  if (r.pattern && r.pattern.length > n) { toast('作業台が必要なレシピ'); return; }
  returnGrid();
  const need = [];
  const place = (row, col, key) => {
    const id = Array.isArray(key) ? key.find(k => bag.count(k) > 0) ?? key[0] : key;
    need.push([row, col, id]);
  };
  if (r.pattern) r.pattern.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== ' ') place(y, x, r.key[ch]); }));
  else r.shapeless.forEach((k, i) => place(Math.floor(i / n), i % n, k));
  let missing = null;
  for (const [row, col, id] of need) {
    if (mode !== 'creative' && !bag.remove(id, 1)) { missing = id; break; }
    craftGrid[row * 3 + col] = { id, n: 1 };
  }
  if (missing) { toast(blockName(missing) + ' が足りない'); returnGrid(); }
  updateHotbar();
  renderScreen();
}

// 格子の中身を持ち物へ戻す
function returnGrid() {
  for (let i = 0; i < 9; i++) {
    const st = craftGrid[i];
    if (!st) continue;
    craftGrid[i] = null;
    if (mode !== 'creative') give(st.id, st.n, st.dur);
  }
}

function takeResult(all) {
  const res = currentResult();
  if (!res) return;
  let loops = all ? 64 : 1;
  let made = 0;
  while (loops-- > 0) {
    const r = currentResult();
    if (!r) break;
    const st = r.stack;
    if (cursor && (cursor.id !== st.id || cursor.n + st.n > maxStack(st.id))) break;
    if (cursor) cursor.n += st.n; else cursor = { id: st.id, n: st.n, dur: items[st.id]?.dur };
    craftOnce(craftGrid);
    made++;
  }
  if (made) {
    Snd.craft();
    stats.crafted = (stats.crafted || 0) + made;
    const oid = res.stack.id;
    if (oid === ID.BENCH) advance('bench');
    if ([IT.WOOD_PICK, IT.STONE_PICK, IT.IRON_PICK, IT.DIAMOND_PICK].includes(oid)) advance('pick');
    if (oid === IT.BREAD) advance('bread');
  }
  renderScreen();
}

// --- スロット操作 -----------------------------------------------------------
function listFor(cont) {
  if (cont === 'inv') return bag.slots;
  if (cont === 'armor') return armor;
  if (cont === 'craft') return craftGrid;
  if (cont === 'chest') return chestAt(...screenPos);
  if (cont === 'furnace') return furnaceAt(...screenPos).slots;
  return null;
}

// Shift+クリック：持ち物 ⇄ チェスト／かまど をまとめて移す
function quickMove(cont, i) {
  const list = listFor(cont);
  if (!list) return;
  const st = list[i];
  if (!st) return;
  const target = cont === 'inv'
    ? (screen === 'chest' ? chestAt(...screenPos) : screen === 'furnace' ? furnaceAt(...screenPos).slots : null)
    : bag.slots;
  if (!target) {                                   // 行き先が無ければホットバー ⇄ 持ち物
    const from = i < HOTBAR ? [HOTBAR, SLOTS] : [0, HOTBAR];
    moveInto(bag.slots, i, bag.slots, from[0], from[1]);
  } else if (cont === 'inv') {
    moveInto(bag.slots, i, target, 0, screen === 'furnace' ? 2 : target.length);
  } else {
    moveInto(list, i, bag.slots, 0, SLOTS);
  }
  updateHotbar();
  renderScreen();
}
function moveInto(src, i, dst, from, to) {
  const st = src[i];
  if (!st) return;
  const max = maxStack(st.id);
  for (let k = from; k < to && st.n > 0; k++) {     // まず同じ種類に足す
    const d = dst[k];
    if (!d || d.id !== st.id || d.n >= max) continue;
    const put = Math.min(max - d.n, st.n);
    d.n += put; st.n -= put;
  }
  for (let k = from; k < to && st.n > 0; k++) {     // 次に空きへ
    if (dst[k]) continue;
    dst[k] = { id: st.id, n: st.n, dur: st.dur };
    st.n = 0;
  }
  if (st.n <= 0) src[i] = null;
}

// 数字キーでホットバーの枠と入れ替える
function swapToHotbar(cont, i, slot) {
  const list = listFor(cont);
  if (!list) return;
  const a = list[i], b = bag.slots[slot];
  list[i] = b; bag.slots[slot] = a;
  updateHotbar();
  renderScreen();
}

function clickSlot(cont, i, right) {
  if (cont === 'creative') {                       // クリエイティブの一覧から取り出す
    const id = i;
    cursor = { id, n: right ? 1 : maxStack(id), dur: items[id]?.dur };
    drawCursor();
    return;
  }
  if (cont === 'result') { takeResult(right); return; }
  const list = listFor(cont);
  if (!list) return;
  if (cont === 'furnace' && i === 2 && cursor) return;   // 焼き上がりには入れられない

  const st = list[i];
  if (cont === 'armor' && cursor && items[cursor.id]?.armor !== i) { toast('そこには着られない'); return; }
  if (cursor) {
    if (!st) {                                     // 空きへ置く
      if (right) { list[i] = { id: cursor.id, n: 1, dur: cursor.dur }; cursor.n--; if (cursor.n <= 0) cursor = null; }
      else { list[i] = cursor; cursor = null; }
    } else if (st.id === cursor.id && maxStack(st.id) > 1) {
      const room = maxStack(st.id) - st.n;
      const put = right ? Math.min(1, room, cursor.n) : Math.min(room, cursor.n);
      st.n += put; cursor.n -= put;
      if (cursor.n <= 0) cursor = null;
    } else if (!right) {                           // 入れ替え
      list[i] = cursor; cursor = st;
    }
  } else if (st && cont === 'inv' && right && items[st.id]?.armor !== undefined) {
    const slot = items[st.id].armor;               // 右クリックで着る
    const old = armor[slot];
    armor[slot] = st;
    list[i] = old || null;
    updateVitals();
  } else if (st) {
    if (right) {                                   // 半分だけ取る
      const half = Math.ceil(st.n / 2);
      cursor = { id: st.id, n: half, dur: st.dur };
      st.n -= half;
      if (st.n <= 0) list[i] = null;
    } else { cursor = st; list[i] = null; }
  }
  if (cont === 'inv') updateHotbar();
  renderScreen();
}

function drawCursor() {
  const el = $('cursorStack');
  if (!cursor) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.innerHTML = stackHTML(cursor);
}

function openScreen(kind, pos) {
  screen = kind;
  screenPos = pos || null;
  bagOpen = true;
  playing = false;
  mining = false;
  document.exitPointerLock?.();
  $('inventory').classList.remove('hidden');
  $('recipeBook').classList.toggle('hidden', kind === 'chest' || kind === 'furnace');
  renderScreen();
}
const openBag = () => openScreen(nearBench() ? 'bench' : 'inventory');

function closeOverlays() {
  if (bagOpen) {
    returnGrid();
    if (cursor) { give(cursor.id, cursor.n, cursor.dur); cursor = null; drawCursor(); }
  }
  $('inventory').classList.add('hidden');
  $('settings').classList.add('hidden');
  bagOpen = false;
}

function nearBench() {
  const p = player.pos;
  for (let x = -4; x <= 4; x++) for (let y = -3; y <= 3; y++) for (let z = -4; z <= 4; z++)
    if (getBlock(Math.floor(p.x) + x, Math.floor(p.y) + y, Math.floor(p.z) + z) === ID.BENCH) return true;
  return false;
}

// --- かまど -----------------------------------------------------------------
const COOK_TIME = 8;
function updateFurnaces(dt) {
  for (const f of furnaces.values()) {
    const input = f.slots[0], fuel = f.slots[1];
    const out = smelting[input?.id];
    const canCook = out !== undefined && (!f.slots[2] || (f.slots[2].id === out && f.slots[2].n < maxStack(out)));
    if (f.fuel > 0) f.fuel -= dt;
    if (f.fuel <= 0 && canCook && fuel && fuels[fuel.id]) {   // 新しい燃料に火をつける
      f.fuelMax = f.fuel = fuels[fuel.id] * COOK_TIME;
      fuel.n--;
      if (fuel.n <= 0) f.slots[1] = null;
    }
    const lit = f.fuel > 0;
    const id = getBlock(f.x, f.y, f.z);
    if (lit && id === ID.FURNACE) changeBlock(f.x, f.y, f.z, ID.FURNACE_LIT, getMeta(f.x, f.y, f.z));
    if (!lit && id === ID.FURNACE_LIT) changeBlock(f.x, f.y, f.z, ID.FURNACE, getMeta(f.x, f.y, f.z));
    if (lit && canCook) {
      f.cook += dt;
      if (f.cook >= COOK_TIME) {
        f.cook = 0;
        input.n--;
        if (input.n <= 0) f.slots[0] = null;
        if (f.slots[2]) f.slots[2].n++;
        else f.slots[2] = { id: out, n: 1 };
        Snd.ui(true);
      }
    } else f.cook = Math.max(0, f.cook - dt * 2);
  }
  if (bagOpen && screen === 'furnace') renderScreen();
}

// --- 水と溶岩の流れ ---------------------------------------------------------
// meta を水位（0 が水源、数字が大きいほど薄い）として使う。
const fluidQueue = [];
const MAXLV = { [ID.WATER]: 7, [ID.LAVA]: 3 };
function queueFluid(x, y, z) {
  if (fluidQueue.length > 4000) return;
  fluidQueue.push([x, y, z]);
}
function queueNeighborFluids(x, y, z) {
  for (const [dx, dy, dz] of [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]]) {
    const id = getBlock(x + dx, y + dy, z + dz);
    if (id === ID.WATER || id === ID.LAVA) queueFluid(x + dx, y + dy, z + dz);
  }
}
const replaceable = id => !id || blocks[id]?.plant;

function updateFluids() {
  let budget = 160;
  while (fluidQueue.length && budget-- > 0) {
    const [x, y, z] = fluidQueue.shift();
    const id = getBlock(x, y, z);
    if (id !== ID.WATER && id !== ID.LAVA) continue;
    const lv = getMeta(x, y, z);
    const other = id === ID.WATER ? ID.LAVA : ID.WATER;

    // 水と溶岩が出会うと石になる
    let met = false;
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]) {
      if (getBlock(x + dx, y + dy, z + dz) !== other) continue;
      met = true;
      if (id === ID.LAVA) changeBlock(x, y, z, lv === 0 ? ID.OBSIDIAN : ID.COBBLE);
      else changeBlock(x + dx, y + dy, z + dz, ID.STONE);
      Snd.splash();
      particles.burst(x, y, z, '#d8d8d8', 10, .6);
      break;
    }
    if (met) continue;

    const below = getBlock(x, y - 1, z);
    if (replaceable(below) && y > 0) {                     // 下へ落ちる
      changeBlock(x, y - 1, z, id, 1);
      queueFluid(x, y - 1, z);
      continue;
    }
    if (lv >= MAXLV[id]) continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {   // 横へ広がる
      const nb = getBlock(x + dx, y, z + dz);
      if (!replaceable(nb)) continue;
      if (nb && mode === 'survival') drops.spawn(nb, 1, x + dx + .5, y + .4, z + dz + .5);
      changeBlock(x + dx, y, z + dz, id, lv + 1);
      queueFluid(x + dx, y, z + dz);
    }
  }
}

// --- 農業 -------------------------------------------------------------------
const crops = new Map();                 // "x,y,z" -> 育ち具合の待ち時間
function plantAt(x, y, z) { crops.set(x + ',' + y + ',' + z, 12 + Math.random() * 26); }
function updateCrops(dt) {
  for (const [k, t] of crops) {
    const left = t - dt;
    const [x, y, z] = k.split(',').map(Number);
    if (getBlock(x, y, z) !== ID.WHEAT) { crops.delete(k); continue; }
    if (left > 0) { crops.set(k, left); continue; }
    const m = getMeta(x, y, z);
    if (m >= 3) { crops.delete(k); continue; }
    const wet = getBlock(x, y - 1, z) === ID.FARMLAND;
    setMeta(x, y, z, m + 1);
    markDirty(x, y, z, x, y, z);
    if (m + 1 < 3) crops.set(k, (wet ? 12 : 30) + Math.random() * 26);
    else { crops.delete(k); advance('farm'); }
  }
}

// --- 右クリックでの「使う」---------------------------------------------------
function interact(hit) {
  const id = getBlock(hit.x, hit.y, hit.z);
  const b = blocks[id];
  if (!b?.interact) return false;
  const m = getMeta(hit.x, hit.y, hit.z);
  switch (b.interact) {
    case 'door': {
      const bottomY = (m & 4) ? hit.y - 1 : hit.y;
      const bm = getMeta(hit.x, bottomY, hit.z);
      const open = (bm & 8) ? 0 : 8;
      setMeta(hit.x, bottomY, hit.z, (bm & 7) | open);
      setMeta(hit.x, bottomY + 1, hit.z, (getMeta(hit.x, bottomY + 1, hit.z) & 7) | 4 | open);
      markDirty(hit.x, bottomY, hit.z, hit.x, bottomY + 1, hit.z);
      Snd.place('wood');
      return true;
    }
    case 'chest': openScreen('chest', [hit.x, hit.y, hit.z]); Snd.ui(); return true;
    case 'furnace': openScreen('furnace', [hit.x, hit.y, hit.z]); Snd.ui(); return true;
    case 'bed': {
      if (!isNight()) { toast('夜になったら眠れる'); return true; }
      time = Math.ceil(time / DAY_LEN) * DAY_LEN + DAY_LEN * .27;
      player.health = Math.min(20, player.health + 4);
      spawnPoint = [hit.x + .5, hit.y + 1.05, hit.z + .5];
      advance('sleep');
      for (const mo of [...mobs.list]) if (mo.def.hostile) mobs.damage(mo, 999, null, () => {});
      if (online()) net.send({ t: 'time', sleep: 1 });
      toast('ぐっすり眠った。朝になった');
      updateVitals();
      return true;
    }
    default: return false;
  }
}

// ---------------------------------------------------------------------------
// 進捗（本家の「進捗」に当たるもの）
// ---------------------------------------------------------------------------
const ADVANCEMENTS = {
  wood: ['木を手に入れた', '素手で木を殴るところから始まる'],
  bench: ['作業台', '3×3 の格子でなんでも作れる'],
  pick: ['石の時代へ', 'ツルハシを手に入れた'],
  iron: ['鉄を手に入れた', 'かまどで原石を焼いた'],
  diamond: ['ダイヤモンド！', '地下深くの輝き'],
  cave: ['地下へ', '深さ 20 より下に潜った'],
  peak: ['山の頂', '高さ 45 より上に立った'],
  sleep: ['おやすみ', 'ベッドで夜を越した'],
  farm: ['小麦を育てた', '種をまき、実りを刈った'],
  bread: ['パンを焼いた', '自分で作った食べ物'],
  boom: ['生き延びた', 'クリーパーの爆発から逃れた'],
  swim: ['深く潜る', '水の底まで行った'],
  build: ['建築家', 'ブロックを 200 個置いた'],
  together: ['ひとりじゃない', '友達と同じ世界に立った'],
};
const earned = new Set();
let advT;
function advance(key) {
  if (earned.has(key) || !ADVANCEMENTS[key]) return;
  earned.add(key);
  const [name, desc] = ADVANCEMENTS[key];
  $('advName').textContent = name;
  $('advDesc').textContent = desc;
  $('toastAdv').classList.add('show');
  Snd.craft();
  clearTimeout(advT);
  advT = setTimeout(() => $('toastAdv').classList.remove('show'), 5600);
}

// ---------------------------------------------------------------------------
// チャットとコマンド
// ---------------------------------------------------------------------------
function chatLog(msg) {
  const d = document.createElement('div');
  d.textContent = msg;
  $('chatLog').appendChild(d);
  while ($('chatLog').children.length > 6) $('chatLog').firstChild.remove();
  setTimeout(() => d.remove(), 12000);
}
function openChat() {
  if (!playing) return;
  $('chatbar').firstElementChild.textContent = online() ? '💬' : '/';
  $('chatInput').placeholder = online() ? 'みんなに話す（/ でコマンド）' : 'コマンド（help で一覧）';
  playing = false;
  document.exitPointerLock?.();
  $('chatbar').classList.remove('hidden');
  $('chatInput').value = '';
  $('chatInput').focus();
}
function closeChat() {
  $('chatbar').classList.add('hidden');
  $('chatInput').blur();
  if (started && !bagOpen) start();
}
const nameToId = q => {
  const n = q.toLowerCase();
  for (const b of blocks) if (b && (blockName(b.id) === q || String(b.id) === q)) return b.id;
  for (const k of Object.keys(items)) if (blockName(+k) === q || k === q) return +k;
  for (const b of blocks) if (b && blockName(b.id).toLowerCase().includes(n)) return b.id;
  return null;
};
function runCommand(raw) {
  const line = raw.replace(/^\//, '').trim();
  if (!line) return;
  const [cmd, ...args] = line.split(/\s+/);
  switch (cmd) {
    case 'help':
      chatLog('time day|night|<数> / gamemode c|s / give <名前> [数] / tp <x> <y> <z>');
      chatLog('weather clear|rain / spawn / kill / seed / fly / heal / clear');
      break;
    case 'time': {
      const a = args[0];
      const base = Math.floor(time / DAY_LEN) * DAY_LEN;
      if (a === 'day') time = base + DAY_LEN * .3;
      else if (a === 'night') time = base + DAY_LEN * .85;
      else if (!isNaN(+a)) time = +a;
      chatLog('時刻を変えた');
      break;
    }
    case 'gamemode':
      applyMode(args[0]?.startsWith('s') ? 'survival' : 'creative');
      chatLog('モード：' + mode);
      break;
    case 'give': {
      const id = nameToId(args[0] || '');
      if (!id) { chatLog('そんなものは無い：' + args[0]); break; }
      give(id, Math.min(640, +args[1] || 1));
      chatLog(blockName(id) + ' を渡した');
      break;
    }
    case 'tp': {
      const [x, y, z] = args.map(Number);
      if ([x, y, z].some(isNaN)) { chatLog('tp <x> <y> <z>'); break; }
      player.pos.set(clamp(x, 1, W - 1), clamp(y, 1, H - 1), clamp(z, 1, W - 1));
      player.vel.set(0, 0, 0);
      unstick();
      chatLog('移動した');
      break;
    }
    case 'weather':
      weather = args[0] === 'rain' ? 1 : 0;
      weatherT = 600;
      chatLog(weather ? '雨を降らせた' : '晴れにした');
      break;
    case 'spawn': {
      const s2 = spawnPoint || findSpawn();
      player.pos.set(s2[0], s2[1], s2[2]);
      player.vel.set(0, 0, 0);
      chatLog('スポーン地点へ戻った');
      break;
    }
    case 'kill': die('コマンドで力尽きた'); break;
    case 'heal': player.health = 20; player.food = 20; updateVitals(); chatLog('回復した'); break;
    case 'fly': player.fly = !player.fly; chatLog(player.fly ? '飛行' : '着地'); break;
    case 'seed': chatLog('シード値：' + seed); break;
    case 'clear': bag.clear(); updateHotbar(); chatLog('持ち物を空にした'); break;
    default: chatLog('知らないコマンド：' + cmd + '（help で一覧）');
  }
}

// ---------------------------------------------------------------------------
// ミニマップ
// ---------------------------------------------------------------------------
const mapCanvas = document.createElement('canvas');
mapCanvas.width = mapCanvas.height = W;
const mapCtx = mapCanvas.getContext('2d');
const mapImg = mapCtx.createImageData(W, W);
function paintMap() {
  const d = mapImg.data;
  for (let z = 0; z < W; z++) for (let x = 0; x < W; x++) {
    const i = x + z * W, h = heightMap[i], b = biomeMap[i];
    const c = new THREE.Color(biomeTint[b]);
    const shade = .55 + (h / (H * .75)) * .7 + (heightMap[Math.max(0, x - 1) + z * W] < h ? .1 : 0);
    c.multiplyScalar(clamp(shade, .25, 1.45));
    if (h < SEA) c.lerp(new THREE.Color('#1f5d80'), clamp((SEA - h) / 10, .25, .8));
    const o = i * 4;
    d[o] = c.r * 255; d[o + 1] = c.g * 255; d[o + 2] = c.b * 255; d[o + 3] = 255;
  }
  mapCtx.putImageData(mapImg, 0, 0);
  mapDirty = false;
}
const mmCtx = $('minimap').getContext('2d');
function drawMinimap() {
  if (mapDirty) paintMap();
  const S = 150, R = 46;
  mmCtx.clearRect(0, 0, S, S);
  mmCtx.save();
  mmCtx.beginPath(); mmCtx.arc(S / 2, S / 2, S / 2 - 2, 0, 6.2832); mmCtx.clip();
  mmCtx.imageSmoothingEnabled = false;
  mmCtx.drawImage(mapCanvas, focus.x - R, focus.z - R, R * 2, R * 2, 0, 0, S, S);
  // 生き物
  for (const m of mobs.list) {
    const dx = (m.g.position.x - focus.x) / R * (S / 2) + S / 2;
    const dz = (m.g.position.z - focus.z) / R * (S / 2) + S / 2;
    mmCtx.fillStyle = m.def.hostile ? '#ff6b63' : '#ffe28a';
    mmCtx.fillRect(dx - 1.5, dz - 1.5, 3, 3);
  }
  // 自分
  mmCtx.translate(S / 2, S / 2);
  mmCtx.rotate(-player.yaw + Math.PI);
  mmCtx.fillStyle = '#d9f78f';
  mmCtx.beginPath(); mmCtx.moveTo(0, -7); mmCtx.lineTo(5, 6); mmCtx.lineTo(0, 3); mmCtx.lineTo(-5, 6); mmCtx.closePath(); mmCtx.fill();
  mmCtx.restore();
}

// ---------------------------------------------------------------------------
// マルチプレイ
// ---------------------------------------------------------------------------
const net = new Net();
const netMobs = new RemoteMobs(scene);
const friends = new Map();            // id -> {group, label, name, held}
const SHIRTS = ['#3c6aa8', '#a8453c', '#3f8a4e', '#8a5ba8', '#c08a2a', '#2f8f96', '#b05a8a', '#5a6a8f'];
const online = () => net.connected;

function friendFor(id, name) {
  let f = friends.get(id);
  if (f) return f;
  const g = makeAvatar(SHIRTS[id % SHIRTS.length], '#2f3a4a');
  const label = makeLabel(name || '…');
  g.add(label);
  scene.add(g);
  f = { id, g, label, name, bob: 0 };
  friends.set(id, f);
  return f;
}
function dropFriend(id) {
  const f = friends.get(id);
  if (!f) return;
  scene.remove(f.g);
  friends.delete(id);
}
function updateFriends(dt) {
  for (const p of net.players.values()) {
    const f = friendFor(p.id, p.name);
    if (p.name && f.name !== p.name) {                 // 名前が後から届いたら札を作り直す
      f.g.remove(f.label);
      f.label = makeLabel(p.name);
      f.g.add(f.label);
      f.name = p.name;
    }
    const k = Math.min(1, dt * 12);
    p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k; p.z += (p.tz - p.z) * k;
    f.g.position.set(p.x, p.y, p.z);
    f.g.rotation.y = -(p.tyaw || 0) + Math.PI;
    const moving = Math.hypot(p.tx - f.g.position.x, p.tz - f.g.position.z) > .004 || (p.f & 2);
    f.bob += dt * ((p.f & 2) ? 11 : 8) * (moving ? 1 : 0);
    const sw = moving ? Math.sin(f.bob) * .6 : 0;
    f.g.legs.forEach((l, i) => { l.rotation.x = sw * (i ? 1 : -1); });
    f.g.arms.forEach((a, i) => { a.rotation.x = -sw * (i ? 1 : -1) + ((p.f & 8) ? -1.2 : 0); });
    f.g.head.rotation.x = p.pitch || 0;
    f.g.body.position.y = (p.f & 1) ? .95 : 1.1;
  }
  for (const id of friends.keys()) if (!net.players.has(id)) dropFriend(id);
}

function netSetup() {
  net.on.block = m => { applyRemoteBlock(m.x, m.y, m.z, m.id, m.m); };
  net.on.boom = m => {
    Snd.explode();
    particles.burst(m.x - .5, m.y - .5, m.z - .5, '#3a3a3a', 40, 2.4);
    particles.burst(m.x - .5, m.y - .5, m.z - .5, '#ffb45a', 18, 2.8);
    for (const [x, y, z, id, mm] of m.blocks) applyRemoteBlock(x, y, z, id, mm);
  };
  net.on.chat = m => { chatLog(m.from + '：' + m.text); Snd.ui(); };
  net.on.sys = t => chatLog(typeof t === 'string' ? t : t.text);
  net.on.time = m => { time = m.time; weather = m.weather; weatherT = 600; };
  net.on.weather = m => { weather = m.weather; weatherT = 600; };
  net.on.hurt = m => damage(m.dmg, m.from);
  net.on.mobs = m => {
    netMobs.sync(m.a);
    const ids = new Set(m.a.map(r => r[0]));
    for (const r of m.a) if (!netMobs.map.has(r[0])) net.send({ t: 'needmob', id: r[0] });   // 近づいた生き物
    for (const id of [...netMobs.map.keys()]) if (!ids.has(id)) netMobs.remove(id);          // 遠ざかった
  };
  net.on.mobdead = m => {
    const mo = netMobs.remove(m.id);
    if (!mo) return;
    Snd.mob(mo.type);
    particles.burst(mo.g.position.x - .4, mo.g.position.y + .4, mo.g.position.z - .4, '#c0503f', 8, .7);
    if (m.by === net.id && mode === 'survival' && mo.def.drop) give(mo.def.drop, 1 + Math.floor(Math.random() * 2));
  };
  net.on.mobhurt = m => { const mo = netMobs.map.get(m.id); if (mo) mo.hurt = .3; };
  net.on.mobspawn = m => netMobs.add(m.id, m.type, m.x, m.y, m.z);
  net.on.leave = id => dropFriend(id);
  net.on.roster = () => { updateOnlineTag(); if (!$('menu').classList.contains('hidden')) updateNetPanel(); };
  net.on.close = () => {
    netMobs.clear();
    for (const id of [...friends.keys()]) dropFriend(id);
    mobs.populate();
    toast('サーバーとの接続が切れた');
    chatLog('接続が切れました。メニューからつなぎ直せます');
    updateNetPanel();
  };
}
netSetup();

// サーバーから来たブロック変更（送り返さない）
let applyingRemote = false;
function applyRemoteBlock(x, y, z, id, m) {
  applyingRemote = true;
  changeBlock(x, y, z, id, m || 0);
  applyingRemote = false;
}

async function joinServer(url, name) {
  $('netStatus').textContent = 'つないでいます…';
  try {
    const w = await net.connect(url, name);
    localStorage.setItem('blockwild-name', name);
    localStorage.setItem('blockwild-server', url);
    showLoading('みんなの世界を読み込んでいます');
    await gap();
    await createWorld(w.seed, w.delta, true);
    time = w.time; weather = w.weather; weatherT = 600;
    player.pos.set(w.spawn[0], w.spawn[1], w.spawn[2]);
    player.vel.set(0, 0, 0);
    unstick();
    mobs.clear();                                   // 生き物はサーバーのものを使う
    netMobs.clear();
    for (const [id, type, x, y, z, a] of w.mobs) netMobs.add(id, type, x, y, z, a);
    for (const p of net.players.values()) friendFor(p.id, p.name);
    updateNetPanel();
    chatLog('サーバーに参加しました。T または / で会話できます');
    advance('together');
    start();
    return true;
  } catch (e) {
    $('netStatus').textContent = 'つなげませんでした（' + (e.message || e) + '）';
    net.close();
    updateNetPanel();
    return false;
  }
}

function updateOnlineTag() {
  const el = $('onlineTag');
  const on = online();
  el.classList.toggle('hidden', !on);
  if (on) el.textContent = '● ' + (net.players.size + 1) + '人';
}

function updateNetPanel() {
  updateOnlineTag();
  const on = online();
  $('netJoin').textContent = on ? '切断する' : 'このサーバーに参加';
  $('netPanel').classList.toggle('on', on);
  if (on) {
    const names = [net.name + '（あなた）', ...[...net.players.values()].map(p => p.name)];
    $('netStatus').innerHTML = '<b>接続中</b> · ' + names.length + ' 人：' + names.join('、');
  }
}

// ---------------------------------------------------------------------------
// 天気（雨と雪）
// ---------------------------------------------------------------------------
let weather = 0;          // 0=晴れ 1=雨
let weatherT = 260 + Math.random() * 500;
let rainLevel = 0;
const RAIN_N = 1400;
const rainGeo = new THREE.BufferGeometry();
{
  const pos = new Float32Array(RAIN_N * 3);
  for (let i = 0; i < RAIN_N; i++) {
    pos[i * 3] = (Math.random() - .5) * 26;
    pos[i * 3 + 1] = Math.random() * 20;
    pos[i * 3 + 2] = (Math.random() - .5) * 26;
  }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
}
const rainMat = new THREE.PointsMaterial({ color: '#cfe6f2', size: .17, transparent: true, opacity: .0, depthWrite: false, sizeAttenuation: true });
const rainField = new THREE.Points(rainGeo, rainMat);
rainField.frustumCulled = false;
rainField.layers.set(SKY_LAYER);
scene.add(rainField);

function updateWeather(dt) {
  weatherT -= dt;
  if (weatherT <= 0) {
    weather = weather ? 0 : 1;
    weatherT = weather ? 90 + Math.random() * 260 : 300 + Math.random() * 700;
    if (playing) toast(weather ? '雨が降ってきた' : '雨が上がった');
  }
  rainLevel += ((weather ? 1 : 0) - rainLevel) * Math.min(1, dt * .6);
  rainMat.opacity = rainLevel * .8;
  rainField.visible = rainLevel > .02;
  Snd.rain(playing ? rainLevel : 0);
  if (!rainField.visible) return;

  const cold = biomeMap[clamp(player.pos.x | 0, 0, W - 1) + clamp(player.pos.z | 0, 0, W - 1) * W];
  const snowy = cold === 4 || cold === 3;             // 雪原と山岳は雪
  rainMat.color.set(snowy ? '#ffffff' : '#cfe6f2');
  rainMat.size = snowy ? .2 : .17;
  const p = rainGeo.attributes.position.array;
  const fall = snowy ? 4 : 26;
  for (let i = 0; i < RAIN_N; i++) {
    p[i * 3 + 1] -= fall * dt * (snowy ? (.6 + (i % 7) * .1) : 1);
    if (snowy) p[i * 3] += Math.sin(performance.now() * .001 + i) * dt * .6;
    if (p[i * 3 + 1] < -6) {
      p[i * 3] = (Math.random() - .5) * 26;
      p[i * 3 + 1] = 14 + Math.random() * 7;
      p[i * 3 + 2] = (Math.random() - .5) * 26;
    }
  }
  rainGeo.attributes.position.needsUpdate = true;
  rainField.position.set(Math.round(player.pos.x), Math.round(player.pos.y), Math.round(player.pos.z));
}

// ---------------------------------------------------------------------------
// 昼夜
// ---------------------------------------------------------------------------
const skyPalettes = [
  { t: 0.00, top: '#0d1727', mid: '#152944', bot: '#1d3550', sun: '#7e97c4', amb: '#0f1725', torch: '#ffb45a', fog: '#1a2d44', light: .11 }, // 深夜
  { t: 0.22, top: '#2b4a6b', mid: '#8d6f7a', bot: '#e0a071', sun: '#ffc98a', amb: '#2a2a30', torch: '#ffb45a', fog: '#c79a86', light: .45 }, // 夜明け
  { t: 0.30, top: '#3f7fd0', mid: '#9fd0e8', bot: '#d8eaf0', sun: '#fff4d8', amb: '#1e2a33', torch: '#ffb860', fog: '#a9d4e6', light: 1.0 },  // 朝
  { t: 0.50, top: '#2f74cf', mid: '#a5d6ee', bot: '#dcf0f5', sun: '#fffbe8', amb: '#20303b', torch: '#ffbb66', fog: '#b0d9ea', light: 1.0 },  // 真昼
  { t: 0.72, top: '#3a5f9e', mid: '#e39463', bot: '#f0b478', sun: '#ffb066', amb: '#2b2429', torch: '#ffb45a', fog: '#d99a74', light: .55 }, // 夕暮れ
  { t: 0.82, top: '#14213a', mid: '#27334c', bot: '#3a4258', sun: '#9586ab', amb: '#121a28', torch: '#ffb45a', fog: '#243350', light: .15 },  // 宵
  { t: 1.00, top: '#0d1727', mid: '#152944', bot: '#1d3550', sun: '#7e97c4', amb: '#0f1725', torch: '#ffb45a', fog: '#1a2d44', light: .11 },
];
const WHITE = new THREE.Color('#ffffff');
const cTop = new THREE.Color(), cMid = new THREE.Color(), cBot = new THREE.Color(), cSun = new THREE.Color(), cAmb = new THREE.Color(), cTorch = new THREE.Color(), cFog = new THREE.Color();
let dayLight = 1;
function updateSky() {
  const f = (time % DAY_LEN) / DAY_LEN;
  let a = skyPalettes[0], b = skyPalettes[1];
  for (let i = 0; i < skyPalettes.length - 1; i++) if (f >= skyPalettes[i].t && f <= skyPalettes[i + 1].t) { a = skyPalettes[i]; b = skyPalettes[i + 1]; }
  const k = (f - a.t) / Math.max(.0001, b.t - a.t);
  cTop.set(a.top).lerp(new THREE.Color(b.top), k);
  cMid.set(a.mid).lerp(new THREE.Color(b.mid), k);
  cBot.set(a.bot).lerp(new THREE.Color(b.bot), k);
  cSun.set(a.sun).lerp(new THREE.Color(b.sun), k);
  cAmb.set(a.amb).lerp(new THREE.Color(b.amb), k);
  cTorch.set(a.torch).lerp(new THREE.Color(b.torch), k);
  cFog.set(a.fog).lerp(new THREE.Color(b.fog), k);
  dayLight = lerp(a.light, b.light, k) * (1 - rainLevel * .45);

  const ang = (f - .25) * Math.PI * 2;
  const sunDir = new THREE.Vector3(Math.cos(ang) * .8, Math.sin(ang), .35).normalize();
  sunDirV.copy(sunDir);
  // 太陽が沈んだら月が照らす（弱く、青白く）
  const sunUp = sunDir.y > 0;
  lightDirV.copy(sunUp ? sunDir : sunDir.clone().negate());
  sunStrength = sunUp ? clamp(sunDir.y * 2.2, 0, 1) : clamp(-sunDir.y * 2.2, 0, 1) * .28;
  for (const m of [matSolid, matAlpha]) {
    m.uniforms.uSunDir.value.copy(lightDirV);
    m.uniforms.uSunStrength.value = sunStrength;
    m.uniforms.uPlayerPos.value.copy(player.pos);
    m.uniforms.uCamPos.value.copy(camera.position);
    m.uniforms.uHeldLight.value = heldLightLevel();
  }
  sky.material.uniforms.uTop.value.copy(cTop);
  sky.material.uniforms.uMid.value.copy(cMid);
  sky.material.uniforms.uBottom.value.copy(cBot);
  sky.material.uniforms.uSunColor.value.copy(cSun);
  sky.material.uniforms.uSunDir.value.copy(sunDir.y > -.2 ? sunDir : sunDir.clone().negate());
  sky.material.uniforms.uStars.value = clamp((.34 - dayLight) * 4.5, 0, 1) * (1 - rainLevel);
  if (rainLevel > .01) {
    const grey = new THREE.Color('#5a6a72');
    sky.material.uniforms.uTop.value.lerp(grey, rainLevel * .8);
    sky.material.uniforms.uMid.value.lerp(grey, rainLevel * .8);
    sky.material.uniforms.uBottom.value.lerp(grey, rainLevel * .7);
    cFog.lerp(grey, rainLevel * .75);
  }

  const under = blockAtEye() === ID.WATER;
  document.body.classList.toggle('underwater', under && playing);
  const far = settings.dist * CH;
  scene.fog.color.copy(under ? new THREE.Color('#1d5d75') : cFog);
  scene.fog.near = under ? 0.5 : far * (.72 - rainLevel * .28);
  scene.fog.far = under ? 16 : far * (1.12 - rainLevel * .38);
  sky.visible = !under;
  renderer.setClearColor(scene.fog.color, 1);

  for (const m of [matSolid, matAlpha]) {
    m.uniforms.uDay.value = dayLight;
    m.uniforms.uAmbient.value.copy(cAmb);
    m.uniforms.uTorchLight.value.copy(cTorch);
    m.uniforms.uSkyLight.value.copy(cSun).lerp(WHITE, .2 + dayLight * .35);
  }
  // 太陽と月を空に置く
  const camPos = camera.position;
  sunDisc.position.copy(sunDir).multiplyScalar(260).add(camPos);
  sunDisc.lookAt(camPos);
  sunDisc.visible = sunDir.y > -.25;
  moonDisc.position.copy(sunDir).multiplyScalar(-260).add(camPos);
  moonDisc.lookAt(camPos);
  moonDisc.visible = sunDir.y < .25;
  moonDisc.material.opacity = clamp(1 - dayLight * 1.2, .05, 1);
  clouds.position.set(camPos.x, H + 30, camPos.z);
  cloudTex.offset.x = (time * .004) % 1;
  clouds.material.opacity = (.72 + rainLevel * .25) * clamp(dayLight * 1.7, .15, 1);
  clouds.material.color.copy(cMid).lerp(WHITE, clamp(dayLight * .9 + .25, .3, 1));
  sun.position.copy(sunDir).multiplyScalar(90).add(player.pos);
  sun.intensity = .35 + dayLight * 1.7;
  sun.color.copy(cSun);
  hemi.intensity = .5 + dayLight * 1.8;
  hemi.color.copy(cMid);
  Snd.ambience(playing ? (under ? .3 : 1) : 0);
}
const isNight = () => dayLight < .32;

// ---------------------------------------------------------------------------
// 採掘の進行
// ---------------------------------------------------------------------------
let hit = null, mining = false, progress = 0, miningKey = '', swingT = 0, digSoundT = 0;
function swing() { swingT = .28; }

function updateMining(dt) {
  if (!mining || !hit) { progress = 0; $('progress').classList.add('hidden'); crack.visible = false; setCrackStage(-1); return; }
  const k = hit.x + ',' + hit.y + ',' + hit.z;
  if (k !== miningKey) { miningKey = k; progress = 0; }
  const total = breakSeconds(hit.id);
  if (total === Infinity) return;
  if (mode === 'survival' && !canHarvest(hit.id)) { progress = 0; return; }
  progress += dt / Math.max(.001, total);
  const tick = performance.now() / 150 | 0;
  if (tick !== digSoundT) { digSoundT = tick; Snd.dig(soundMat(hit.id)); swing(); }
  if (progress >= 1) {
    mineBlock(hit);
    progress = 0;
    hit = null;
    return;
  }
  $('progress').classList.remove('hidden');
  $('progressArc').style.strokeDashoffset = String(100.5 * (1 - progress));
  crack.visible = progress > .04;
  crack.position.set(hit.x + .5, hit.y + .5, hit.z + .5);
  setCrackStage(Math.min(9, Math.floor(progress * 10)));
}

// ---------------------------------------------------------------------------
// プレイヤーの更新
// ---------------------------------------------------------------------------
let stepT = 0, bobT = 0, shakeT = 0, wasInWater = false;
function updatePlayer(dt) {
  stepped = false;
  unstick();
  const feet = blockAtFeet(), eye = blockAtEye();
  player.inWater = feet === ID.WATER || eye === ID.WATER;
  player.sneak = !!keys.ShiftLeft && player.onGround && !player.fly;
  player.sprint = (!!keys.ControlLeft || !!keys.ShiftRight) && !player.sneak && !player.fly && (keys.KeyW || touchMove.y < -.3) && !player.inWater;

  let mx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + touchMove.x;
  let mz = (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0) + touchMove.y;
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  const moving = len > .08;

  let speed = player.fly ? 13 : player.inWater ? 3.4 : player.sprint ? 7.1 : player.sneak ? 1.8 : 4.6;
  if (mode === 'survival' && player.food <= 2) speed *= .62;
  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  const vx = (mx * cos + mz * sin) * speed;
  const vz = (-mx * sin + mz * cos) * speed;

  if (player.fly) {
    player.vel.y = ((keys.Space ? 1 : 0) - (keys.ShiftLeft ? 1 : 0)) * 10;
  } else if (player.inWater) {
    player.vel.y -= dt * 7;
    if (keys.Space) player.vel.y = 3.6;
    player.vel.y = Math.max(player.vel.y, -3.5);
  } else {
    player.vel.y -= dt * 26;
    if (keys.Space && player.onGround) { player.vel.y = 8.4; player.onGround = false; Snd.step(soundMat(getBlock(Math.floor(player.pos.x), Math.floor(player.pos.y - .2), Math.floor(player.pos.z)))); }
  }
  const fallSpeed = player.vel.y;
  const wasGround = player.onGround;

  moveAxis('x', vx * dt);
  moveAxis('z', vz * dt);
  moveAxis('y', player.vel.y * dt);

  // 落下ダメージ
  if (!wasGround && player.onGround && fallSpeed < -15 && !player.inWater && mode === 'survival') {
    damage(Math.floor((-fallSpeed - 14) / 2.2), '高いところから落ちた');
  }
  if (player.pos.y < -4) { player.pos.y = H - 2; player.vel.y = 0; }

  // 足音と歩行の揺れ
  if (moving && player.onGround) {
    stepT += dt * (player.sprint ? 9 : 6.4);
    if (stepT > 1) {
      stepT = 0;
      const under = getBlock(Math.floor(player.pos.x), Math.floor(player.pos.y - .2), Math.floor(player.pos.z));
      Snd.step(soundMat(under));
      if (player.sprint && under) particles.burst(player.pos.x - .5, player.pos.y - .3, player.pos.z - .5, blockColor(under), 3, .25);
    }
    bobT += dt * (player.sprint ? 11 : 8);
  }
  // 水に飛び込んだしぶき
  if (player.inWater && !wasInWater && player.vel.y < -3) {
    particles.burst(player.pos.x - .5, player.pos.y + .2, player.pos.z - .5, '#a9d8f0', 18, 1.2);
    Snd.splash();
  }
  wasInWater = player.inWater;

  // 触れると痛いブロック（サボテン・溶岩・火）
  const bx = Math.floor(player.pos.x), bz = Math.floor(player.pos.z);
  for (let y = 0; y < 2; y++) {
    const t = getBlock(bx, Math.floor(player.pos.y) + y, bz);
    const hurtAmt = blocks[t]?.hurt;
    if (!hurtAmt) continue;
    damage(hurtAmt, t === ID.LAVA ? '溶岩に落ちた' : t === ID.FIRE ? '燃えてしまった' : 'サボテンに刺さった');
    if (t === ID.LAVA) { player.vel.y = Math.max(player.vel.y, -1.2); particles.burst(bx, player.pos.y, bz, '#ff9a3c', 4, .5); }
  }

  // 息
  if (mode === 'survival') {
    if (eye === ID.WATER) {
      player.air -= dt * .8;
      if (player.air <= 0) { player.air = 0; damage(2, '溺れた'); }
    } else if (player.air < 10) player.air = Math.min(10, player.air + dt * 4);

    // 満腹度と自然回復
    player.food -= dt * (player.sprint ? .022 : moving ? .011 : .005);
    if (player.food <= 0) {
      player.food = 0;
      player.starveT += dt;
      if (player.starveT > 4) { player.starveT = 0; damage(1, 'おなかがすいた'); }
    }
    if (player.health < 20 && player.food > 14) {
      player.regenT += dt;
      if (player.regenT > 3.5) { player.regenT = 0; player.health = Math.min(20, player.health + 1); updateVitals(); }
    }
    player.hurtCd = Math.max(0, player.hurtCd - dt);
  }

  // カメラ（F5 で一人称・背後・正面）
  const bob = settings.bob && player.onGround && moving ? Math.sin(bobT) * .035 : 0;
  const eyeY = player.pos.y + (player.sneak ? EYE - .22 : EYE) + bob;
  const wantFov = settings.fov + (player.sprint ? 9 : 0) + (drawing ? -12 * Math.min(1, drawing) : 0);
  if (Math.abs(camera.fov - wantFov) > .05) { camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 9); camera.updateProjectionMatrix(); layoutHeld(); }
  shakeT = Math.max(0, shakeT - dt);
  const shake = shakeT > 0 ? Math.sin(shakeT * 60) * shakeT * .12 : 0;
  camera.rotation.set(player.pitch + shake * .5, player.yaw, (settings.bob ? Math.cos(bobT) * .008 : 0) + shake);
  if (player.view === 0) {
    camera.position.set(player.pos.x, eyeY, player.pos.z);
  } else {
    const back = player.view === 1 ? 1 : -1;
    camera.getWorldDirection(dir);
    let d = 3.6;
    for (let t = .3; t <= 3.6; t += .2) {                       // 壁にめり込まない距離を探す
      const px = player.pos.x - dir.x * t * back, py = eyeY - dir.y * t * back, pz = player.pos.z - dir.z * t * back;
      if (isSolid(getBlock(Math.floor(px), Math.floor(py), Math.floor(pz)))) { d = Math.max(.6, t - .3); break; }
      d = t;
    }
    camera.position.set(player.pos.x - dir.x * d * back, eyeY - dir.y * d * back + .15, player.pos.z - dir.z * d * back);
    if (back < 0) camera.rotation.set(-player.pitch, player.yaw + Math.PI, 0);
  }
  avatar.visible = player.view !== 0;
  if (avatar.visible) {
    avatar.position.set(player.pos.x, player.pos.y, player.pos.z);
    avatar.rotation.y = -player.yaw + Math.PI;
    const sw = moving ? Math.sin(bobT * .9) * .6 : 0;
    avatar.legs.forEach((l, i) => { l.rotation.x = sw * (i ? 1 : -1); });
    avatar.arms.forEach((a, i) => { a.rotation.x = -sw * (i ? 1 : -1) + (swingT > 0 ? -1.2 : 0); });
    avatar.head.rotation.x = player.pitch;
    avatar.body.position.y = player.sneak ? .95 : 1.1;
  }
  {
    const s = swingT > 0 ? Math.sin((1 - swingT / .28) * Math.PI) : 0;
    const bobY = moving ? Math.sin(bobT) * .012 : 0;
    if (held) {
      held.position.set(heldBase.x - s * .08, heldBase.y - s * .1 + bobY, heldBase.z + s * .06);
      held.rotation.set(.22 + s * .9, -.42, .12);
    }
    arm.visible = !!held;
    arm.position.y = heldBase.y - arm.scale.y * .25 - s * .1 + bobY;
    arm.rotation.x = -.5 + s * .8;
  }
  swingT = Math.max(0, swingT - dt);
}

// ---------------------------------------------------------------------------
// 入力
// ---------------------------------------------------------------------------
const touchMove = { x: 0, y: 0 };
const isTouch = matchMedia('(pointer:coarse)').matches;
if (isTouch) document.body.classList.add('touch');

addEventListener('keydown', e => {
  if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'F3'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  if (e.code === 'Escape') { if (bagOpen || !$('settings').classList.contains('hidden')) resume(); else if (playing) pause(); return; }
  if (e.code === 'KeyE') { if (bagOpen) resume(); else if (playing) openBag(); return; }
  if (bagOpen && /^Digit[1-9]$/.test(e.code) && hoverCell) {
    const cont = hoverCell.dataset.cont;
    if (cont !== 'creative' && cont !== 'result') swapToHotbar(cont, +hoverCell.dataset.i, +e.code.slice(-1) - 1);
    return;
  }
  if (e.code === 'F3') { $('debug').classList.toggle('hidden'); return; }
  if (e.code === 'F1') { document.body.classList.toggle('nohud'); return; }
  if (e.code === 'F2') { wantShot = true; toast('スクリーンショットを保存中…'); return; }
  if (!bagOpen && playing && (e.code === 'KeyT' || e.code === 'Slash')) { e.preventDefault(); openChat(); return; }
  if (e.code === 'F5') { player.view = (player.view + 1) % 3; toast(['一人称', '三人称（背後）', '三人称（正面）'][player.view]); return; }
  if (!playing) return;
  keys[e.code] = true;
  if (/^Digit[1-9]$/.test(e.code)) { sel = +e.code.slice(-1) - 1; updateHotbar(); Snd.ui(); }
  if (e.code === 'KeyF') {
    if (mode === 'creative') { player.fly = !player.fly; player.vel.y = 0; toast(player.fly ? '飛行：Space で上昇 / Shift で下降' : '飛行を終了'); }
    else toast('飛行はクリエイティブだけ');
  }
  if (e.code === 'KeyQ') {                     // 足元に1つ捨てる
    const st = bag.get(sel);
    if (st) {
      camera.getWorldDirection(dir);
      drops.spawn(st.id, 1, player.pos.x + dir.x, player.pos.y + 1.2, player.pos.z + dir.z, .5, st.dur);
      if (mode !== 'creative') bag.consumeAt(sel);
      updateHotbar();
    }
  }
  if (e.code === 'KeyP') doSave();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; touchMove.x = touchMove.y = 0; });
document.addEventListener('visibilitychange', () => { if (document.hidden && playing) pause(); });

$('chatInput').addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter') { const v = $('chatInput').value; closeChat(); if (v.trim()) runCommand(v); }
  else if (e.key === 'Escape') closeChat();
});
$('respawn').onclick = respawn;
$('deathMenu').onclick = () => { $('death').classList.add('hidden'); respawn(); pause(); };

const canvas = $('game');
canvas.oncontextmenu = e => e.preventDefault();

// ポインタロック（マウスを画面に固定する仕組み）は環境によっては使えない。
// 取れなくても遊べるように、ロックの有無で操作を分岐させず、
// ロックが無いときはドラッグで視点を回せるようにしている。
let hadLock = false;
const locked = () => document.pointerLockElement === canvas;
function tryLock() {
  // 画面ボタンを出しているときはマウスを固定しない（ボタンが押せなくなるため）
  if (isTouch || locked() || settings.buttons) return;
  const r = canvas.requestPointerLock?.();
  if (r?.catch) r.catch(() => freeLook());
}
function freeLook() {
  if (document.body.classList.contains('freelook')) return;
  document.body.classList.add('freelook');
  if (!settings.buttons) { settings.buttons = true; saveSettings(); applyButtons(); }
  toast('ドラッグで視点、画面のボタンで操作できます');
  hint('マウスを押したまま動かすと見回せる。移動は W A S D か左下のスティック');
}
document.addEventListener('pointerlockchange', () => {
  if (locked()) {
    hadLock = true;
    document.body.classList.remove('freelook');
    $('hint').classList.remove('show');
    return;
  }
  // ロックが外れてもゲームは止めない。止めるとタブ切り替えや Esc のたびに
  // 「動かない」状態に見えてしまうため、ドラッグ視点に切り替えて続行する。
  if (hadLock && playing && !bagOpen) {
    hadLock = false;
    document.body.classList.add('freelook');
    hint('視点はドラッグで動かせます。クリックでマウス固定に戻る／Esc か Ⅱ でメニュー', false);
  }
});
document.addEventListener('pointerlockerror', freeLook);

let dragging = false, lastX = 0, lastY = 0, dragId = null;
// ポインタの捕捉は環境によって例外を投げる。ここで落とすと
// この後の「壊す・置く」まで実行されなくなるので、必ず握りつぶす。
const capture = (el, id) => { try { el.setPointerCapture?.(id); } catch { /* 無視 */ } };
canvas.addEventListener('pointerdown', e => {
  if (!playing) return;
  Snd.resume();
  if (e.pointerType === 'touch') {
    if (e.clientX < innerWidth * .38) return;      // 左下はスティックの領域
    dragId = e.pointerId; dragging = true; lastX = e.clientX; lastY = e.clientY;
    capture(canvas, e.pointerId);
    return;
  }
  if (!locked()) {                                  // ロックが無くてもドラッグで見回せる
    dragId = e.pointerId; dragging = true; lastX = e.clientX; lastY = e.clientY;
    capture(canvas, e.pointerId);
    tryLock();
  }
  if (e.button === 0) { mining = true; progress = 0; tryAttack(); }
  else if (e.button === 2) { if (!startDraw()) rightClick(); }
});
addEventListener('pointerup', e => {
  if (e.pointerId === dragId) { dragging = false; dragId = null; }
  mining = false;
  releaseDraw();
});
addEventListener('pointercancel', () => { dragging = false; dragId = null; mining = false; });
addEventListener('pointermove', e => {
  if (!playing) return;
  const s = settings.sens / 9000;
  if (locked()) {
    player.yaw -= e.movementX * s;
    player.pitch -= e.movementY * s;
  } else if (dragging && e.pointerId === dragId) {
    player.yaw -= (e.clientX - lastX) * s * 2.6;
    player.pitch -= (e.clientY - lastY) * s * 2.6;
    lastX = e.clientX; lastY = e.clientY;
  } else return;
  player.pitch = clamp(player.pitch, -1.54, 1.54);
});
addEventListener('wheel', e => {
  if (!playing) return;
  sel = (sel + (e.deltaY > 0 ? 1 : 8)) % 9;
  updateHotbar();
}, { passive: true });

// --- 弓 ---------------------------------------------------------------------
let drawing = 0;
function startDraw() {
  const st = bag.get(sel);
  if (!st || !items[st.id]?.bow) return false;
  if (mode === 'survival' && bag.count(IT.ARROW) <= 0) { toast('矢が無い'); return true; }
  drawing = .0001;
  return true;
}
function releaseDraw() {
  if (!drawing) return;
  const power = Math.min(1, drawing / 1.1);
  drawing = 0;
  if (power < .15) return;
  if (mode === 'survival' && !bag.remove(IT.ARROW, 1)) return;
  camera.getWorldDirection(dir);
  const o = camera.getWorldPosition(new THREE.Vector3());
  arrows.shoot(o.x + dir.x * .6, o.y + dir.y * .6 - .1, o.z + dir.z * .6, dir.x, dir.y, dir.z, power, true);
  Snd.bow(power);
  damageTool(1);
  updateHotbar();
}

// 右クリック：設備を使う → 食べる → 置く
function rightClick() {
  if (!playing) return;
  if (hit && !keys.ShiftLeft && interact(hit)) { swing(); return; }
  if (useItem()) return;
  if (hit) placeBlock(hit);
  else toast('近くのブロックに向けて置こう');
}

function tryAttack() {
  camera.getWorldDirection(dir);
  const o = camera.getWorldPosition(new THREE.Vector3());
  if (online()) {
    const rm = netMobs.pick(o, dir, 4);
    if (rm && (!hit || hit.dist > o.distanceTo(rm.g.position) - .6)) {
      const t = currentTool();
      net.send({ t: 'mobhit', id: rm.id, dmg: t?.dmg || (t ? 2 : 1.5) });
      rm.hurt = .3;
      Snd.hit(); swing();
      if (t) damageTool(1);
      mining = false;
      return true;
    }
    for (const p of net.players.values()) {           // 友達を殴る
      const d = Math.hypot(p.x - o.x, p.y + 1 - o.y, p.z - o.z);
      if (d > 3.6) continue;
      const to = new THREE.Vector3(p.x - o.x, p.y + 1 - o.y, p.z - o.z);
      if (to.clone().normalize().dot(dir) < .93) continue;
      const t = currentTool();
      net.send({ t: 'pvp', id: p.id, dmg: t?.dmg || 1.5 });
      Snd.hit(); swing();
      mining = false;
      return true;
    }
  }
  const m = mobs.pick(o, dir, 4);
  if (m && (!hit || hit.dist > o.distanceTo(m.g.position) - .6)) { attack(m); mining = false; return true; }
  if (mode === 'creative' && hit) { mineBlock(hit); swing(); progress = 0; hit = null; return true; }
  return false;
}

// スティック
const stick = $('stick'), knob = $('stickKnob');
let stickId = null;
stick?.addEventListener('pointerdown', e => {
  e.preventDefault();
  stickId = e.pointerId;
  capture(stick, e.pointerId);
  moveStick(e);
});
stick?.addEventListener('pointermove', e => { if (e.pointerId === stickId) moveStick(e); });
stick?.addEventListener('pointerup', () => { stickId = null; touchMove.x = touchMove.y = 0; knob.style.transform = ''; });
stick?.addEventListener('pointercancel', () => { stickId = null; touchMove.x = touchMove.y = 0; knob.style.transform = ''; });
function moveStick(e) {
  const r = stick.getBoundingClientRect();
  let dx = (e.clientX - r.left - r.width / 2) / (r.width / 2);
  let dy = (e.clientY - r.top - r.height / 2) / (r.height / 2);
  const l = Math.hypot(dx, dy);
  if (l > 1) { dx /= l; dy /= l; }
  touchMove.x = dx; touchMove.y = dy;
  knob.style.transform = `translate(${dx * 34}px,${dy * 34}px)`;
}
const holdButton = (el, down, up) => {
  el.addEventListener('pointerdown', e => { e.preventDefault(); capture(el, e.pointerId); down(); });
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('pointerleave', up);
};
holdButton($('touchJump'), () => { keys.Space = true; }, () => { keys.Space = false; });
holdButton($('touchMine'), () => { if (playing && !tryAttack()) mining = true; }, () => { mining = false; });
$('touchPlace').addEventListener('click', () => { if (playing) rightClick(); });
$('touchBag').addEventListener('click', () => (bagOpen ? resume() : openBag()));
$('touchFly').addEventListener('click', () => {
  if (mode !== 'creative') { toast('飛行はクリエイティブだけ'); return; }
  player.fly = !player.fly; player.vel.y = 0;
  toast(player.fly ? '飛行：跳ぶ で上昇' : '飛行を終了');
});
$('touchPrev').addEventListener('click', () => { sel = (sel + 8) % 9; updateHotbar(); Snd.ui(); });
$('touchNext').addEventListener('click', () => { sel = (sel + 1) % 9; updateHotbar(); Snd.ui(); });

// ---------------------------------------------------------------------------
// メニューまわり
// ---------------------------------------------------------------------------
function start() {
  closeOverlays();
  $('menu').classList.add('hidden');
  $('loading').classList.add('hidden');
  document.body.classList.add('playing');
  playing = true; started = true;
  camera.fov = settings.fov; camera.updateProjectionMatrix(); layoutHeld();
  Snd.resume();
  Snd.music(settings.music > 0);
  tryLock();
  updateHotbar(); updateVitals();
}
const resume = () => { closeOverlays(); start(); };
function pause() {
  playing = false; mining = false;
  Snd.music(false);
  for (const k in keys) keys[k] = false;
  touchMove.x = touchMove.y = 0;
  document.exitPointerLock?.();
  document.body.classList.remove('playing');
  $('menu').classList.remove('hidden');
  $('play').innerHTML = '冒険を続ける <span>↗</span>';
  refreshSaveInfo();
}

function applyMode(m, keepBar = false) {
  mode = m;
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  if (m === 'survival') {
    player.fly = false;
    if (!keepBar) bag.clear();
  } else if (!keepBar) {
    bag.clear();
    CREATIVE_BAR.forEach((id, i) => bag.set(i, { id, n: maxStack(id) }));
    player.health = 20; player.food = 20; player.air = 10;
  }
  updateHotbar(); updateVitals();
}

// マルチプレイの操作
$('netName').value = localStorage.getItem('blockwild-name') || '';
$('netCode').value = localStorage.getItem('blockwild-code') || '';
$('netJoin').onclick = async () => {
  if (online()) {
    net.close(); netMobs.clear();
    for (const id of [...friends.keys()]) dropFriend(id);
    mobs.populate();
    updateNetPanel();
    $('netStatus').textContent = '切断しました';
    return;
  }
  const name = ($('netName').value || '').trim().slice(0, 16) || 'ぼうけんしゃ';
  $('netName').value = name;
  const raw = ($('netCode').value || '').trim();
  const url = raw ? decodeCode(raw) : Net.defaultURL();
  if (!url) { $('netStatus').textContent = 'そのコードは読めません。ホストの画面のコードを確かめて'; return; }
  localStorage.setItem('blockwild-code', raw);
  $('netJoin').disabled = true;
  await joinServer(url, name);
  $('netJoin').disabled = false;
};
for (const id of ['netCode', 'netName']) $(id).addEventListener('keydown', e => { if (e.key === 'Enter') $('netJoin').click(); });

// 自分がホストなら、配る用のコードを画面に出す
async function loadHostCode() {
  try {
    const r = await fetch('api/info', { cache: 'no-store' });
    if (!r.ok) return;
    const info = await r.json();
    const code = info.net || info.lan?.[0]?.code;
    if (!code) return;
    $('hostCode').classList.remove('hidden');
    $('hostCodeText').textContent = pretty(code);
    $('hostCodeNote').textContent = info.net
      ? 'どこからでもこのコードで入れます。最大 ' + info.max + ' 人。'
      : '同じ Wi-Fi の友達はこのコードで入れます。' + (info.lan.length > 1 ? '（' + info.lan.map(v => pretty(v.code)).join(' / ') + '）' : '');
    $('copyCode').onclick = () => {
      navigator.clipboard?.writeText(pretty(code));
      $('copyCode').textContent = 'コピーした';
      setTimeout(() => ($('copyCode').textContent = 'コピー'), 1600);
    };
    if (!$('netCode').value) $('netCode').value = pretty(code);
  } catch { /* ふつうの静的配信ならコードは出さない */ }
}
loadHostCode();
setInterval(() => { if (!$('menu').classList.contains('hidden') && $('hostCode').classList.contains('hidden')) loadHostCode(); }, 20000);

$('play').onclick = () => start();
$('menuButton').onclick = () => (playing ? pause() : start());
document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { applyMode(b.dataset.mode); Snd.ui(); });
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => { if (started) resume(); else closeOverlays(); });
$('hotbar').onclick = e => { const b = e.target.closest('[data-slot]'); if (b) { sel = +b.dataset.slot; updateHotbar(); } };
// 持ち物画面のマス目：左クリックで丸ごと、右クリックで1個ずつ
const invScreen = $('inventory');
invScreen.addEventListener('mousedown', e => {
  const cell = e.target.closest('[data-cont]');
  if (cell) {
    e.preventDefault();
    const cont = cell.dataset.cont, i = +cell.dataset.i;
    if (e.shiftKey && cont !== 'creative' && cont !== 'result') quickMove(cont, i);
    else clickSlot(cont, i, e.button === 2);
    Snd.ui(e.button !== 2);
    return;
  }
  const rec = e.target.closest('[data-recipe]');
  if (rec) { e.preventDefault(); layoutRecipe(+rec.dataset.recipe); }
});
invScreen.addEventListener('contextmenu', e => e.preventDefault());
// 持ち物画面で数字キーを押すと、指しているマスをホットバーへ
invScreen.addEventListener('mouseover', e => { hoverCell = e.target.closest('[data-cont]'); });
let hoverCell = null;
addEventListener('mousemove', e => {
  if (!cursor) return;
  const el = $('cursorStack');
  el.style.left = e.clientX + 'px';
  el.style.top = e.clientY + 'px';
});

// 設定
function bindOption(id, out, key, fmt, apply) {
  const el = $(id), o = $(out);
  el.value = settings[key];
  o.textContent = fmt(settings[key]);
  el.oninput = () => {
    settings[key] = el.type === 'checkbox' ? el.checked : +el.value;
    o.textContent = fmt(settings[key]);
    apply?.(settings[key]);
    saveSettings();
  };
}
bindOption('optDist', 'outDist', 'dist', v => v + ' チャンク', () => cullChunks());
bindOption('optFov', 'outFov', 'fov', v => v + '°', v => { camera.fov = v; camera.updateProjectionMatrix(); layoutHeld(); });
bindOption('optSens', 'outSens', 'sens', v => String(v));
bindOption('optVol', 'outVol', 'vol', v => v + '%', v => Snd.setVolume(v / 100));
bindOption('optMusic', 'outMusic', 'music', v => v + '%', v => { Snd.musicVolume(v / 100); Snd.music(v > 0 && playing); });
function applyButtons() {
  const on = !!settings.buttons && !isTouch;
  document.body.classList.toggle('buttons', on);
  $('optButtons').checked = !!settings.buttons;
  if (on && locked()) document.exitPointerLock?.();   // カーソルを出してボタンを押せるように
  if (on) document.body.classList.add('freelook');
  else if (playing) tryLock();
}
$('optButtons').onchange = () => { settings.buttons = $('optButtons').checked; saveSettings(); applyButtons(); };
for (const [id, key] of [['optShadows', 'shadows'], ['optBloom', 'bloom']]) {
  $(id).checked = !!settings[key];
  $(id).onchange = () => { settings[key] = $(id).checked; saveSettings(); };
}
$('optHints').checked = settings.hints;
$('optHints').onchange = () => { settings.hints = $('optHints').checked; saveSettings(); };
$('optBob').checked = settings.bob;
$('optBob').onchange = () => { settings.bob = $('optBob').checked; saveSettings(); };
$('settingsBtn').onclick = () => $('settings').classList.remove('hidden');
Snd.setVolume(settings.vol / 100);
Snd.musicVolume(settings.music / 100);

// ---------------------------------------------------------------------------
// セーブ／ロード
// ---------------------------------------------------------------------------
const collectState = () => ({
  v: 3, seed, time, mode, sel, stats,
  bag: bag.toJSON(),
  armor: armor.map(st => (st ? [st.id, st.n, st.dur ?? -1] : 0)),
  crops: [...crops],
  earned: [...earned],
  spawnPoint, weather,
  drops: drops.toJSON(),
  chests: [...chests].map(([k, list]) => [k, list.map(st => (st ? [st.id, st.n, st.dur ?? -1] : 0))]),
  furnaces: [...furnaces].map(([k, f]) => [k, f.slots.map(st => (st ? [st.id, st.n] : 0)), f.fuel, f.cook]),
  p: player.pos.toArray(), yaw: player.yaw, pitch: player.pitch,
  health: player.health, food: player.food, air: player.air,
});
function applyState(s) {
  seed = s.seed; time = s.time; sel = s.sel ?? 0;
  stats = s.stats || stats;
  bag.clear(); drops.clear(); chests.clear(); furnaces.clear();
  if (s.bag) bag.fromJSON(s.bag);
  else if (s.inv) {                         // 旧形式（v2）からの引き継ぎ
    (s.hotbar || []).forEach((id, i) => { if (id) bag.set(i, { id, n: Math.max(1, s.inv[id] || 1) }); });
    for (const [id, n] of Object.entries(s.inv)) if (n > 0) bag.add(+id, Math.min(n, 640));
  }
  if (s.drops) drops.fromJSON(s.drops);
  armor.fill(null);
  (s.armor || []).forEach((v, i) => { if (v) armor[i] = { id: v[0], n: v[1], ...(v[2] >= 0 ? { dur: v[2] } : {}) }; });
  crops.clear();
  (s.crops || []).forEach(([k, v]) => crops.set(k, v));
  earned.clear();
  (s.earned || []).forEach(k => earned.add(k));
  spawnPoint = s.spawnPoint || null;
  weather = s.weather || 0;
  (s.chests || []).forEach(([k, list]) => chests.set(k, list.map(v => (v ? { id: v[0], n: v[1], ...(v[2] >= 0 ? { dur: v[2] } : {}) } : null))));
  (s.furnaces || []).forEach(([k, list, fuel, cook]) => {
    const [x, y, z] = k.split(',').map(Number);
    const f = furnaceAt(x, y, z);
    f.slots = list.map(v => (v ? { id: v[0], n: v[1] } : null));
    f.fuel = fuel; f.cook = cook;
  });
  player.pos.fromArray(s.p); player.yaw = s.yaw; player.pitch = s.pitch;
  player.health = s.health ?? 20; player.food = s.food ?? 20; player.air = s.air ?? 10;
  player.vel.set(0, 0, 0); player.fly = false;
  setSeed(seed);
  applyMode(s.mode || 'creative', true);
}
function rebuildAll() {
  for (const k of [...chunks.keys()]) disposeChunk(k);
  pending.clear();
  for (let cx = 0; cx < CX; cx++) for (let cz = 0; cz < CX; cz++)
    for (let cy = 0; cy < SECT; cy++) pending.add(key(cx, cy, cz));
  mapDirty = true;
}
function refreshSaveInfo() {
  const at = Save.savedAt();
  $('saveInfo').textContent = at ? '最後の保存：' + at.toLocaleString('ja-JP') : 'PC：マウスで視点 ／ スマホ：右側をドラッグ';
}
function doSave() {
  try {
    const bytes = Save.saveLocal(collectState());
    toast('この端末に保存した（' + Math.round(bytes / 1024) + ' KB）');
    refreshSaveInfo();
  } catch { toast('保存できなかった。ブラウザの空き容量を確認して'); }
}
$('save').onclick = doSave;
$('load').onclick = async () => {
  try {
    const s = Save.loadLocal();
    if (!s) { toast('保存された世界がない'); return; }
    await reloadFromState(s);
    toast('保存した世界を再開した');
  } catch { toast('保存データを読み込めなかった'); }
};
$('export').onclick = () => { Save.exportFile(collectState()); toast('ファイルに書き出した'); };
$('import').onclick = async () => {
  try { await reloadFromState(await Save.importFile()); toast('ファイルから読み込んだ'); }
  catch { toast('このファイルは読み込めない'); }
};
// 村のチェストに宝を入れる
function stockVillageChests() {
  const loot = [[IT.BREAD, 1, 3], [IT.WHEAT_ITEM, 2, 6], [IT.SEEDS, 2, 5], [IT.IRON, 1, 3], [IT.COAL, 3, 8], [ID.TORCH, 4, 8], [IT.LEATHER, 1, 3], [IT.ARROW, 4, 10], [IT.STONE_HOE, 1, 1], [IT.HELM_L, 1, 1]];
  for (const v of villages) {
    for (let x = v.x - 16; x <= v.x + 16; x++) for (let z = v.z - 16; z <= v.z + 16; z++) for (let y = SEA; y < H; y++) {
      if (getBlock(x, y, z) !== ID.CHEST) continue;
      const c = chestAt(x, y, z);
      for (let k = 0; k < 3 + Math.floor(Math.random() * 3); k++) {
        const [id, a, b2] = loot[Math.floor(Math.random() * loot.length)];
        const slot = Math.floor(Math.random() * 27);
        if (!c[slot]) c[slot] = { id, n: a + Math.floor(Math.random() * (b2 - a + 1)), ...(items[id]?.dur ? { dur: items[id].dur } : {}) };
      }
    }
  }
}

function spawnVillagers() {
  for (const v of villages) {
    for (let i = 0; i < 6; i++) {
      const x = v.x + (Math.random() - .5) * 20, z = v.z + (Math.random() - .5) * 20;
      const y = surface(Math.floor(x), Math.floor(z));
      if (y <= SEA || getBlock(Math.floor(x), y + 1, Math.floor(z))) continue;
      const m = mobs.spawn('villager', x, y + 1, z);
      m.home = { x: v.x, z: v.z };
    }
  }
}

async function reloadFromState(s) {
  showLoading('世界を組み立てています');
  await gap();
  applyState(s);
  relightAll();
  rebuildAll();
  mobs.populate();
  spawnVillagers();
  await buildNear(4, .55);
  start();
}

// ---------------------------------------------------------------------------
// 世界の生成
// ---------------------------------------------------------------------------
const TIPS = [
  '暗いところにはゾンビが湧く。松明を持って潜ろう。',
  '木を殴ると原木が手に入る。まずは作業台から。',
  'F キーでクリエイティブ飛行。山の上から島を眺めてみて。',
  '水の中では息が続かない。深追いは禁物。',
  'ランタンや松明は、置いた場所から本当に光が広がる。',
  '白い花や赤い花で羊毛を染められる。',
  '島の外周はすべて海。端まで歩けば水平線が見える。',
  '村には井戸と畑と家がある。チェストの中身は持って帰ろう。',
  '村人に小麦3つを見せると、パンと交換してくれる。',
  '松明を手に持つと、置かなくても周りが明るい。',
  'Shift で縁から落ちない。Ctrl で走る。F5 で自分の姿が見える。',
  'T でコマンド。time night と打つと夜になる。',
];
function showLoading(msg) {
  $('loading').classList.remove('hidden');
  $('menu').classList.add('hidden');
  if (msg) $('loadMsg').textContent = msg;
  $('loadTip').textContent = TIPS[(Math.random() * TIPS.length) | 0];
}
const gap = () => new Promise(r => requestAnimationFrame(() => r()));
function setProgress(p, msg) {
  $('loadBar').style.width = (p * 100).toFixed(1) + '%';
  if (msg) $('loadMsg').textContent = msg;
}

async function buildNear(radius, fromP) {
  const list = [];
  const py = player.pos.y / CH;
  for (let cx = 0; cx < CX; cx++) for (let cz = 0; cz < CX; cz++) {
    const d = Math.hypot(cx + .5 - player.pos.x / CH, cz + .5 - player.pos.z / CH);
    if (d > radius) continue;
    for (let cy = 0; cy < SECT; cy++) list.push([d + Math.abs(cy - py) * .7, cx, cy, cz]);
  }
  list.sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < list.length; i++) {
    buildOne(list[i][1], list[i][2], list[i][3]);
    pending.delete(key(list[i][1], list[i][2], list[i][3]));
    if (i % 6 === 0) { setProgress(fromP + (1 - fromP) * (i / list.length), '世界を組み立てています'); await gap(); }
  }
}

async function createWorld(newSeed, deltaBytes, multi) {
  showLoading('大地を持ち上げています');
  setProgress(0);
  await gap();
  seed = newSeed >>> 0;
  setSeed(seed);
  const it = generate();
  for (;;) {
    const { value, done } = it.next();
    if (done) break;
    setProgress(value.p, value.msg);
    await gap();
  }
  if (deltaBytes && deltaBytes.length > 1) {        // みんなが変えたぶんを反映
    setProgress(.89, 'みんなが作ったものを重ねています');
    await gap();
    const dv = new DataView(deltaBytes.buffer, deltaBytes.byteOffset, deltaBytes.byteLength);
    for (let o = 1; o + 5 < deltaBytes.length; o += 6) {
      const i = dv.getUint32(o, true);
      const y = Math.floor(i / (W * W)), z = Math.floor((i % (W * W)) / W), x = i % W;
      setRaw(x, y, z, deltaBytes[o + 4], deltaBytes[o + 5]);
    }
  }
  setProgress(.9, '光を通しています');
  await gap();
  relightAll();
  const s = findSpawn();
  if (villages.length && !multi) {                              // 村が見える距離から始める
    const v = villages[0];
    const x = clamp(v.x + 26, 4, W - 4), z = clamp(v.z + 26, 4, W - 4);
    const y = surface(x, z);
    if (y > SEA && !getBlock(x, y + 1, z) && !getBlock(x, y + 2, z)) { s[0] = x + .5; s[1] = y + 1.02; s[2] = z + .5; }
    player.yaw = Math.atan2(x - v.x, v.z - z) + Math.PI;
  }
  player.pos.set(s[0], s[1], s[2]);
  player.vel.set(0, 0, 0);
  if (!villages.length) player.yaw = Math.random() * 6.28;
  player.pitch = -.1;
  player.health = 20; player.food = 20; player.air = 10;
  time = 300;
  if (!multi) { mobs.populate(); spawnVillagers(); }
  else mobs.clear();
  stockVillageChests();
  rebuildAll();
  await buildNear(3.2, .92);
  mapDirty = true;
  setProgress(1, '世界ができました');
  await gap();
  $('loading').classList.add('hidden');
  $('menu').classList.remove('hidden');
  $('worldName').textContent = biomeName[biomeMap[(player.pos.x | 0) + (player.pos.z | 0) * W]] + 'から、はじまる。';
  ready = true;
  refreshSaveInfo();
}

$('new').onclick = async () => {
  if (started && !confirm('今の世界を作り直しますか？ 保存した世界は残ります。')) return;
  stats = { mined: 0, placed: 0, hunted: 0 };
  started = false; playing = false;
  bag.clear();
  drops.clear();
  arrows.clear();
  armor.fill(null);
  crops.clear();
  chests.clear(); furnaces.clear();
  if (mode === 'creative') CREATIVE_BAR.forEach((id, i) => bag.set(i, { id, n: maxStack(id) }));
  $('play').innerHTML = '世界に入る <span>↗</span>';
  await createWorld((Math.random() * 1e9) | 0);
  toast('新しい島へようこそ');
};

// ---------------------------------------------------------------------------
// メインループ
// ---------------------------------------------------------------------------
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  layoutHeld();
});

let wantShot = false, fluidT = 0, shadowReady = false;
function saveScreenshot() {
  try {
    renderer.domElement.toBlob(blob => {
      if (!blob) { toast('保存できなかった'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `blockwild-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('スクリーンショットを保存した');
    }, 'image/png');
  } catch { toast('保存できなかった'); }
}

let last = performance.now(), frames = 0, fps = 60, fpsT = 0, hudT = 0, spawnT = 0, furnaceT = 0;
// 端末が重いときは自動で解像度を落とし、軽ければ戻す
let pixelScale = Math.min(devicePixelRatio, 2), slowT = 0, fastT = 0, drawCalls = 0, drawTris = 0, shadowsAutoOff = false;
function autoQuality() {
  if (!playing) return;
  if (fps < 34) { slowT++; fastT = 0; } else if (fps > 55) { fastT++; slowT = 0; } else { slowT = fastT = 0; }
  const min = .6, max = Math.min(devicePixelRatio, 2);
  if (slowT >= 4 && settings.shadows && !shadowsAutoOff) { settings.shadows = false; shadowsAutoOff = true; slowT = 0; toast('動作が重いので影を切りました（設定で戻せます）'); return; }
  if (slowT >= 4 && pixelScale > min) { pixelScale = Math.max(min, pixelScale - .25); renderer.setPixelRatio(pixelScale); slowT = 0; }
  else if (fastT >= 10 && pixelScale < max) { pixelScale = Math.min(max, pixelScale + .25); renderer.setPixelRatio(pixelScale); fastT = 0; }
}
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - last) / 1000, .05);
  last = now;
  frames++; fpsT += dt;
  if (fpsT > .5) {
    fps = frames / fpsT; frames = 0; fpsT = 0;
    autoQuality();
  }

  focus.copy(playing || !ready ? player.pos : camera.position);
  if (playing) {
    time += dt;
    updatePlayer(dt);
    hit = raycastVoxel(mode === 'creative' ? 7 : 5.5);
    updateMining(dt);
    if (!online()) mobs.update(dt, {
      player: player.pos, night: isNight(), survival: mode === 'survival',
      hitPlayer: n => damage(n, 'ゾンビにやられた'),
      onVoice: type => (type === 'fuse' ? Snd.fuse() : Snd.mob(type)),
      explode,
      shoot: (x, y, z, dx, dy, dz) => { arrows.shoot(x, y, z, dx, dy + .12 * Math.hypot(dx, dz) * .1, dz, .45, false); Snd.bow(.5); },
    });
    if (drawing) drawing = Math.min(1.2, drawing + dt);
    arrows.update(dt, {
      player: player.pos,
      pickMob: (x, y, z) => mobs.list.find(m => Math.abs(m.g.position.x - x) < .6 && Math.abs(m.g.position.z - z) < .6 && y > m.g.position.y && y < m.g.position.y + 2),
      hitMob: (m, dmg) => {
        Snd.hit();
        const dead = mobs.damage(m, dmg, player.pos, (drop, n) => { if (mode === 'survival') drops.spawn(drop, n, m.g.position.x, m.g.position.y + .5, m.g.position.z); });
        if (dead) { Snd.mob(m.type); stats.hunted++; }
      },
      hitPlayer: dmg => damage(dmg, '矢に射られた'),
      onHitBlock: (x, y, z) => { if (mode === 'survival' && Math.random() < .5) drops.spawn(IT.ARROW, 1, x, y, z); },
    });
    drops.update(dt, player.pos, (id, n, dur) => {
      if (mode === 'creative') return 0;
      const left = bag.add(id, n, dur);
      if (left < n) { Snd.pickup(); updateHotbar(); if (bagOpen) renderScreen(); }
      return left;
    });
    if (online()) {
      const flags = (player.sneak ? 1 : 0) | (player.sprint ? 2 : 0) | (player.fly ? 4 : 0) | (swingT > 0 ? 8 : 0);
      net.sendPos(player.pos && { x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw, pitch: player.pitch }, heldId(), Math.round(player.health), flags, now);
    }
    updateBlockPhysics(dt);
    updateCrops(dt);
    fluidT += dt;
    if (fluidT > .22) { fluidT = 0; updateFluids(); }
    updateWeather(dt);
    furnaceT += dt;
    if (furnaceT > .25) { updateFurnaces(furnaceT); furnaceT = 0; }
    spawnT += dt;
    if (spawnT > 3) { spawnT = 0; if (mode === 'survival' && !online()) mobs.trySpawnHostile(player.pos, isNight()); }
    if (isNight() && mode === 'survival') hint('夜になった。明かりを灯すか、家をつくって朝を待とう');
    if (player.pos.y < 20) advance('cave');
    if (player.pos.y > 45) advance('peak');
    if (player.air < 4) advance('swim');
  } else if (ready && !started) {
    const a = now * .00004;
    const cx = W / 2 + Math.cos(a) * W * .42, cz = W / 2 + Math.sin(a) * W * .42;
    camera.position.set(cx, 62 + Math.sin(a * 2.3) * 10, cz);
    camera.lookAt(W / 2, 24, W / 2);
    hit = null;
  }

  outline.visible = !!hit && playing;
  if (hit) {
    outline.position.set(hit.x + .5, hit.y + .5, hit.z + .5);
    document.body.classList.add('aiming');
  } else document.body.classList.remove('aiming');

  updateSky();
  if (online()) { updateFriends(dt); netMobs.update(dt); }
  particles.update(dt);
  processChunks(playing ? 5 : 9);
  cullChunks();
  matSolid.uniforms.uTime.value = matAlpha.uniforms.uTime.value = now * .001;
  matAlpha.uniforms.uWaterLayer.value = waterLayer;

  hudT += dt;
  if (hudT > .2) {
    hudT = 0;
    if (playing || ready) drawMinimap();
    const d = (time % DAY_LEN) / DAY_LEN;
    const hh = String(Math.floor(d * 24)).padStart(2, '0'), mm = String(Math.floor(d * 24 % 1 * 60)).padStart(2, '0');
    $('clock').textContent = (isNight() ? '☾ ' : '☀ ') + (Math.floor(time / DAY_LEN) + 1) + '日目 ' + hh + ':' + mm;
    const ci = clamp(focus.x | 0, 0, W - 1) + clamp(focus.z | 0, 0, W - 1) * W;
    $('biome').textContent = biomeName[biomeMap[ci]] || '';
    $('coords').textContent = `X ${focus.x.toFixed(0)}  /  Y ${focus.y.toFixed(0)}  /  Z ${focus.z.toFixed(0)}`;
    $('target').textContent = hit ? blockName(hit.id) : '';
    if (!$('debug').classList.contains('hidden')) {
      $('debug').textContent =
        `FPS ${fps.toFixed(0)}  draw ${drawCalls}  tri ${(drawTris / 1000).toFixed(0)}k  px ${pixelScale.toFixed(2)}\n` +
        `chunk ${chunks.size} / 待ち ${pending.size}\n` +
        `光 sky ${W3.skyAt(player.pos.x | 0, (player.pos.y + 1) | 0, player.pos.z | 0)} block ${W3.blockAt(player.pos.x | 0, (player.pos.y + 1) | 0, player.pos.z | 0)}\n` +
        `生き物 ${mobs.list.length}  昼 ${dayLight.toFixed(2)}\n` +
        `掘 ${stats.mined} 置 ${stats.placed} 狩 ${stats.hunted}`;
    }
  }
  if ((frames & 1) === 0 || !shadowReady) { renderShadows(); shadowReady = true; }
  renderMain();
  if (wantShot) { wantShot = false; saveScreenshot(); }
  drawCalls = renderer.info.render.calls;
  drawTris = renderer.info.render.triangles;
  // 手元のものを別画角で重ねる
  if (held && playing) {
    viewHemi.intensity = .7 + dayLight * 1.8;
    viewSun.intensity = .4 + dayLight * 1.9;
    viewSun.color.copy(cSun);
    viewHemi.color.copy(cMid);
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(viewScene, viewCamera);
    renderer.autoClear = true;
  }
}

// 開発用フック（コンソールから中身を覗ける）
window.BLOCKWILD = {
  THREE, scene, camera, renderer, chunks, player, W3, matSolid, matAlpha, atlas, mobs, particles,
  changeBlock, toast, focus, raycastVoxel, give, mineBlock, placeBlock, canHarvest, breakSeconds, keys, settings, bag, drops, chests, furnaces,
  setTime: v => { time = v; },
  openScreen, renderScreen, interact, updateFurnaces, updateCrops, updateFluids, plantAt, queueFluid,
  arrows, armor, crops, useItem, startDraw, releaseDraw, advance, runCommand, respawn, die,
  net, netMobs, friends, joinServer,
  selectSlot: i => { sel = clamp(i, 0, HOTBAR - 1); updateHotbar(); },
  setDrawing: v => { drawing = v; },
  setWeather: v => { weather = v; weatherT = 600; },
  explode,
  get state() {
    return {
      mode, playing, ready, sel, time, seed, dayLight, weather, rainLevel, pending: pending.size,
      online: online(), netId: net.id, friends: friends.size,
      hotbar: bag.slots.slice(0, HOTBAR).map(s2 => (s2 ? s2.id : 0)),
      inv: bag.slots.filter(Boolean).reduce((a, s2) => ((a[s2.id] = (a[s2.id] || 0) + s2.n), a), {}),
      drops: drops.list.length, screen, cursor,
    };
  },
};

// ---------------------------------------------------------------------------
// 起動
// ---------------------------------------------------------------------------
applyMode('creative');
applyButtons();
updateVitals();
requestAnimationFrame(loop);
createWorld(seed).then(() => { if (Save.hasLocal()) hint('前回の世界は「再開」から戻せる', false); });
