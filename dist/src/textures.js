// textures.js — 32x32 のピクセルテクスチャを手続き生成し、
// WebGL2 の配列テクスチャ(DataArrayTexture)に詰め込む。
// 配列テクスチャならタイル間のにじみが無く、ミップマップも安全に効く。
import * as THREE from '../three.module.js';
import { blocks, items, isItem } from './blocks.js';

export const TS = 32; // 1タイルの解像度

// 決定論的な乱数（テクスチャは毎回同じ見た目に）
let _s = 1;
const srand = s => { _s = s >>> 0 || 1; };
const rnd = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) % 100000) / 100000; };

function hex2rgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

// 1タイル分のピクセルバッファを扱う小さな描画API
class Tile {
  constructor(seed) { this.d = new Uint8ClampedArray(TS * TS * 4); srand(seed); }
  set(x, y, c, a = 255) {
    if (x < 0 || y < 0 || x >= TS || y >= TS) return;
    const i = (y * TS + x) * 4;
    this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = a;
  }
  get(x, y) { const i = (((y + TS) % TS) * TS + ((x + TS) % TS)) * 4; return [this.d[i], this.d[i + 1], this.d[i + 2]]; }
  clear() { this.d.fill(0); return this; }
  // ベース色 + 粒状ノイズ
  base(hex, amt = .12, warp = 0) {
    const c = hex2rgb(hex);
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      let f = 1 + (rnd() - .5) * amt * 2;
      if (warp) f *= 1 + Math.sin((x * 1.7 + y * 2.3) * warp) * .05;
      this.set(x, y, [c[0] * f, c[1] * f, c[2] * f]);
    }
    return this;
  }
  // 斑点（鉱石や砂利など）
  blobs(hex, count, r0 = 2, r1 = 4, alpha = 1) {
    const c = hex2rgb(hex);
    for (let i = 0; i < count; i++) {
      const cx = rnd() * TS, cy = rnd() * TS, r = r0 + rnd() * (r1 - r0);
      for (let y = -r - 1; y <= r + 1; y++) for (let x = -r - 1; x <= r + 1; x++) {
        const d = Math.hypot(x, y) + (rnd() - .5) * 1.4;
        if (d > r) continue;
        const px = Math.floor(cx + x), py = Math.floor(cy + y);
        if (px < 0 || py < 0 || px >= TS || py >= TS) continue;
        const o = this.get(px, py), f = .88 + rnd() * .24;
        this.set(px, py, mix(o, [c[0] * f, c[1] * f, c[2] * f], alpha));
      }
    }
    return this;
  }
  speck(hex, density, f0 = .85, f1 = 1.15) {
    const c = hex2rgb(hex);
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      if (rnd() > density) continue;
      const f = f0 + rnd() * (f1 - f0);
      this.set(x, y, [c[0] * f, c[1] * f, c[2] * f]);
    }
    return this;
  }
  line(x0, y0, x1, y1, hex, alpha = 1) {
    const c = hex2rgb(hex), n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= n; i++) {
      const x = Math.round(x0 + (x1 - x0) * i / n), y = Math.round(y0 + (y1 - y0) * i / n);
      this.set(x, y, mix(this.get(x, y), c, alpha));
    }
    return this;
  }
  rect(x0, y0, w, h, hex, alpha = 1) {
    const c = hex2rgb(hex);
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      if (x < 0 || y < 0 || x >= TS || y >= TS) continue;
      const f = .93 + rnd() * .14;
      this.set(x, y, mix(this.get(x, y), [c[0] * f, c[1] * f, c[2] * f], alpha));
    }
    return this;
  }
  // 上辺から下へ垂れる草・雪のふち
  fringe(hex, depth = 10) {
    const c = hex2rgb(hex);
    for (let x = 0; x < TS; x++) {
      const d = Math.floor(depth * (.45 + rnd() * .55));
      for (let y = 0; y < d; y++) { const f = .9 + rnd() * .2; this.set(x, y, [c[0] * f, c[1] * f, c[2] * f]); }
    }
    return this;
  }
  // 立体感（上を明るく、下を暗く）
  shade(top = 1.12, bottom = .84) {
    for (let y = 0; y < TS; y++) {
      const f = top + (bottom - top) * (y / (TS - 1));
      for (let x = 0; x < TS; x++) { const c = this.get(x, y); this.set(x, y, [c[0] * f, c[1] * f, c[2] * f], this.d[(y * TS + x) * 4 + 3]); }
    }
    return this;
  }
  // 輪郭（丸石・レンガの目地など）
  bevel(cells, hex, light = '#ffffff') {
    const s = TS / cells;
    for (let cy = 0; cy < cells; cy++) for (let cx = 0; cx < cells; cx++) {
      const x0 = Math.floor(cx * s), y0 = Math.floor(cy * s), x1 = Math.floor((cx + 1) * s) - 1, y1 = Math.floor((cy + 1) * s) - 1;
      this.line(x0, y0, x1, y0, light, .35); this.line(x0, y0, x0, y1, light, .25);
      this.line(x0, y1, x1, y1, hex, .45); this.line(x1, y0, x1, y1, hex, .35);
    }
    return this;
  }
}

// --- 各タイルの絵柄 ---------------------------------------------------------
const painters = {
  dirt: t => t.base('#8a6243', .16).speck('#6f4e35', .1).blobs('#9c7150', 4, 2, 4, .5),
  grass_top: t => t.base('#67a247', .13).speck('#79b355', .2).speck('#55893a', .12).blobs('#6ead4d', 5, 2, 5, .35),
  grass_side: t => { painters.dirt(t); t.fringe('#67a247', 11); t.speck('#55893a', .05); },
  podzol_top: t => t.base('#5f4a2c', .18).speck('#7a6038', .18).speck('#43341f', .1),
  podzol_side: t => { painters.dirt(t); t.fringe('#5f4a2c', 9); },
  snow: t => t.base('#eef4f4', .05).speck('#ffffff', .25).speck('#d6e3e8', .06),
  snow_side: t => { painters.dirt(t); t.fringe('#eef4f4', 13); },
  stone: t => t.base('#8d9490', .1).blobs('#7f8783', 7, 3, 6, .4).blobs('#9aa19c', 5, 2, 4, .3).speck('#7b827e', .05),
  cobble: t => { t.base('#7c8382', .08); for (let i = 0; i < 9; i++) t.blobs('#8e9593', 1, 4, 6, .85); t.bevel(2, '#4f5654'); t.speck('#6a716f', .07); },
  mossy: t => { painters.cobble(t); t.blobs('#5f7f48', 9, 2, 5, .7); },
  granite: t => t.base('#b08774', .1).speck('#c79c86', .14).blobs('#8f6b5c', 5, 2, 4, .4),
  sand: t => t.base('#ded0a0', .07).speck('#efe3bb', .16).speck('#c9b98a', .1),
  sandstone: t => { t.base('#d9c893', .06); for (let y = 0; y < TS; y += 8) t.line(0, y, TS - 1, y, '#b8a672', .5); t.speck('#e6d8a6', .1); },
  sandstone_top: t => t.base('#e0d09c', .06).speck('#c6b482', .12),
  gravel: t => { t.base('#8a8783', .1); for (let i = 0; i < 14; i++) t.blobs(i % 3 ? '#9e9a95' : '#6f6c69', 1, 2, 4, .9); t.speck('#5d5a58', .06); },
  clay: t => t.base('#a4aab5', .07).speck('#b6bcc6', .12).blobs('#939aa6', 4, 3, 5, .3),
  log: t => { t.base('#6f5034', .09); for (let x = 0; x < TS; x += 6) t.rect(x, 0, 1 + Math.floor(rnd() * 2), TS, '#573d28', .55); t.speck('#7d5b3c', .08); },
  log_top: t => { t.base('#a37f4f', .08); for (let r = 3; r < 16; r += 3) { for (let a = 0; a < 64; a++) { const th = a / 64 * 6.283, rr = r + Math.sin(th * 3) * .8; t.set(Math.round(16 + Math.cos(th) * rr), Math.round(16 + Math.sin(th) * rr), hex2rgb('#7a5c38')); } } },
  birch_log: t => { t.base('#dcd7c8', .05); for (let i = 0; i < 7; i++) t.rect(Math.floor(rnd() * TS), Math.floor(rnd() * TS), 2 + Math.floor(rnd() * 5), 2, '#43413a', .85); t.speck('#c8c2b2', .08); },
  birch_top: t => t.base('#c5b68e', .07).speck('#a89a76', .1),
  pine_log: t => { t.base('#4c3728', .1); for (let x = 0; x < TS; x += 5) t.rect(x, 0, 1, TS, '#3a2a1e', .6); },
  pine_top: t => t.base('#7a5b3c', .08).speck('#5e462e', .12),
  leaves: t => { t.clear(); const c = '#4f883c'; for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) { const n = rnd(); if (n > .93) continue; const f = .72 + n * .6; const b = hex2rgb(c); t.set(x, y, [b[0] * f, b[1] * f, b[2] * f], 255); } t.blobs('#3f6f30', 6, 2, 5, .35); },
  birch_leaves: t => { painters.leaves(t); t.blobs('#86ab52', 10, 2, 5, .6); },
  pine_leaves: t => { painters.leaves(t); t.blobs('#2c5636', 10, 3, 6, .75); },
  planks: t => { t.base('#bb965e', .07); for (let y = 0; y < TS; y += 8) { t.line(0, y, TS - 1, y, '#8e6f42', .8); t.line(0, y + 1, TS - 1, y + 1, '#d3ab70', .3); } for (let i = 0; i < 10; i++) { const y = Math.floor(rnd() * TS); t.line(0, y, TS - 1, y, '#a07c4b', .2); } for (let i = 0; i < 3; i++) t.blobs('#8e6f42', 1, 1, 2, .6); },
  dark_planks: t => { t.base('#6b4a2c', .08); for (let y = 0; y < TS; y += 8) t.line(0, y, TS - 1, y, '#4d3520', .85); },
  bench_top: t => { painters.planks(t); t.rect(2, 2, 28, 28, '#8a6a3d', .25); t.line(16, 2, 16, 29, '#5f4726', .6); t.line(2, 16, 29, 16, '#5f4726', .6); },
  bench_side: t => { painters.planks(t); t.rect(0, 0, TS, 9, '#8a6a3d', .5); for (let x = 2; x < TS; x += 7) t.rect(x, 11, 4, 6, '#5f4726', .5); },
  brick: t => { t.base('#ac6955', .06); for (let y = 0; y < TS; y += 8) { t.rect(0, y, TS, 2, '#cfc3b4', .95); const off = (y / 8) % 2 ? 8 : 0; for (let x = off; x < TS + 8; x += 16) t.rect(x, y + 2, 2, 6, '#cfc3b4', .95); } },
  glass: t => {
    t.base('#dff6f7', .04);
    for (let i = 0; i < TS * TS; i++) t.d[i * 4 + 3] = 28;          // 中はほぼ透明
    const edge = (x, y, hex, a) => t.set(x, y, hex2rgb(hex), a);
    for (let i = 0; i < TS; i++) {                                   // 枠
      edge(i, 0, '#f4ffff', 230); edge(i, 1, '#e2f6f7', 150);
      edge(i, TS - 1, '#b9dee0', 230); edge(i, TS - 2, '#cfeaec', 150);
      edge(0, i, '#f4ffff', 230); edge(1, i, '#e2f6f7', 150);
      edge(TS - 1, i, '#b9dee0', 230); edge(TS - 2, i, '#cfeaec', 150);
    }
    for (let k = 0; k < 7; k++) {                                    // 光の筋
      const x = 4 + Math.floor(rnd() * 20), y = 4 + Math.floor(rnd() * 16);
      for (let j = 0; j < 7; j++) edge(x + j, y + j, '#ffffff', 120);
    }
  },
  ice: t => { t.base('#9ccdee', .06); t.blobs('#b9e0f6', 6, 3, 7, .5); for (let i = 0; i < 6; i++) { const x = Math.floor(rnd() * TS), y = Math.floor(rnd() * TS); t.line(x, y, x + 8 - Math.floor(rnd() * 16), y + 10, '#ffffff', .35); } for (let i = 0; i < TS * TS; i++) t.d[i * 4 + 3] = 190; },
  water: t => { t.base('#2f7fae', .06); for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) { const w = Math.sin((x * .4 + y * .22)) * .5 + Math.sin(y * .33 - x * .11) * .5; const c = t.get(x, y), f = 1 + w * .1; t.set(x, y, [c[0] * f, c[1] * f, c[2] * f], 190); } },
  coal_ore: t => { painters.stone(t); t.blobs('#26292b', 5, 2, 4, .95); },
  iron_ore: t => { painters.stone(t); t.blobs('#c79f79', 5, 2, 4, .9); },
  gold_ore: t => { painters.stone(t); t.blobs('#e3bb54', 5, 2, 4, .92); },
  diamond_ore: t => { painters.stone(t); t.blobs('#54e0d6', 5, 2, 4, .92); },
  obsidian: t => { t.base('#221a33', .12).speck('#3b2d56', .06).blobs('#171125', 5, 3, 6, .5); },
  bedrock: t => { t.base('#3a3d3f', .2); for (let i = 0; i < 12; i++) t.blobs(i % 2 ? '#24262a' : '#55595c', 1, 3, 6, .8); },
  lantern: t => { t.base('#6b5029', .08); t.rect(4, 4, 24, 24, '#ffcf76', .95); t.rect(6, 6, 20, 20, '#ffe9b0', .8); for (let i = 0; i < 4; i++) t.rect(3 + i * 8, 0, 2, TS, '#4c3a1e', .9); t.rect(0, 0, TS, 3, '#4c3a1e', .9); t.rect(0, 29, TS, 3, '#4c3a1e', .9); },
  lantern_top: t => { t.base('#4c3a1e', .1); t.rect(8, 8, 16, 16, '#ffe9b0', .9); },
  glowstone: t => { t.base('#c9a25a', .08); t.blobs('#ffeab4', 9, 3, 6, .9); t.speck('#fff6d8', .1); },
  torch: t => { t.clear(); t.rect(14, 12, 4, 20, '#8a6435', 1); t.rect(13, 8, 6, 5, '#ffbb55', 1); t.rect(14, 6, 4, 3, '#fff0b0', 1); t.rect(15, 4, 2, 2, '#ffe08a', .8); },
  tall_grass: t => { t.clear(); for (let i = 0; i < 16; i++) { const x = 3 + Math.floor(rnd() * 26), h = 10 + Math.floor(rnd() * 16), b = 1 + Math.floor(rnd() * 2); for (let y = 0; y < h; y++) { const xx = x + Math.round(Math.sin(y * .2) * 2); const f = .7 + (y / h) * .6; const c = hex2rgb('#74a844'); t.set(xx, TS - 1 - y, [c[0] * f, c[1] * f, c[2] * f], 255); if (b > 1) t.set(xx + 1, TS - 1 - y, [c[0] * f * .9, c[1] * f * .9, c[2] * f * .9], 255); } } },
  rose: t => { painters.tall_grass(t); t.d.fill(0, 0, TS * 12 * 4); for (let i = 0; i < 5; i++) { const x = 6 + i * 5, y = 10 + Math.floor(rnd() * 5); t.rect(x, y, 4, 4, '#c8484a', 1); t.rect(x + 1, y + 1, 2, 2, '#f0d46a', 1); t.rect(x + 1, y + 4, 2, 8, '#4f8a3c', 1); } },
  daisy: t => { painters.tall_grass(t); t.d.fill(0, 0, TS * 12 * 4); for (let i = 0; i < 5; i++) { const x = 6 + i * 5, y = 10 + Math.floor(rnd() * 5); t.rect(x, y, 4, 4, '#f2f0e2', 1); t.rect(x + 1, y + 1, 2, 2, '#f0c04a', 1); t.rect(x + 1, y + 4, 2, 8, '#4f8a3c', 1); } },
  mushroom: t => { t.clear(); for (const [x, y, c] of [[7, 16, '#b4553f'], [18, 13, '#c46a4a']]) { t.rect(x, y, 9, 5, c, 1); t.rect(x + 1, y + 5, 7, 2, '#e8dcc4', 1); t.rect(x + 3, y + 6, 3, 8, '#efe6d2', 1); } },
  cactus: t => { t.base('#4f7b3a', .08); t.rect(0, 0, 2, TS, '#3d6130', .8); t.rect(30, 0, 2, TS, '#3d6130', .8); for (let i = 0; i < 22; i++) { const x = 4 + Math.floor(rnd() * 24), y = Math.floor(rnd() * TS); t.set(x, y, hex2rgb('#dfe6c2')); t.set(x, y + 1, hex2rgb('#c9d3a4')); } },
  cactus_top: t => t.base('#5d8c44', .08).blobs('#4a7236', 4, 3, 6, .4),
  wool_w: t => t.base('#e9e9e4', .05).speck('#f6f6f2', .2).blobs('#d8d8d2', 5, 3, 6, .25),
  wool_r: t => t.base('#a9382f', .07).speck('#bf4a40', .18).blobs('#8e2a24', 5, 3, 6, .25),
  wool_b: t => t.base('#3a5ea8', .07).speck('#4a71bd', .18).blobs('#2e4d8c', 5, 3, 6, .25),
  wool_y: t => t.base('#d6ab3a', .07).speck('#e8bf4e', .18).blobs('#b8912c', 5, 3, 6, .25),
  wool_k: t => t.base('#2b2b30', .1).speck('#3a3a41', .18).blobs('#1f1f24', 5, 3, 6, .25),
  wool_g: t => t.base('#4e7a35', .07).speck('#5f8e42', .18).blobs('#3f6529', 5, 3, 6, .25),
  stone_brick: t => { t.base('#8a8f8c', .07); for (let y = 0; y < TS; y += 8) { t.line(0, y, TS - 1, y, '#6d726f', .9); const off = (y / 8) % 2 ? 8 : 0; for (let x = off; x < TS + 8; x += 16) t.rect(x, y + 1, 1, 7, '#6d726f', .9); } t.speck('#9aa09c', .07); },
  furnace_side: t => { painters.stone(t); t.rect(0, 0, TS, 3, '#6c7170', .5); },
  furnace_top: t => { painters.stone(t); t.rect(6, 6, 20, 20, '#6a706e', .5); t.rect(9, 9, 14, 14, '#585e5c', .6); },
  furnace_front: t => { painters.stone(t); t.rect(6, 14, 20, 14, '#3a3d3c', .95); t.rect(8, 16, 16, 10, '#26282a', 1); t.rect(6, 8, 20, 4, '#6a706e', .6); },
  furnace_lit: t => { painters.furnace_front(t); t.rect(8, 16, 16, 10, '#d8631f', .95); t.rect(9, 20, 14, 6, '#ffb347', .9); t.rect(11, 24, 10, 3, '#ffe08a', .8); },
  chest_top: t => { t.base('#a97c3f', .07); t.rect(1, 1, 30, 30, '#8c6431', .45); for (let x = 0; x < TS; x += 10) t.line(x, 1, x, 30, '#7a5629', .35); },
  chest_side: t => { t.base('#a97c3f', .07); t.rect(0, 0, TS, 7, '#8c6431', .5); t.rect(0, 13, TS, 3, '#5f4423', .7); for (let x = 0; x < TS; x += 10) t.line(x, 0, x, TS - 1, '#7a5629', .3); },
  chest_front: t => { painters.chest_side(t); t.rect(13, 12, 6, 8, '#d8c37a', .95); t.rect(15, 15, 2, 3, '#3a3128', 1); },
  door_top: t => { t.base('#9a6f3c', .06); t.rect(1, 1, 30, 30, '#825c30', .4); t.rect(6, 4, 20, 14, '#c9e6ea', .55); t.rect(6, 4, 20, 2, '#6b4a26', .8); t.rect(2, 26, 28, 3, '#6b4a26', .55); t.rect(25, 20, 3, 5, '#d8c37a', .9); },
  door_bottom: t => { t.base('#9a6f3c', .06); t.rect(1, 1, 30, 30, '#825c30', .4); t.rect(4, 5, 24, 22, '#8a6234', .5); t.rect(4, 5, 24, 2, '#6b4a26', .7); t.rect(25, 12, 3, 5, '#d8c37a', .9); },
  bed_top: t => { t.base('#b03a34', .07); t.rect(2, 2, 28, 12, '#f2efe6', .9); t.rect(3, 3, 26, 9, '#ffffff', .5); t.rect(0, 0, TS, 2, '#8d2b26', .6); },
  bed_side: t => { t.base('#b03a34', .07); t.rect(0, 0, TS, 10, '#f2efe6', .85); t.rect(0, 24, TS, 8, '#9a7444', .9); },
  farmland: t => { painters.dirt(t); t.rect(0, 0, TS, TS, '#4a3320', .35); for (let x = 3; x < TS; x += 8) t.rect(x, 0, 3, TS, '#2f2214', .5); t.speck('#5d4128', .1); },
  hay: t => { t.base('#c8a33c', .07); for (let y = 0; y < TS; y += 5) t.line(0, y, TS - 1, y, '#a5831f', .5); t.speck('#dcb851', .14); },
  hay_top: t => { t.base('#b08c2c', .08); t.rect(3, 3, 26, 26, '#d0aa46', .5); t.speck('#8f6e18', .12); },
  pumpkin: t => { t.base('#d08a2a', .07); for (let x = 0; x < TS; x += 6) t.rect(x, 0, 2, TS, '#b06f1c', .55); t.rect(0, 0, TS, 2, '#8f5a16', .5); },
  pumpkin_top: t => { t.base('#c07c22', .07); t.rect(13, 13, 6, 6, '#6f5a2a', .9); t.speck('#a86a1a', .1); },
  pumpkin_face: t => { painters.pumpkin(t); t.rect(6, 9, 7, 6, '#3a2410', 1); t.rect(19, 9, 7, 6, '#3a2410', 1); t.rect(9, 19, 14, 5, '#3a2410', 1); t.rect(12, 17, 2, 3, '#3a2410', 1); t.rect(18, 17, 2, 3, '#3a2410', 1); },
  pumpkin_lit: t => { painters.pumpkin(t); t.rect(6, 9, 7, 6, '#ffd166', 1); t.rect(19, 9, 7, 6, '#ffd166', 1); t.rect(9, 19, 14, 5, '#ffb347', 1); },
  lava: t => { t.base('#d8500f', .1); t.blobs('#ffb347', 7, 3, 7, .8); t.blobs('#8f2d06', 5, 2, 5, .5); t.speck('#ffe08a', .06); },
  fire: t => { t.clear(); for (let x = 0; x < TS; x++) { const h = 12 + Math.floor(Math.abs(Math.sin(x * .4)) * 16); for (let y = 0; y < h; y++) { const f = y / h; const c = f > .7 ? '#ffe08a' : f > .4 ? '#ff9a3c' : '#e2521f'; t.set(x, TS - 1 - y, hex2rgb(c), 235); } } },
  ladder: t => { t.clear(); t.rect(4, 0, 3, TS, '#a5813f', 1); t.rect(25, 0, 3, TS, '#a5813f', 1); for (let y = 3; y < TS; y += 9) t.rect(4, y, 24, 3, '#8d6c33', 1); },
};

// 小麦の成長（4段階）
for (let s = 0; s < 4; s++) {
  painters['wheat' + s] = t => {
    t.clear();
    srand(910 + s * 31);
    const h = 10 + s * 6;
    const col = s < 2 ? '#5f9440' : s === 2 ? '#9aa848' : '#cdae4e';
    for (let i = 0; i < 5; i++) {
      const x = 3 + i * 6 + ((i % 2) ? 1 : 0);
      const hh = h - (i % 2) * 2;
      for (let y = 0; y < hh; y++) {
        const head = s >= 2 && y > hh - 7;
        const c = hex2rgb(head ? (s === 3 ? '#e8cf7a' : '#b9bb5c') : col);
        const f = .82 + (y / hh) * .34;
        const yy = TS - 1 - y;
        t.set(x, yy, [c[0] * f, c[1] * f, c[2] * f], 255);
        t.set(x + 1, yy, [c[0] * f * .88, c[1] * f * .88, c[2] * f * .88], 255);
        if (head && y % 2 === 0) {                       // 穂
          t.set(x - 1, yy, hex2rgb(s === 3 ? '#f0dc96' : '#c3c76a'), 255);
          t.set(x + 2, yy, hex2rgb(s === 3 ? '#d9bd63' : '#aeb254'), 255);
        }
      }
    }
  };
}

// 雲・太陽・月（アトラスとは別に使う）
export function cloudTexture(size = 128) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  srand(4242);
  // 大きめの塊をいくつか置いて、ブロックらしい雲にする
  const grid = new Float32Array(size * size);
  for (let k = 0; k < 58; k++) {
    const cx = rnd() * size, cy = rnd() * size, r = 8 + rnd() * 20;
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      if (Math.hypot(x, y) > r) continue;
      const px = ((cx + x) | 0 + size) % size, py = ((cy + y) | 0 + size) % size;
      grid[(py * size + px + size * size) % (size * size)] = 1;
    }
  }
  for (let i = 0; i < size * size; i++) {
    const on = grid[i] > 0;
    img.data[i * 4] = 255; img.data[i * 4 + 1] = 255; img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = on ? 200 : 0;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function discTexture(kind) {
  const S = 32;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  if (kind === 'sun') {
    const g = ctx.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
    g.addColorStop(0, '#fffdf0'); g.addColorStop(.55, '#ffe9a8'); g.addColorStop(1, '#ffd06a');
    ctx.fillStyle = g;
    ctx.fillRect(2, 2, S - 4, S - 4);
  } else {
    ctx.fillStyle = '#e8eef6';
    ctx.fillRect(3, 3, S - 6, S - 6);
    ctx.fillStyle = '#c3cede';
    for (const [x, y, r] of [[10, 12, 3], [20, 9, 2], [16, 20, 4], [23, 22, 2]]) {
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

// 破壊のひび（10段階）
for (let i = 0; i < 10; i++) {
  painters['crack' + i] = t => {
    t.clear();
    srand(700 + i * 13);
    const n = 3 + i * 3;
    for (let k = 0; k < n; k++) {
      let x = Math.floor(rnd() * TS), y = Math.floor(rnd() * TS);
      const len = 4 + Math.floor(rnd() * (3 + i * 2));
      for (let j = 0; j < len; j++) {
        t.set(x, y, [12, 10, 10], 205);
        t.set(x + 1, y, [70, 66, 64], 120);
        x += Math.round(rnd() * 2 - 1);
        y += Math.round(rnd() * 2 - 1);
        if (x < 0 || y < 0 || x >= TS || y >= TS) break;
      }
    }
  };
}

// --- アトラス構築 -----------------------------------------------------------
export const layer = {};      // タイル名 -> レイヤー番号
export const tileData = {};   // タイル名 -> Uint8ClampedArray（UIアイコン用）
const keys = Object.keys(painters);
keys.forEach((k, i) => { layer[k] = i; });

export function buildAtlas() {
  const n = keys.length;
  const data = new Uint8Array(TS * TS * 4 * n);
  keys.forEach((k, i) => {
    const t = new Tile(i * 9181 + 7);
    painters[k](t);
    tileData[k] = t.d;
    data.set(t.d, i * TS * TS * 4);
  });
  const tex = new THREE.DataArrayTexture(data, TS, TS, n);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

// ブロックの面 -> レイヤー番号（0:+X 1:-X 2:+Y 3:-Y 4:+Z 5:-Z）
export function faceLayer(id, faceIndex) {
  const b = blocks[id];
  if (!b || !b.tiles) return 0;
  const t = b.tiles;
  const key = t.length === 1 ? t[0] : faceIndex === 2 ? t[0] : faceIndex === 3 ? (t[2] || t[0]) : t[1];
  return layer[key] ?? 0;
}

// --- UI 用アイコン ----------------------------------------------------------
const iconCache = new Map();
export function iconURL(id, size = 64) {
  const ck = id + ':' + size;
  if (iconCache.has(ck)) return iconCache.get(ck);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // タイルを明るさ f で 1x1 に描く用のオフスクリーン
  const tileCanvas = (key, f) => {
    const d = tileData[key];
    const off = document.createElement('canvas');
    off.width = off.height = TS;
    if (!d) return off;
    const c2 = off.getContext('2d');
    const img = c2.createImageData(TS, TS);
    for (let i = 0; i < d.length; i += 4) {
      img.data[i] = Math.min(255, d[i] * f);
      img.data[i + 1] = Math.min(255, d[i + 1] * f);
      img.data[i + 2] = Math.min(255, d[i + 2] * f);
      img.data[i + 3] = d[i + 3];
    }
    c2.putImageData(img, 0, 0);
    return off;
  };
  // 平行四辺形へ貼る（e1,e2 が辺ベクトル）
  const para = (canvas, ox, oy, e1, e2) => {
    ctx.save();
    ctx.setTransform(e1[0], e1[1], e2[0], e2[1], ox, oy);
    ctx.drawImage(canvas, 0, 0, 1, 1);
    ctx.restore();
  };

  if (isItem(id)) {
    const it = items[id] || {};
    const s = size / 16;
    ctx.lineJoin = 'round';
    if (it.tool) {
      ctx.fillStyle = '#8a6435';
      ctx.fillRect(5.5 * s, 6 * s, 2 * s, 8.5 * s);   // 柄
      ctx.fillStyle = '#6b4c28';
      ctx.fillRect(5.5 * s, 6 * s, .7 * s, 8.5 * s);
      ctx.fillStyle = it.color;
      if (it.tool === 4) { ctx.fillRect(6.4 * s, 1.6 * s, 2.6 * s, 6 * s); ctx.fillStyle = '#a9846a'; ctx.fillRect(4.4 * s, 7.2 * s, 5 * s, 1.4 * s); }
      else if (it.tool === 3) { ctx.fillRect(4.6 * s, 1.8 * s, 4.6 * s, 3.4 * s); }
      else if (it.tool === 2) { ctx.fillRect(4.6 * s, 1.8 * s, 5.4 * s, 2.2 * s); ctx.fillRect(4.6 * s, 1.8 * s, 2.2 * s, 4.4 * s); }
      else { ctx.fillRect(3 * s, 3 * s, 9.6 * s, 2 * s); ctx.fillRect(3 * s, 1.6 * s, 2.2 * s, 2.2 * s); ctx.fillRect(10.4 * s, 1.6 * s, 2.2 * s, 2.2 * s); }
    } else if (id === 100) { // 棒
      ctx.fillStyle = '#9a7444';
      ctx.save(); ctx.translate(size / 2, size / 2); ctx.rotate(-.5);
      ctx.fillRect(-1.4 * s, -6 * s, 2.8 * s, 12 * s); ctx.restore();
    } else if (it.armor !== undefined) {           // 防具
      const s2 = size / 16;
      const dark = '#00000038';
      ctx.fillStyle = it.color;
      if (it.armor === 0) {                        // 兜
        ctx.fillRect(3 * s2, 3 * s2, 10 * s2, 7 * s2);
        ctx.fillRect(2 * s2, 5 * s2, 12 * s2, 6 * s2);
        ctx.fillStyle = dark; ctx.fillRect(5 * s2, 7 * s2, 6 * s2, 4 * s2);
      } else if (it.armor === 1) {                 // 胴
        ctx.fillRect(4 * s2, 3 * s2, 8 * s2, 10 * s2);
        ctx.fillRect(1.5 * s2, 4 * s2, 3 * s2, 6 * s2);
        ctx.fillRect(11.5 * s2, 4 * s2, 3 * s2, 6 * s2);
        ctx.fillStyle = dark; ctx.fillRect(6 * s2, 5 * s2, 4 * s2, 6 * s2);
      } else if (it.armor === 2) {                 // 脚
        ctx.fillRect(3.5 * s2, 2 * s2, 9 * s2, 4 * s2);
        ctx.fillRect(3.5 * s2, 6 * s2, 3.5 * s2, 8 * s2);
        ctx.fillRect(9 * s2, 6 * s2, 3.5 * s2, 8 * s2);
      } else {                                     // 足
        ctx.fillRect(2.5 * s2, 6 * s2, 5 * s2, 6 * s2);
        ctx.fillRect(8.5 * s2, 6 * s2, 5 * s2, 6 * s2);
        ctx.fillStyle = dark; ctx.fillRect(2.5 * s2, 11 * s2, 11 * s2, 2 * s2);
      }
    } else if (it.bow) {                           // 弓
      const s2 = size / 16;
      ctx.strokeStyle = '#a5813f'; ctx.lineWidth = 1.6 * s2;
      ctx.beginPath(); ctx.arc(5 * s2, 8 * s2, 6 * s2, -1.1, 1.1); ctx.stroke();
      ctx.strokeStyle = '#e8e6dc'; ctx.lineWidth = .7 * s2;
      ctx.beginPath(); ctx.moveTo(7.6 * s2, 2.6 * s2); ctx.lineTo(7.6 * s2, 13.4 * s2); ctx.stroke();
    } else if (id === 161) {                       // 矢
      const s2 = size / 16;
      ctx.strokeStyle = '#b9b3a6'; ctx.lineWidth = 1.2 * s2;
      ctx.beginPath(); ctx.moveTo(3 * s2, 13 * s2); ctx.lineTo(12 * s2, 4 * s2); ctx.stroke();
      ctx.fillStyle = '#5a5f63';
      ctx.beginPath(); ctx.moveTo(13.5 * s2, 2.5 * s2); ctx.lineTo(10 * s2, 4 * s2); ctx.lineTo(12 * s2, 6 * s2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e8e6dc'; ctx.fillRect(2 * s2, 12 * s2, 3 * s2, 2.4 * s2);
    } else {
      ctx.fillStyle = it.color || '#ccc';
      ctx.beginPath();
      ctx.moveTo(size * .5, size * .16); ctx.lineTo(size * .86, size * .5);
      ctx.lineTo(size * .5, size * .84); ctx.lineTo(size * .14, size * .5);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.28)';
      ctx.beginPath(); ctx.moveTo(size * .5, size * .16); ctx.lineTo(size * .86, size * .5); ctx.lineTo(size * .5, size * .5); ctx.closePath(); ctx.fill();
    }
  } else {
    const b = blocks[id];
    if (!b) return '';
    if (b.plant) {
      para(tileCanvas(b.tiles[0], 1.08), size * .1, size * .08, [size * .8, 0], [0, size * .84]);
    } else {
      const t = b.tiles, top = t[0], side = t.length === 1 ? t[0] : t[1];
      const hw = size * .40, hh = hw * .5, hgt = hw * .92;
      const cx = size / 2, y0 = size * .10;
      // 上面
      para(tileCanvas(top, 1.12), cx, y0, [hw, hh], [-hw, hh]);
      // 左面
      para(tileCanvas(side, .80), cx - hw, y0 + hh, [hw, hh], [0, hgt]);
      // 右面
      para(tileCanvas(side, .62), cx, y0 + hh * 2, [hw, -hh], [0, hgt]);
    }
  }
  const url = cv.toDataURL();
  iconCache.set(ck, url);
  return url;
}

// 手に持つブロック用：タイル1枚を THREE.CanvasTexture にする
const texCache = new Map();
export function tileTexture(key) {
  if (texCache.has(key)) return texCache.get(key);
  const d = tileData[key];
  const cv = document.createElement('canvas');
  cv.width = cv.height = TS;
  if (d) {
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(TS, TS);
    img.data.set(d);
    ctx.putImageData(img, 0, 0);
  }
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}
export function blockTextures(id) {
  const b = blocks[id];
  if (!b || !b.tiles) return null;
  const t = b.tiles, top = t[0], side = t.length === 1 ? t[0] : t[1], bottom = t.length > 2 ? t[2] : t[0];
  // BoxGeometry の面順: +X,-X,+Y,-Y,+Z,-Z
  return [side, side, top, bottom, side, side].map(tileTexture);
}
