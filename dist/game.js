// BLOCKWILD — ブロックの世界
// オリジナルのボクセル・サンドボックス。地形生成・光伝播・チャンク分割メッシュ・
// 生き物・クラフト・昼夜まで、すべてこのリポジトリ内で完結している。
import * as THREE from './three.module.js';
import { ID, TOOL, blocks, items, isItem, name as blockName, color as blockColor } from './src/blocks.js';
import { buildAtlas, iconURL, blockTextures } from './src/textures.js';
import * as W3 from './src/world.js';
import { W, H, SEA, CH, CX, getBlock, setRaw, relight, relightAll, surface, isSolid, heightMap, biomeMap } from './src/world.js';
import { generate, setSeed, findSpawn, biomeName, biomeTint } from './src/worldgen.js';
import { buildChunk } from './src/mesher.js';
import { voxelMaterial, makeSky } from './src/shaders.js';
import { Mobs, Particles } from './src/entities.js';
import { recipes, canCraft, consume } from './src/craft.js';
import * as Snd from './src/audio.js';
import * as Save from './src/save.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------------------
// 設定
// ---------------------------------------------------------------------------
const defaults = { dist: 7, fov: 76, sens: 18, vol: 55, hints: true, bob: true, buttons: false };
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
scene.fog = new THREE.Fog('#9fd0e8', 30, 150);

// 生き物・パーティクル用の光（地形は自前シェーダで陰影を焼いている）
const hemi = new THREE.HemisphereLight('#dff0ff', '#4a5540', 2.2);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff3d6', 1.9);
sun.position.set(-40, 80, 20);
scene.add(sun);

const atlas = buildAtlas();
const matSolid = voxelMaterial(atlas, { transparent: false });
const matAlpha = voxelMaterial(atlas, { transparent: true });
matAlpha.depthWrite = true;

const mobs = new Mobs(scene);
const particles = new Particles(scene);

// 選択中ブロックの枠
const outline = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
  new THREE.LineBasicMaterial({ color: '#f6ffd0', transparent: true, opacity: .9, depthTest: true })
);
outline.visible = false;
scene.add(outline);

// ひび割れ表示
const crackMat = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: .0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
const crack = new THREE.Mesh(new THREE.BoxGeometry(1.02, 1.02, 1.02), crackMat);
crack.visible = false;
scene.add(crack);

// 手に持っているもの。
// 本編とは別のシーン・別の画角で最後に重ねて描くので、画面の端でも歪まない。
const viewScene = new THREE.Scene();
const viewCamera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, .01, 6);
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
const chunks = new Map();           // "cx,cz" -> {solid, alpha}
const pending = new Set();          // 作り直し待ち
function key(cx, cz) { return cx + ',' + cz; }

function disposeChunk(k) {
  const c = chunks.get(k);
  if (!c) return;
  for (const m of [c.solid, c.alpha]) if (m) { scene.remove(m); m.geometry.dispose(); }
  chunks.delete(k);
}

function buildOne(cx, cz) {
  const k = key(cx, cz);
  const { solid, alpha } = buildChunk(cx, cz);
  disposeChunk(k);
  const entry = { solid: null, alpha: null, cx, cz };
  if (solid) { const m = new THREE.Mesh(solid, matSolid); m.frustumCulled = true; scene.add(m); entry.solid = m; }
  if (alpha) { const m = new THREE.Mesh(alpha, matAlpha); m.renderOrder = 2; scene.add(m); entry.alpha = m; }
  chunks.set(k, entry);
}

function markDirty(x0, y0, z0, x1, y1, z1) {
  const cx0 = Math.max(0, Math.floor((x0 - 1) / CH)), cx1 = Math.min(CX - 1, Math.floor((x1 + 1) / CH));
  const cz0 = Math.max(0, Math.floor((z0 - 1) / CH)), cz1 = Math.min(CX - 1, Math.floor((z1 + 1) / CH));
  for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) pending.add(key(cx, cz));
}

// 近いところから順に作り直す
function processChunks(budgetMs) {
  if (!pending.size) return;
  const t0 = performance.now();
  const px = focus.x / CH, pz = focus.z / CH;
  const list = [...pending].sort((a, b) => {
    const [ax, az] = a.split(',').map(Number), [bx, bz] = b.split(',').map(Number);
    return ((ax - px) ** 2 + (az - pz) ** 2) - ((bx - px) ** 2 + (bz - pz) ** 2);
  });
  for (const k of list) {
    const [cx, cz] = k.split(',').map(Number);
    buildOne(cx, cz);
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
  onGround: false, inWater: false, sprint: false, sneak: false, fly: false,
  health: 20, food: 20, air: 10, hurtCd: 0, regenT: 0, starveT: 0,
};
const HALF = .3, BODY = 1.8, EYE = 1.62, STEP = 1.02;

function boxBlocked(x, y, z) {
  for (let bx = Math.floor(x - HALF); bx <= Math.floor(x + HALF); bx++)
    for (let bz = Math.floor(z - HALF); bz <= Math.floor(z + HALF); bz++)
      for (let by = Math.floor(y); by <= Math.floor(y + BODY - .02); by++)
        if (isSolid(getBlock(bx, by, bz))) return true;
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

function damage(n, reason) {
  if (mode !== 'survival' || player.hurtCd > 0 || !playing) return;
  player.health = Math.max(0, player.health - n);
  player.hurtCd = .6;
  document.body.classList.add('hurt');
  setTimeout(() => document.body.classList.remove('hurt'), 130);
  Snd.hurt();
  updateVitals();
  if (player.health <= 0) die(reason);
}
function die(reason) {
  toast('たおれてしまった… ' + (reason || '') + ' / 所持品はそのまま');
  const s = findSpawn();
  player.pos.set(s[0], s[1], s[2]);
  player.vel.set(0, 0, 0);
  player.health = 20; player.food = Math.max(6, player.food - 4); player.air = 10;
  updateVitals();
}

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
function changeBlock(x, y, z, id) {
  setRaw(x, y, z, id);
  const r = relight(x, y, z);
  if (r) markDirty(r.x0, r.y0, r.z0, r.x1, r.y1, r.z1);
  markDirty(x, y, z, x, y, z);
  const ci = x + z * W;
  if (id === ID.AIR) { if (heightMap[ci] === y) heightMap[ci] = surface(x, z); }
  else if (y > heightMap[ci]) heightMap[ci] = y;
  mapDirty = true;
}

function currentTool() {
  const id = hotbar[sel];
  return isItem(id) && items[id]?.tool ? items[id] : null;
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

function give(id, n = 1) {
  inv[id] = (inv[id] || 0) + n;
  // 空きスロットがあれば自動でホットバーへ
  if (!isItem(id) || items[id]?.tool) {
    if (!hotbar.includes(id)) {
      const empty = hotbar.indexOf(0);
      if (empty >= 0) hotbar[empty] = id;
    }
  }
  updateHotbar();
}

function damageTool(n = 1) {
  const t = currentTool();
  if (!t || mode === 'creative') return;
  const id = hotbar[sel];
  dur[id] = (dur[id] ?? t.dur) - n;
  if (dur[id] <= 0) {
    delete dur[id];
    inv[id] = Math.max(0, (inv[id] || 1) - 1);
    if (!inv[id]) { hotbar[sel] = 0; setHeld(0); }
    toast(t.name + ' が壊れてしまった');
    Snd.breakBlock('wood');
  }
  updateHotbar();
}

function mineBlock(hit) {
  const { x, y, z, id } = hit;
  const b = blocks[id];
  if (b.hard === Infinity) { toast('岩盤はどうやっても壊せない'); return; }
  if (mode === 'survival' && !canHarvest(id)) {
    const need = ['', '木', '石', '鉄', 'ダイヤ'][b.tier] || '強い';
    toast(need + 'の' + (b.tool === TOOL.AXE ? '斧' : b.tool === TOOL.SHOVEL ? 'シャベル' : 'ツルハシ') + 'が必要だ（Eでクラフト）');
    hint('E キーで持ち物を開き、棒と木材から道具を作ろう');
    return;
  }
  changeBlock(x, y, z, ID.AIR);
  particles.burst(x, y, z, blockColor(id), 16);
  Snd.breakBlock(soundMat(id));
  if (mode === 'survival') {
    const drop = b.drop ?? id;
    give(drop, id === ID.COAL_ORE || id === ID.DIAMOND_ORE ? 1 + Math.floor(Math.random() * 2) : 1);
    damageTool(1);
  }
  // 浮いた草花・雪は落とす
  const above = getBlock(x, y + 1, z);
  if (blocks[above]?.plant || above === ID.SNOW) {
    changeBlock(x, y + 1, z, ID.AIR);
    if (mode === 'survival') give(above, 1);
  }
  stats.mined++;
  updateHotbar();
}

function placeBlock(hit) {
  const id = hotbar[sel];
  if (!id) { toast('スロットが空。E で持ち物から選ぼう'); return; }
  if (isItem(id)) { toast(blockName(id) + ' は置けない道具・素材'); return; }
  const { px, py, pz } = hit;
  if (px < 0 || pz < 0 || px >= W || pz >= W || py < 0 || py >= H) { toast('この世界の外側には置けない'); return; }
  const there = getBlock(px, py, pz);
  if (there && there !== ID.WATER) { toast('そこにはもうブロックがある'); return; }
  if (mode === 'survival' && !(inv[id] > 0)) { toast(blockName(id) + ' を持っていない'); return; }
  const b = blocks[id];
  if (b.plant && !isSolid(getBlock(px, py - 1, pz))) { toast('地面の上にしか置けない'); return; }
  if (b.solid) { // 自分と重なる場所には置けない
    const p = player.pos;
    if (px + 1 > p.x - HALF && px < p.x + HALF && pz + 1 > p.z - HALF && pz < p.z + HALF && py + 1 > p.y && py < p.y + BODY) {
      toast('自分の足元すぎる。少し離れて置こう');
      return;
    }
  }
  changeBlock(px, py, pz, id);
  Snd.place(soundMat(id));
  if (mode === 'survival') { inv[id]--; if (!inv[id]) { /* スロットは残す */ } }
  stats.placed++;
  updateHotbar();
  swing();
}

function useItem() {
  const id = hotbar[sel];
  const it = items[id];
  if (!it) return false;
  if (it.food && player.food < 20 && mode === 'survival') {
    player.food = Math.min(20, player.food + it.food);
    inv[id]--;
    if (!inv[id]) hotbar[sel] = 0;
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
    if (mode === 'survival') { give(drop, n); toast(blockName(drop) + ' ×' + n + ' を手に入れた'); }
  });
  if (dead) { Snd.mob(mob.type); stats.hunted++; }
  if (t) damageTool(1);
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
let inv = {};                          // id -> 個数
let dur = {};                          // 道具id -> 残り耐久
let hotbar = [ID.GRASS, ID.DIRT, ID.STONE, ID.COBBLE, ID.SAND, ID.PLANKS, ID.GLASS, ID.LANTERN, ID.TORCH];
let stats = { mined: 0, placed: 0, hunted: 0 };
let mapDirty = true;
const keys = {};

const CREATIVE_BAR = [ID.GRASS, ID.DIRT, ID.STONE, ID.COBBLE, ID.SAND, ID.PLANKS, ID.GLASS, ID.LANTERN, ID.TORCH];
const SURVIVAL_BAR = [0, 0, 0, 0, 0, 0, 0, 0, 0];

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

function updateHotbar() {
  const el = $('hotbar');
  el.innerHTML = hotbar.map((id, i) => {
    if (!id) return `<button class="slot empty ${i === sel ? 'active' : ''}" data-slot="${i}"><b>${i + 1}</b></button>`;
    const t = items[id];
    const count = mode === 'creative' && !isItem(id) ? '∞' : (inv[id] || 0);
    const d = t?.tool && dur[id] !== undefined ? `<span class="dur"><i style="width:${Math.max(0, dur[id] / t.dur * 100)}%"></i></span>` : '';
    return `<button class="slot ${i === sel ? 'active' : ''}" data-slot="${i}" title="${blockName(id)}">
      <b>${i + 1}</b><img src="${iconURL(id)}" alt=""><small>${count}</small>${d}</button>`;
  }).join('');
  $('selectedName').textContent = hotbar[sel] ? blockName(hotbar[sel]) : '（空のスロット）';
  setHeld(hotbar[sel]);
}

function updateVitals() {
  const surv = mode === 'survival';
  $('healthBar').style.setProperty('--v', (player.health / 20 * 100) + '%');
  $('foodBar').style.setProperty('--v', (player.food / 20 * 100) + '%');
  $('airBar').style.setProperty('--v', (player.air / 10 * 100) + '%');
  $('healthBar').classList.toggle('hidden', !surv);
  $('foodBar').classList.toggle('hidden', !surv);
  $('airBar').classList.toggle('hidden', !surv || player.air >= 10);
}

// ---------------------------------------------------------------------------
// 持ち物とクラフト
// ---------------------------------------------------------------------------
function nearBench() {
  const p = player.pos;
  for (let x = -4; x <= 4; x++) for (let y = -3; y <= 3; y++) for (let z = -4; z <= 4; z++)
    if (getBlock(Math.floor(p.x) + x, Math.floor(p.y) + y, Math.floor(p.z) + z) === ID.BENCH) return true;
  return false;
}

function renderBag() {
  const creative = mode === 'creative';
  const list = creative
    ? blocks.filter(b => b && b.id !== ID.AIR && b.id !== ID.BEDROCK).map(b => b.id)
    : [...new Set([...Object.keys(inv).map(Number).filter(id => inv[id] > 0)])];
  $('invHint').textContent = creative ? 'クリックでスロットにセット（無限）' : '持っているものだけ表示';
  $('blocks').innerHTML = list.length ? list.map(id => `
    <button data-give="${id}" class="${creative || inv[id] ? '' : 'zero'}" title="${blockName(id)}">
      <img src="${iconURL(id)}" alt=""><span>${blockName(id)}</span>
      <span class="n">${creative && !isItem(id) ? '∞' : (inv[id] || 0)}</span>
    </button>`).join('') : '<p style="color:var(--dim);font-size:12px">まだ何も持っていない。木を殴るところから。</p>';

  const bench = nearBench();
  $('benchState').textContent = creative ? 'クリエイティブでは材料不要' : (bench ? '作業台のそば ✓' : '道具には作業台が必要');
  $('recipes').innerHTML = recipes.map((r, i) => {
    const ok = creative || (canCraft(r, inv) && (!r.bench || bench));
    const needTxt = r.need.map(([id, n]) => `${blockName(id)}${n > 1 ? '×' + n : ''}`).join(' ＋ ') + (r.bench ? '（作業台）' : '');
    return `<button data-recipe="${i}" ${ok ? '' : 'disabled'}>
      <img src="${iconURL(r.out[0])}" alt="">
      <span class="body"><b>${blockName(r.out[0])}${r.out[1] > 1 ? ' ×' + r.out[1] : ''}</b><small>${needTxt}</small></span>
      <span class="tag">${r.tag}</span></button>`;
  }).join('');
}

function doCraft(i) {
  const r = recipes[i];
  if (mode === 'survival') {
    if (!canCraft(r, inv)) { toast('材料が足りない'); return; }
    if (r.bench && !nearBench()) { toast('作業台のそばでしか作れない'); return; }
    consume(r, inv);
  }
  give(r.out[0], r.out[1]);
  if (items[r.out[0]]?.tool) dur[r.out[0]] = items[r.out[0]].dur;
  Snd.craft();
  toast(blockName(r.out[0]) + ' を作った');
  renderBag();
  updateHotbar();
}

function openBag() {
  bagOpen = true; playing = false; mining = false;
  document.exitPointerLock?.();
  renderBag();
  $('inventory').classList.remove('hidden');
}
function closeOverlays() {
  $('inventory').classList.add('hidden');
  $('settings').classList.add('hidden');
  bagOpen = false;
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
  dayLight = lerp(a.light, b.light, k);

  const ang = (f - .25) * Math.PI * 2;
  const sunDir = new THREE.Vector3(Math.cos(ang) * .8, Math.sin(ang), .35).normalize();
  sky.material.uniforms.uTop.value.copy(cTop);
  sky.material.uniforms.uMid.value.copy(cMid);
  sky.material.uniforms.uBottom.value.copy(cBot);
  sky.material.uniforms.uSunColor.value.copy(cSun);
  sky.material.uniforms.uSunDir.value.copy(sunDir.y > -.2 ? sunDir : sunDir.clone().negate());
  sky.material.uniforms.uStars.value = clamp((.34 - dayLight) * 4.5, 0, 1);

  const under = blockAtEye() === ID.WATER;
  document.body.classList.toggle('underwater', under && playing);
  const far = settings.dist * CH;
  scene.fog.color.copy(under ? new THREE.Color('#1d5d75') : cFog);
  scene.fog.near = under ? 0.5 : far * .72;
  scene.fog.far = under ? 16 : far * 1.12;
  sky.visible = !under;
  renderer.setClearColor(scene.fog.color, 1);

  for (const m of [matSolid, matAlpha]) {
    m.uniforms.uDay.value = dayLight;
    m.uniforms.uAmbient.value.copy(cAmb);
    m.uniforms.uTorchLight.value.copy(cTorch);
    m.uniforms.uSkyLight.value.copy(cSun).lerp(WHITE, .2 + dayLight * .35);
  }
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
  if (!mining || !hit) { progress = 0; $('progress').classList.add('hidden'); crack.visible = false; return; }
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
  crack.visible = progress > .12;
  crack.position.set(hit.x + .5, hit.y + .5, hit.z + .5);
  crackMat.opacity = progress * .55;
}

// ---------------------------------------------------------------------------
// プレイヤーの更新
// ---------------------------------------------------------------------------
let stepT = 0, bobT = 0;
function updatePlayer(dt) {
  stepped = false;
  unstick();
  const feet = blockAtFeet(), eye = blockAtEye();
  player.inWater = feet === ID.WATER || eye === ID.WATER;
  player.sprint = !!keys.ShiftLeft && !player.fly && (keys.KeyW || touchMove.y < -.3) && !player.inWater;

  let mx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + touchMove.x;
  let mz = (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0) + touchMove.y;
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  const moving = len > .08;

  let speed = player.fly ? 13 : player.inWater ? 3.4 : player.sprint ? 7.1 : 4.6;
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
    if (stepT > 1) { stepT = 0; Snd.step(soundMat(getBlock(Math.floor(player.pos.x), Math.floor(player.pos.y - .2), Math.floor(player.pos.z)))); }
    bobT += dt * (player.sprint ? 11 : 8);
  }

  // サボテンの棘
  const bx = Math.floor(player.pos.x), bz = Math.floor(player.pos.z);
  for (let y = 0; y < 2; y++) if (getBlock(bx, Math.floor(player.pos.y) + y, bz) === ID.CACTUS) damage(1, 'サボテンに刺さった');

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

  // カメラ
  const bob = settings.bob && player.onGround && moving ? Math.sin(bobT) * .035 : 0;
  camera.position.set(player.pos.x, player.pos.y + EYE + bob, player.pos.z);
  camera.rotation.set(player.pitch, player.yaw, settings.bob ? Math.cos(bobT) * .008 : 0);
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
  if (e.code === 'F3') { $('debug').classList.toggle('hidden'); return; }
  if (!playing) return;
  keys[e.code] = true;
  if (/^Digit[1-9]$/.test(e.code)) { sel = +e.code.slice(-1) - 1; updateHotbar(); Snd.ui(); }
  if (e.code === 'KeyF') {
    if (mode === 'creative') { player.fly = !player.fly; player.vel.y = 0; toast(player.fly ? '飛行：Space で上昇 / Shift で下降' : '飛行を終了'); }
    else toast('飛行はクリエイティブだけ');
  }
  if (e.code === 'KeyQ' && mode === 'survival' && hotbar[sel] && inv[hotbar[sel]] > 0) {
    inv[hotbar[sel]]--; toast(blockName(hotbar[sel]) + ' を1つ捨てた'); updateHotbar();
  }
  if (e.code === 'KeyP') doSave();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; touchMove.x = touchMove.y = 0; });
document.addEventListener('visibilitychange', () => { if (document.hidden && playing) pause(); });

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
  else if (e.button === 2) {
    if (useItem()) return;
    if (hit) placeBlock(hit);
    else toast('近くのブロックに向けて置こう');
  }
});
addEventListener('pointerup', e => {
  if (e.pointerId === dragId) { dragging = false; dragId = null; }
  mining = false;
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

function tryAttack() {
  camera.getWorldDirection(dir);
  const o = camera.getWorldPosition(new THREE.Vector3());
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
$('touchPlace').addEventListener('click', () => { if (playing && !useItem() && hit) placeBlock(hit); });
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
  tryLock();
  updateHotbar(); updateVitals();
}
const resume = () => { closeOverlays(); start(); };
function pause() {
  playing = false; mining = false;
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
    if (!keepBar) hotbar = SURVIVAL_BAR.slice();
  } else if (!keepBar) {
    hotbar = CREATIVE_BAR.slice();
    player.health = 20; player.food = 20; player.air = 10;
  }
  updateHotbar(); updateVitals();
}

$('play').onclick = () => start();
$('menuButton').onclick = () => (playing ? pause() : start());
document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { applyMode(b.dataset.mode); Snd.ui(); });
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => { if (started) resume(); else closeOverlays(); });
$('hotbar').onclick = e => { const b = e.target.closest('[data-slot]'); if (b) { sel = +b.dataset.slot; updateHotbar(); } };
$('blocks').onclick = e => {
  const b = e.target.closest('[data-give]');
  if (!b) return;
  const id = +b.dataset.give;
  hotbar[sel] = id;
  if (mode === 'creative') inv[id] = 999;
  updateHotbar();
  toast(blockName(id) + ' をスロット ' + (sel + 1) + ' へ');
  Snd.ui();
};
$('recipes').onclick = e => { const b = e.target.closest('[data-recipe]'); if (b && !b.disabled) doCraft(+b.dataset.recipe); };

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
function applyButtons() {
  const on = !!settings.buttons && !isTouch;
  document.body.classList.toggle('buttons', on);
  $('optButtons').checked = !!settings.buttons;
  if (on && locked()) document.exitPointerLock?.();   // カーソルを出してボタンを押せるように
  if (on) document.body.classList.add('freelook');
  else if (playing) tryLock();
}
$('optButtons').onchange = () => { settings.buttons = $('optButtons').checked; saveSettings(); applyButtons(); };
$('optHints').checked = settings.hints;
$('optHints').onchange = () => { settings.hints = $('optHints').checked; saveSettings(); };
$('optBob').checked = settings.bob;
$('optBob').onchange = () => { settings.bob = $('optBob').checked; saveSettings(); };
$('settingsBtn').onclick = () => $('settings').classList.remove('hidden');
Snd.setVolume(settings.vol / 100);

// ---------------------------------------------------------------------------
// セーブ／ロード
// ---------------------------------------------------------------------------
const collectState = () => ({
  seed, time, mode, sel, hotbar, inv, dur, stats,
  p: player.pos.toArray(), yaw: player.yaw, pitch: player.pitch,
  health: player.health, food: player.food, air: player.air,
});
function applyState(s) {
  seed = s.seed; time = s.time; sel = s.sel ?? 0;
  hotbar = s.hotbar || CREATIVE_BAR.slice();
  inv = s.inv || {}; dur = s.dur || {}; stats = s.stats || stats;
  player.pos.fromArray(s.p); player.yaw = s.yaw; player.pitch = s.pitch;
  player.health = s.health ?? 20; player.food = s.food ?? 20; player.air = s.air ?? 10;
  player.vel.set(0, 0, 0); player.fly = false;
  setSeed(seed);
  applyMode(s.mode || 'creative', true);
}
function rebuildAll() {
  for (const k of [...chunks.keys()]) disposeChunk(k);
  pending.clear();
  for (let cx = 0; cx < CX; cx++) for (let cz = 0; cz < CX; cz++) pending.add(key(cx, cz));
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
async function reloadFromState(s) {
  showLoading('世界を組み立てています');
  await gap();
  applyState(s);
  relightAll();
  rebuildAll();
  mobs.populate();
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
  for (let cx = 0; cx < CX; cx++) for (let cz = 0; cz < CX; cz++) {
    const d = Math.hypot(cx + .5 - player.pos.x / CH, cz + .5 - player.pos.z / CH);
    if (d <= radius) list.push([d, cx, cz]);
  }
  list.sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < list.length; i++) {
    buildOne(list[i][1], list[i][2]);
    pending.delete(key(list[i][1], list[i][2]));
    if (i % 3 === 0) { setProgress(fromP + (1 - fromP) * (i / list.length), '世界を組み立てています'); await gap(); }
  }
}

async function createWorld(newSeed) {
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
  setProgress(.9, '光を通しています');
  await gap();
  relightAll();
  const s = findSpawn();
  player.pos.set(s[0], s[1], s[2]);
  player.vel.set(0, 0, 0);
  player.yaw = Math.random() * 6.28; player.pitch = -.1;
  player.health = 20; player.food = 20; player.air = 10;
  time = 300;
  mobs.populate();
  rebuildAll();
  await buildNear(4.2, .92);
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
  inv = {}; dur = {}; stats = { mined: 0, placed: 0, hunted: 0 };
  started = false; playing = false;
  hotbar = mode === 'creative' ? CREATIVE_BAR.slice() : SURVIVAL_BAR.slice();
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

let last = performance.now(), frames = 0, fps = 60, fpsT = 0, hudT = 0, spawnT = 0;
// 端末が重いときは自動で解像度を落とし、軽ければ戻す
let pixelScale = Math.min(devicePixelRatio, 2), slowT = 0, fastT = 0, drawCalls = 0, drawTris = 0;
function autoQuality() {
  if (!playing) return;
  if (fps < 34) { slowT++; fastT = 0; } else if (fps > 55) { fastT++; slowT = 0; } else { slowT = fastT = 0; }
  const min = .6, max = Math.min(devicePixelRatio, 2);
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
    mobs.update(dt, {
      player: player.pos, night: isNight(), survival: mode === 'survival',
      hitPlayer: n => damage(n, 'ゾンビにやられた'),
      onVoice: type => Snd.mob(type),
    });
    spawnT += dt;
    if (spawnT > 3) { spawnT = 0; if (mode === 'survival') mobs.trySpawnHostile(player.pos, isNight()); }
    if (isNight() && mode === 'survival') hint('夜になった。明かりを灯すか、家をつくって朝を待とう');
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
  particles.update(dt);
  processChunks(playing ? 5 : 9);
  cullChunks();
  matSolid.uniforms.uTime.value = matAlpha.uniforms.uTime.value = now * .001;

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
  renderer.render(scene, camera);
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
  changeBlock, toast, focus, raycastVoxel, give, doCraft, mineBlock, placeBlock, canHarvest, breakSeconds, keys, settings,
  setTime: v => { time = v; },
  get state() { return { mode, playing, ready, sel, hotbar, inv, time, dayLight, pending: pending.size }; },
};

// ---------------------------------------------------------------------------
// 起動
// ---------------------------------------------------------------------------
applyMode('creative');
applyButtons();
updateVitals();
requestAnimationFrame(loop);
createWorld(seed).then(() => { if (Save.hasLocal()) hint('前回の世界は「再開」から戻せる', false); });
