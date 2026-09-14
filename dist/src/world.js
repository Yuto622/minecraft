// world.js — ボクセル記憶域と光伝播エンジン
// 光は「空の光(sky)」と「光源の光(block)」を 4bit ずつ 1byte に詰めて保持する。
// ブロックを置く／壊すたびに周囲だけを再計算するので、松明１本でも即座に陰影が変わる。
import { blocks, ID } from './blocks.js';

export const W = 256;        // 一辺のブロック数
export const H = 64;         // 高さ
export const SEA = 20;       // 海面
export const CH = 16;        // チャンクの一辺
export const CX = W / CH;    // チャンク数（軸あたり）

export const voxels = new Uint8Array(W * W * H);
// 向きや開閉などの状態（階段・ドア・ベッド・かまど）。
export const metaArr = new Uint8Array(W * W * H);
export const light = new Uint8Array(W * W * H);
export const biomeMap = new Uint8Array(W * W);
export const heightMap = new Uint8Array(W * W);

export const idx = (x, y, z) => x + W * (z + W * y);
export const inside = (x, y, z) => x >= 0 && z >= 0 && y >= 0 && x < W && z < W && y < H;

export function getBlock(x, y, z) {
  if (x < 0 || z < 0 || x >= W || z >= W || y >= H) return ID.AIR;
  if (y < 0) return ID.BEDROCK;
  return voxels[idx(x, y, z)];
}
export function setRaw(x, y, z, id, m = 0) {
  if (!inside(x, y, z)) return;
  const i = idx(x, y, z);
  voxels[i] = id;
  metaArr[i] = m;
}
export function getMeta(x, y, z) { return inside(x, y, z) ? metaArr[idx(x, y, z)] : 0; }
export function setMeta(x, y, z, m) { if (inside(x, y, z)) metaArr[idx(x, y, z)] = m; }

export const absorb = id => blocks[id].absorb;
export const emit = id => blocks[id].emit;
export const isSolid = id => blocks[id].solid;
export const isOpaque = id => blocks[id].opaque;
export const isFull = id => blocks[id].full !== false && blocks[id].opaque;

export function skyAt(x, y, z) {
  if (x < 0 || z < 0 || x >= W || z >= W || y < 0) return 0;
  if (y >= H) return 15;
  return light[idx(x, y, z)] >> 4;
}
export function blockAt(x, y, z) {
  if (!inside(x, y, z)) return 0;
  return light[idx(x, y, z)] & 15;
}

// 地表の高さ（水・植物を除く）
export function surface(x, z) {
  if (x < 0 || z < 0 || x >= W || z >= W) return SEA;
  for (let y = H - 1; y >= 0; y--) {
    const b = getBlock(x, y, z);
    if (b && !blocks[b].plant && b !== ID.WATER) return y;
  }
  return 0;
}

// --- 光伝播 -----------------------------------------------------------------
// キューは (x,z,y,値) を 1 つの Int32 に詰めて持つ。必要なら自動で伸びる。
let queue = new Int32Array(1 << 18);
let qHead = 0, qTail = 0;
function push(x, y, z, v) {
  if (qTail === queue.length) {
    if (qHead > queue.length >> 1) { queue.copyWithin(0, qHead, qTail); qTail -= qHead; qHead = 0; }
    else { const n = new Int32Array(queue.length * 2); n.set(queue); queue = n; }
  }
  queue[qTail++] = (x << 24) | (z << 16) | (y << 8) | v;
}
const NB = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// BFS 本体。x0..x1 / z0..z1 / y0..y1 の内側だけを更新する。
function spread(x0, y0, z0, x1, y1, z1) {
  while (qHead < qTail) {
    const p = queue[qHead++];
    const x = (p >> 24) & 255, z = (p >> 16) & 255, y = (p >> 8) & 255, raw = p & 255;
    const sky = (raw & 128) !== 0, lv = raw & 127;
    if (lv <= 1) continue;
    for (let k = 0; k < 6; k++) {
      const nx = x + NB[k][0], ny = y + NB[k][1], nz = z + NB[k][2];
      if (nx < x0 || nx > x1 || nz < z0 || nz > z1 || ny < y0 || ny > y1) continue;
      const i = idx(nx, ny, nz), a = absorb(voxels[i]);
      if (a >= 15) continue;
      // 空の光は真下へ減衰せずに落ちる
      const nv = (sky && k === 3 && lv === 15 && a === 0) ? 15 : lv - 1 - a;
      if (nv <= 0) continue;
      const cur = sky ? (light[i] >> 4) : (light[i] & 15);
      if (cur >= nv) continue;
      light[i] = sky ? ((nv << 4) | (light[i] & 15)) : ((light[i] & 240) | nv);
      push(nx, ny, nz, sky ? (nv | 128) : nv);
    }
  }
  qHead = qTail = 0;
}

// 空の光を列ごとに落とす
function skyColumns(x0, z0, x1, z1, yTop) {
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    let lv = yTop >= H - 1 ? 15 : (light[idx(x, yTop + 1, z)] >> 4);
    for (let y = yTop; y >= 0; y--) {
      const i = idx(x, y, z), a = absorb(voxels[i]);
      if (a >= 15) { lv = 0; break; }
      if (lv < 15 || a > 0) lv = Math.max(0, lv - a);
      if (lv <= 0) continue;
      light[i] = (lv << 4) | (light[i] & 15);
      push(x, y, z, lv | 128);
    }
  }
}

// 世界全体の光を一から計算（生成直後）
export function relightAll() {
  light.fill(0);
  qHead = qTail = 0;
  skyColumns(0, 0, W - 1, W - 1, H - 1);
  for (let y = 0; y < H; y++) for (let z = 0; z < W; z++) for (let x = 0; x < W; x++) {
    const i = idx(x, y, z), e = emit(voxels[i]);
    if (e > 0) { light[i] = (light[i] & 240) | e; push(x, y, z, e); }
  }
  spread(0, 0, 0, W - 1, H - 1, W - 1);
}

// 局所再計算。半径は「そこにある光の強さ」に合わせて決める。
// 松明を置いたときだけ広く、ただの土を置いたときは狭く計算する。
export function autoRadius(bx, by, bz, oldId, newId) {
  let strength = Math.max(emit(oldId || 0), emit(newId || 0));
  for (const [dx, dy, dz] of NB) strength = Math.max(strength, blockAt(bx + dx, by + dy, bz + dz));
  return Math.max(6, Math.min(16, strength + 2));
}
export function relight(bx, by, bz, R = 16) {
  return relightRegion(bx - R, by - R, bz - R, bx + R, by + R, bz + R);
}

// 直方体の範囲をまとめて計算し直す（爆発など一度に多く変わるとき）
export function relightRegion(ax0, ay0, az0, ax1, ay1, az1) {
  const x0 = Math.max(0, ax0 | 0), x1 = Math.min(W - 1, ax1 | 0);
  const z0 = Math.max(0, az0 | 0), z1 = Math.min(W - 1, az1 | 0);
  const y0 = Math.max(0, ay0 | 0), y1 = Math.min(H - 1, ay1 | 0);
  const bw = x1 - x0 + 1, bd = z1 - z0 + 1, bh = y1 - y0 + 1;
  const before = new Uint8Array(bw * bd * bh);
  const bi = (x, y, z) => (x - x0) + bw * ((z - z0) + bd * (y - y0));

  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const i = idx(x, y, z); before[bi(x, y, z)] = light[i]; light[i] = 0;
  }
  qHead = qTail = 0;
  skyColumns(x0, z0, x1, z1, y1);
  // 領域外の光を種にする
  const seed = (x, y, z) => {
    if (!inside(x, y, z)) return;
    const l = light[idx(x, y, z)], s = l >> 4, b = l & 15;
    if (s > 1) push(x, y, z, s | 128);
    if (b > 1) push(x, y, z, b);
  };
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) { seed(x0 - 1, y, z); seed(x1 + 1, y, z); }
    for (let x = x0; x <= x1; x++) { seed(x, y, z0 - 1); seed(x, y, z1 + 1); }
  }
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) { seed(x, y0 - 1, z); seed(x, y1 + 1, z); }
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const i = idx(x, y, z), e = emit(voxels[i]);
    if (e > 0) { light[i] = (light[i] & 240) | e; push(x, y, z, e); }
  }
  spread(x0, y0, z0, x1, y1, z1);

  let cx0 = 1e9, cy0 = 1e9, cz0 = 1e9, cx1 = -1e9, cy1 = -1e9, cz1 = -1e9;
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    if (before[bi(x, y, z)] !== light[idx(x, y, z)]) {
      if (x < cx0) cx0 = x; if (x > cx1) cx1 = x;
      if (y < cy0) cy0 = y; if (y > cy1) cy1 = y;
      if (z < cz0) cz0 = z; if (z > cz1) cz1 = z;
    }
  }
  return cx1 < cx0 ? null : { x0: cx0, x1: cx1, y0: cy0, y1: cy1, z0: cz0, z1: cz1 };
}
