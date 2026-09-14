// mesher.js — チャンクを1枚のジオメトリに焼き込む
// 立方体だけでなく、ハーフブロック・階段・柵・ドアのような
// 「箱の集まり」で表される形も扱う。面ごとの陰影 + アンビエントオクルージョン +
// 4点平均のスムースライティング。
import * as THREE from '../three.module.js';
import { getBlock, getMeta, skyAt, blockAt, isOpaque, isFull, CH, W, voxels } from './world.js';
import { blocks, ID } from './blocks.js';
import { faceLayer, layer } from './textures.js';

// 面: 法線 / その面での uv 軸 / 明るさ
const F = [
  { n: [1, 0, 0], s: .80, ax: 0, u: 2, v: 1, du: -1, dv: 1 },
  { n: [-1, 0, 0], s: .74, ax: 0, u: 2, v: 1, du: 1, dv: 1 },
  { n: [0, 1, 0], s: 1.0, ax: 1, u: 0, v: 2, du: 1, dv: 1 },
  { n: [0, -1, 0], s: .52, ax: 1, u: 0, v: 2, du: 1, dv: -1 },
  { n: [0, 0, 1], s: .90, ax: 2, u: 0, v: 1, du: 1, dv: 1 },
  { n: [0, 0, -1], s: .86, ax: 2, u: 0, v: 1, du: -1, dv: 1 },
];
F.forEach(f => { f.t = [0, 1, 2].filter(a => a !== f.ax); });

const AO = [.46, .68, .85, 1.0];
const FULL_BOX = [[0, 0, 0, 1, 1, 1]];

function tint(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 1103515245) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return .945 + ((h ^ (h >>> 16)) >>> 0) % 1000 / 1000 * .11;
}

// 角の明るさ（周囲4セルの平均）と AO
function cornerLight(x, y, z, f, p) {
  const nx = x + f.n[0], ny = y + f.n[1], nz = z + f.n[2];
  const d = [0, 0, 0]; d[f.t[0]] = p[f.t[0]] ? 1 : -1;
  const e = [0, 0, 0]; e[f.t[1]] = p[f.t[1]] ? 1 : -1;
  const cells = [
    [nx, ny, nz],
    [nx + d[0], ny + d[1], nz + d[2]],
    [nx + e[0], ny + e[1], nz + e[2]],
    [nx + d[0] + e[0], ny + d[1] + e[1], nz + d[2] + e[2]],
  ];
  const o = cells.map(c => isOpaque(getBlock(c[0], c[1], c[2])));
  const ao = (o[1] && o[2]) ? 0 : 3 - (o[1] + o[2] + o[3]);
  let sky = 0, blk = 0, n = 0;
  for (let i = 0; i < 4; i++) {
    if (o[i]) continue;
    sky += skyAt(cells[i][0], cells[i][1], cells[i][2]);
    blk += blockAt(cells[i][0], cells[i][1], cells[i][2]);
    n++;
  }
  if (!n) { sky = skyAt(nx, ny, nz); blk = blockAt(nx, ny, nz); n = 1; }
  return [sky / n / 15, blk / n / 15, AO[ao] * f.s];
}

const newG = () => ({ pos: [], uv: [], layer: [], light: [], anim: [], nrm: [], idx: [] });

function pushQuad(g, verts, lay, lights, anim, uvs, n = [0, 1, 0]) {
  const base = g.pos.length / 3;
  for (let k = 0; k < 4; k++) {
    g.pos.push(verts[k][0], verts[k][1], verts[k][2]);
    g.uv.push(uvs[k][0], uvs[k][1]);
    g.layer.push(lay);
    g.light.push(lights[k][0], lights[k][1], lights[k][2]);
    g.anim.push(anim);
    g.nrm.push(n[0], n[1], n[2]);
  }
  const a = lights[0][2] + lights[3][2], b = lights[1][2] + lights[2][2];
  if (a > b) g.idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  else g.idx.push(base + 1, base + 3, base, base, base + 3, base + 2);
}

// 箱 b の面 fi を四角形として書き出す
function emitFace(g, x, y, z, b, fi, lay, anim, tn) {
  const f = F[fi];
  const [x0, y0, z0, x1, y1, z1] = b;
  const lo = [x0, y0, z0], hi = [x1, y1, z1];
  const a = f.ax, t0 = f.t[0], t1 = f.t[1];
  const fixed = f.n[a > 0 ? a : a] > 0 ? hi[a] : lo[a];
  const verts = [], uvs = [], lights = [];
  // 面上の 4 点（(t0,t1) = (0,0),(1,0),(0,1),(1,1) の順）
  for (let k = 0; k < 4; k++) {
    const s0 = k % 2, s1 = k > 1 ? 1 : 0;
    const p = [0, 0, 0];
    p[a] = fixed;
    p[t0] = s0 ? hi[t0] : lo[t0];
    p[t1] = s1 ? hi[t1] : lo[t1];
    verts.push([x + p[0], y + p[1], z + p[2]]);
    // 明るさは箱の角ではなくブロックの角で拾う（継ぎ目を目立たせない）
    const corner = [0, 0, 0];
    corner[a] = f.n[a] > 0 ? 1 : 0;
    corner[t0] = s0;
    corner[t1] = s1;
    const l = cornerLight(x, y, z, f, corner);
    l[2] *= tn;
    lights.push(l);
    // uv はブロック内の位置をそのまま使う（模様がつながる）
    const uu = f.u === t0 ? p[t0] : p[t1];
    const vv = f.v === t0 ? p[t0] : p[t1];
    uvs.push([f.du > 0 ? uu : 1 - uu, f.dv > 0 ? 1 - vv : vv]);
  }
  // 裏返る面の頂点順を入れ替える
  const flip = (f.n[a] > 0) !== (t0 < t1);
  if (flip) { [verts[1], verts[2]] = [verts[2], verts[1]]; [uvs[1], uvs[2]] = [uvs[2], uvs[1]]; [lights[1], lights[2]] = [lights[2], lights[1]]; }
  pushQuad(g, verts, lay, lights, anim, uvs, f.n);
}

// 箱を Y 軸まわりに meta*90 度回す
function rotateBox(b, r) {
  let [x0, y0, z0, x1, y1, z1] = b;
  for (let i = 0; i < (r & 3); i++) {
    [x0, z0, x1, z1] = [1 - z1, x0, 1 - z0, x1];
  }
  return [Math.min(x0, x1), y0, Math.min(z0, z1), Math.max(x0, x1), y1, Math.max(z0, z1)];
}

// 柵・板ガラスは隣とつながる。柵は上下2本の横木でつなぐ。
function connectBoxes(id, x, y, z, b) {
  const out = b.slice();
  const pane = id === ID.GLASS_PANE;
  const w0 = pane ? .4375 : .375, w1 = pane ? .5625 : .625;
  const bars = pane ? [[0, 1]] : [[.3125, .4375], [.65, .78]];
  const links = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
  for (const [dx, , dz] of links) {
    const nb = getBlock(x + dx, y, z + dz);
    if (!nb || !(isFull(nb) || blocks[nb].connect === blocks[id].connect)) continue;
    for (const [h0, h1] of bars) {
      if (dx > 0) out.push([w1, h0, w0, 1, h1, w1]);
      else if (dx < 0) out.push([0, h0, w0, w0, h1, w1]);
      else if (dz > 0) out.push([w0, h0, w1, w1, h1, 1]);
      else out.push([w0, h0, 0, w1, h1, w0]);
    }
  }
  return out;
}

export function blockBoxes(id, m) {
  const b = blocks[id];
  if (!b || !b.boxes) return FULL_BOX;
  let boxes = b.boxes;
  if (b.door) {
    // meta: 下位2bit=向き / 4=上半分 / 8=開いている
    const open = (m & 8) !== 0;
    const dir = (m & 3) + (open ? 1 : 0);
    return [rotateBox(boxes[0], dir)];
  }
  if (b.bed) {
    const half = (m & 4) ? [[0, 0, 0, 1, .5625, 1]] : boxes;
    return half;
  }
  if (b.rot) boxes = boxes.map(x => rotateBox(x, m & 3));
  return boxes;
}

// 1区画は 16×16×16。縦にも分けることで、地下の面を地上で描かずに済む。
export function buildChunk(cx, cy, cz) {
  const x0 = cx * CH, z0 = cz * CH, y0 = cy * CH;
  // 空っぽの区画はすぐ返す（空の上や岩盤の下はほとんどこれ）
  let any = false;
  for (let y = y0; y < y0 + CH && !any; y++)
    for (let z = z0; z < z0 + CH && !any; z++) {
      const base = W * (z + W * y);
      for (let x = x0; x < x0 + CH; x++) if (voxels[base + x]) { any = true; break; }
    }
  if (!any) return { solid: null, alpha: null };

  const solid = newG(), alpha = newG();
  for (let x = x0; x < x0 + CH; x++) for (let z = z0; z < z0 + CH; z++) for (let y = y0; y < y0 + CH; y++) {
    const id = getBlock(x, y, z);
    if (!id) continue;
    const b = blocks[id];
    const m = getMeta(x, y, z);

    if (b.plant) { // 草花・たいまつは交差した板
      const sky = skyAt(x, y, z) / 15, blk = blockAt(x, y, z) / 15;
      const L = [[sky, blk, .95], [sky, blk, .95], [sky, blk, .95], [sky, blk, .95]];
      const lay = b.stages ? (layer[b.stages[Math.min(m, b.stages.length - 1)]] ?? 0) : faceLayer(id, 2);
      const mg = b.crop ? .02 : .148, hgt = id === ID.TORCH ? .62 : 1;
      const uv = [[0, 1], [1, 1], [0, 0], [1, 0]];
      for (const s of [1, -1]) {
        pushQuad(solid, [
          [x + mg, y, z + (s > 0 ? mg : 1 - mg)], [x + 1 - mg, y, z + (s > 0 ? 1 - mg : mg)],
          [x + mg, y + hgt, z + (s > 0 ? mg : 1 - mg)], [x + 1 - mg, y + hgt, z + (s > 0 ? 1 - mg : mg)],
        ], lay, L, 0, uv, [s * .7, .7, s * .7]);
      }
      continue;
    }

    const isAlpha = !!b.alpha;
    const g = isAlpha ? alpha : solid;
    const water = id === ID.WATER;
    const openTop = water && getBlock(x, y + 1, z) !== ID.WATER;
    const tn = tint(x, y, z);
    let boxes = blockBoxes(id, m);
    if (b.connect) boxes = connectBoxes(id, x, y, z, boxes);
    const partial = b.full === false;

    for (const box of boxes) {
      for (let fi = 0; fi < 6; fi++) {
        const f = F[fi];
        const a = f.ax;
        // 箱の面がブロックの境界にあるときだけ、隣を見て隠す
        const onEdge = f.n[a] > 0 ? box[a + 3] >= .999 : box[a] <= .001;
        if (onEdge) {
          const nb = getBlock(x + f.n[0], y + f.n[1], z + f.n[2]);
          if (isFull(nb)) continue;
          if (isAlpha && nb === id) continue;
          if (water && nb === ID.ICE) continue;
          if (partial && nb === id && !b.connect) continue;
        }
        let lay = faceLayer(id, fi);
        if (b.front && f.n[1] === 0) {                 // かまど・チェストの正面
          const dirs = [[0, 0, 1], [1, 0, 0], [0, 0, -1], [-1, 0, 0]];
          const d = dirs[m & 3];
          if (f.n[0] === d[0] && f.n[2] === d[2]) lay = layer[b.front] ?? lay;
        }
        emitFace(g, x, y, z, box, fi, lay, openTop && f.n[1] === 1 ? 1 : 0, tn);
      }
    }
  }
  return { solid: finish(solid), alpha: finish(alpha) };
}

function finish(g) {
  if (!g.idx.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
  geo.setAttribute('aLayer', new THREE.Float32BufferAttribute(g.layer, 1));
  geo.setAttribute('aLight', new THREE.Float32BufferAttribute(g.light, 3));
  geo.setAttribute('aAnim', new THREE.Float32BufferAttribute(g.anim, 1));
  geo.setAttribute('aNormal', new THREE.Float32BufferAttribute(g.nrm, 3));
  geo.setIndex(g.idx);
  geo.computeBoundingSphere();
  return geo;
}
