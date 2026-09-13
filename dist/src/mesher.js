// mesher.js — チャンクを1枚のジオメトリに焼き込む
// 面ごとの陰影 + アンビエントオクルージョン + 4点平均のスムースライティング。
import * as THREE from '../three.module.js';
import { getBlock, skyAt, blockAt, isOpaque, CH, H } from './world.js';
import { blocks, ID } from './blocks.js';
import { faceLayer } from './textures.js';

const F = [
  { n: [1, 0, 0], p: [[1, 0, 1], [1, 0, 0], [1, 1, 1], [1, 1, 0]], s: .80 },
  { n: [-1, 0, 0], p: [[0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 1, 1]], s: .74 },
  { n: [0, 1, 0], p: [[0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0]], s: 1.0 },
  { n: [0, -1, 0], p: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]], s: .52 },
  { n: [0, 0, 1], p: [[0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]], s: .90 },
  { n: [0, 0, -1], p: [[1, 0, 0], [0, 0, 0], [1, 1, 0], [0, 1, 0]], s: .86 },
];
// 面ごとの接線軸（法線でない2軸）
F.forEach(f => { f.axis = f.n[0] ? 0 : f.n[1] ? 1 : 2; f.t = [0, 1, 2].filter(a => a !== f.axis); });

const AO = [.46, .68, .85, 1.0];

// ブロック位置から決まる、ごくわずかな明暗のゆらぎ。
// 平らな壁が「のっぺり一枚」に見えるのを防ぐ。
function tint(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 1103515245) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return .945 + ((h ^ (h >>> 16)) >>> 0) % 1000 / 1000 * .11;
}

function vertexLight(x, y, z, f, p) {
  const [nx, ny, nz] = [x + f.n[0], y + f.n[1], z + f.n[2]];
  const d = [0, 0, 0];
  d[f.t[0]] = p[f.t[0]] ? 1 : -1;
  const e = [0, 0, 0];
  e[f.t[1]] = p[f.t[1]] ? 1 : -1;
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

function pushQuad(g, verts, layer, lights, anim) {
  const base = g.pos.length / 3;
  for (let k = 0; k < 4; k++) {
    g.pos.push(verts[k][0], verts[k][1], verts[k][2]);
    g.uv.push(k % 2 ? 1 : 0, k > 1 ? 0 : 1);
    g.layer.push(layer);
    g.light.push(lights[k][0], lights[k][1], lights[k][2]);
    g.anim.push(anim[k]);
  }
  // AO の段差が目立たないように四角形を割る向きを選ぶ
  const a = lights[0][2] + lights[3][2], b = lights[1][2] + lights[2][2];
  if (a > b) g.idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  else g.idx.push(base + 1, base + 3, base + 0, base + 0, base + 3, base + 2);
}

const newG = () => ({ pos: [], uv: [], layer: [], light: [], anim: [], idx: [] });

function finish(g) {
  if (!g.idx.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
  geo.setAttribute('aLayer', new THREE.Float32BufferAttribute(g.layer, 1));
  geo.setAttribute('aLight', new THREE.Float32BufferAttribute(g.light, 3));
  geo.setAttribute('aAnim', new THREE.Float32BufferAttribute(g.anim, 1));
  geo.setIndex(g.idx);
  geo.computeBoundingSphere();
  return geo;
}

const Z4 = [0, 0, 0, 0];

export function buildChunk(cx, cz) {
  const solid = newG(), alpha = newG();
  const x0 = cx * CH, z0 = cz * CH;
  for (let x = x0; x < x0 + CH; x++) for (let z = z0; z < z0 + CH; z++) for (let y = 0; y < H; y++) {
    const id = getBlock(x, y, z);
    if (!id) continue;
    const b = blocks[id];

    if (b.plant) { // 草花・たいまつは交差した板
      const sky = skyAt(x, y, z) / 15, blk = blockAt(x, y, z) / 15;
      const L = [[sky, blk, .95], [sky, blk, .95], [sky, blk, .95], [sky, blk, .95]];
      const lay = faceLayer(id, 2);
      const m = .148, hgt = id === ID.TORCH ? .62 : 1;
      for (const s of [1, -1]) {
        pushQuad(solid, [
          [x + m, y, z + (s > 0 ? m : 1 - m)], [x + 1 - m, y, z + (s > 0 ? 1 - m : m)],
          [x + m, y + hgt, z + (s > 0 ? m : 1 - m)], [x + 1 - m, y + hgt, z + (s > 0 ? 1 - m : m)],
        ], lay, L, Z4);
      }
      continue;
    }

    const isAlpha = !!b.alpha;
    const g = isAlpha ? alpha : solid;
    const water = id === ID.WATER;
    const openTop = water && getBlock(x, y + 1, z) !== ID.WATER;

    for (let fi = 0; fi < 6; fi++) {
      const f = F[fi];
      const nb = getBlock(x + f.n[0], y + f.n[1], z + f.n[2]);
      if (isOpaque(nb)) continue;
      if (isAlpha && nb === id) continue;
      if (water && nb === ID.ICE) continue;
      const verts = [], lights = [], anim = [];
      const tn = tint(x, y, z);
      for (let k = 0; k < 4; k++) {
        const p = f.p[k];
        verts.push([x + p[0], y + p[1], z + p[2]]);
        const vl = vertexLight(x, y, z, f, p);
        vl[2] *= tn;
        lights.push(vl);
        anim.push(openTop && p[1] === 1 ? 1 : 0);
      }
      pushQuad(g, verts, faceLayer(id, fi), lights, anim);
    }
  }
  return { solid: finish(solid), alpha: finish(alpha) };
}
