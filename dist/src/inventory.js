// inventory.js — スロット式の持ち物とクラフト格子
// 本家と同じく「64個まで重なる」「道具は重ならない」「格子に並べた形でレシピが決まる」。
import { items, isItem, ID, IT } from './blocks.js';

export const HOTBAR = 9;
export const SLOTS = 36;            // 0-8 ホットバー / 9-35 持ち物
export const STACK = 64;

export const maxStack = id => (isItem(id) && (items[id]?.tool || items[id]?.dmg)) ? 1 : STACK;
export const newStack = (id, n = 1) => {
  const s = { id, n };
  const it = items[id];
  if (it?.dur) s.dur = it.dur;
  return s;
};

export class Inventory {
  constructor() { this.slots = new Array(SLOTS).fill(null); }
  clear() { this.slots.fill(null); }
  get(i) { return this.slots[i]; }
  set(i, s) { this.slots[i] = s; }

  count(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.n;
    return n;
  }

  // 入るだけ入れて、入らなかった数を返す
  add(id, n = 1, dur) {
    const max = maxStack(id);
    if (max > 1) {                                   // まず同じ種類の山に足す
      for (const s of this.slots) {
        if (!s || s.id !== id || s.n >= max) continue;
        const put = Math.min(max - s.n, n);
        s.n += put; n -= put;
        if (!n) return 0;
      }
    }
    for (let i = 0; i < SLOTS && n > 0; i++) {       // 空きスロットへ
      if (this.slots[i]) continue;
      const put = Math.min(max, n);
      const s = newStack(id, put);
      if (dur !== undefined) s.dur = dur;
      this.slots[i] = s;
      n -= put;
    }
    return n;
  }

  remove(id, n = 1) {
    for (let i = SLOTS - 1; i >= 0 && n > 0; i--) {
      const s = this.slots[i];
      if (!s || s.id !== id) continue;
      const take = Math.min(s.n, n);
      s.n -= take; n -= take;
      if (s.n <= 0) this.slots[i] = null;
    }
    return n === 0;
  }

  // 1つ減らす（設置・消費用）
  consumeAt(i) {
    const s = this.slots[i];
    if (!s) return false;
    s.n--;
    if (s.n <= 0) this.slots[i] = null;
    return true;
  }

  firstEmpty() { return this.slots.indexOf(null); }
  toJSON() { return this.slots.map(s => (s ? (s.dur !== undefined ? [s.id, s.n, s.dur] : [s.id, s.n]) : 0)); }
  fromJSON(a) {
    this.clear();
    if (!Array.isArray(a)) return;
    a.slice(0, SLOTS).forEach((v, i) => {
      if (!v) return;
      const s = { id: v[0], n: v[1] };
      if (v[2] !== undefined) s.dur = v[2];
      this.slots[i] = s;
    });
  }
}

// --- レシピ ---------------------------------------------------------------
// pattern: 形の決まったレシピ（空白は「何も置かない」）
// shapeless: 並び順を問わないレシピ
const ANY_LOG = [ID.LOG, ID.BIRCH_LOG, ID.PINE_LOG];
const ANY_PLANK = [ID.PLANKS, ID.DARK_PLANKS];
const ANY_WOOL = [ID.WOOL_W, ID.WOOL_R, ID.WOOL_B, ID.WOOL_Y, ID.WOOL_K, ID.WOOL_G];

export const recipes = [
  { shapeless: [ANY_LOG], out: [ID.PLANKS, 4] },
  { pattern: ['#', '#'], key: { '#': ANY_PLANK }, out: [IT.STICK, 4] },
  { pattern: ['##', '##'], key: { '#': ANY_PLANK }, out: [ID.BENCH, 1] },
  { pattern: ['##', '##'], key: { '#': ID.COBBLE }, out: [ID.FURNACE, 1] },
  { pattern: ['###', '###'], key: { '#': ANY_PLANK }, out: [ID.CHEST, 1] },
  { pattern: ['c', '|'], key: { c: IT.COAL, '|': IT.STICK }, out: [ID.TORCH, 4] },
  { pattern: ['###', '#=#', '###'], key: { '#': IT.IRON, '=': IT.COAL }, out: [ID.LANTERN, 2] },

  // 道具
  { pattern: ['###', ' | ', ' | '], key: { '#': ANY_PLANK, '|': IT.STICK }, out: [IT.WOOD_PICK, 1] },
  { pattern: ['###', ' | ', ' | '], key: { '#': ID.COBBLE, '|': IT.STICK }, out: [IT.STONE_PICK, 1] },
  { pattern: ['###', ' | ', ' | '], key: { '#': IT.IRON, '|': IT.STICK }, out: [IT.IRON_PICK, 1] },
  { pattern: ['###', ' | ', ' | '], key: { '#': IT.DIAMOND, '|': IT.STICK }, out: [IT.DIAMOND_PICK, 1] },
  { pattern: ['##', '#|', ' |'], key: { '#': ANY_PLANK, '|': IT.STICK }, out: [IT.WOOD_AXE, 1] },
  { pattern: ['##', '#|', ' |'], key: { '#': ID.COBBLE, '|': IT.STICK }, out: [IT.STONE_AXE, 1] },
  { pattern: ['##', '#|', ' |'], key: { '#': IT.IRON, '|': IT.STICK }, out: [IT.IRON_AXE, 1] },
  { pattern: ['#', '|', '|'], key: { '#': ANY_PLANK, '|': IT.STICK }, out: [IT.WOOD_SHOVEL, 1] },
  { pattern: ['#', '|', '|'], key: { '#': ID.COBBLE, '|': IT.STICK }, out: [IT.STONE_SHOVEL, 1] },
  { pattern: ['#', '|', '|'], key: { '#': IT.IRON, '|': IT.STICK }, out: [IT.IRON_SHOVEL, 1] },
  { pattern: ['#', '#', '|'], key: { '#': ID.COBBLE, '|': IT.STICK }, out: [IT.SWORD, 1] },
  { pattern: ['#', '#', '|'], key: { '#': IT.IRON, '|': IT.STICK }, out: [IT.IRON_SWORD, 1] },

  // 建材
  { pattern: ['###'], key: { '#': ID.STONE }, out: [ID.STONE_SLAB, 6] },
  { pattern: ['###'], key: { '#': ID.COBBLE }, out: [ID.COBBLE_SLAB, 6] },
  { pattern: ['###'], key: { '#': ANY_PLANK }, out: [ID.WOOD_SLAB, 6] },
  { pattern: ['#  ', '## ', '###'], key: { '#': ID.COBBLE }, out: [ID.COBBLE_STAIRS, 4] },
  { pattern: ['#  ', '## ', '###'], key: { '#': ANY_PLANK }, out: [ID.WOOD_STAIRS, 4] },
  { pattern: ['#|#', '#|#'], key: { '#': ANY_PLANK, '|': IT.STICK }, out: [ID.FENCE, 3] },
  { pattern: ['##', '##', '##'], key: { '#': ANY_PLANK }, out: [ID.DOOR, 2] },
  { pattern: ['###', '###'], key: { '#': ID.GLASS }, out: [ID.GLASS_PANE, 16] },
  { pattern: ['###', '###'], key: { '#': ANY_WOOL }, out: [ID.BED, 1], extra: [ANY_PLANK, 3] },
  { pattern: ['##', '##'], key: { '#': ID.SAND }, out: [ID.SANDSTONE, 1] },
  { pattern: ['##', '##'], key: { '#': ID.STONE }, out: [ID.STONE_BRICK, 4] },

  // 農業
  { pattern: ['##', ' |', ' |'], key: { '#': ANY_PLANK, '|': IT.STICK }, out: [IT.WOOD_HOE, 1] },
  { pattern: ['##', ' |', ' |'], key: { '#': ID.COBBLE, '|': IT.STICK }, out: [IT.STONE_HOE, 1] },
  { pattern: ['##', ' |', ' |'], key: { '#': IT.IRON, '|': IT.STICK }, out: [IT.IRON_HOE, 1] },
  { pattern: ['###'], key: { '#': IT.WHEAT_ITEM }, out: [IT.BREAD, 1] },
  { pattern: ['###', '###', '###'], key: { '#': IT.WHEAT_ITEM }, out: [ID.HAY, 1] },

  // 弓と矢・バケツ
  { pattern: [' |=', '| =', ' |='], key: { '|': IT.STICK, '=': ANY_WOOL }, out: [IT.BOW, 1] },
  { pattern: ['^', '|', 'f'], key: { '^': IT.FLINT, '|': IT.STICK, f: IT.FLINT }, out: [IT.ARROW, 4] },
  { pattern: ['# #', ' # '], key: { '#': IT.IRON }, out: [IT.BUCKET, 1] },

  // 防具
  { pattern: ['###', '# #'], key: { '#': IT.LEATHER }, out: [IT.HELM_L, 1] },
  { pattern: ['# #', '###', '###'], key: { '#': IT.LEATHER }, out: [IT.CHEST_L, 1] },
  { pattern: ['###', '# #', '# #'], key: { '#': IT.LEATHER }, out: [IT.LEGS_L, 1] },
  { pattern: ['# #', '# #'], key: { '#': IT.LEATHER }, out: [IT.BOOTS_L, 1] },
  { pattern: ['###', '# #'], key: { '#': IT.IRON }, out: [IT.HELM_I, 1] },
  { pattern: ['# #', '###', '###'], key: { '#': IT.IRON }, out: [IT.CHEST_I, 1] },
  { pattern: ['###', '# #', '# #'], key: { '#': IT.IRON }, out: [IT.LEGS_I, 1] },
  { pattern: ['# #', '# #'], key: { '#': IT.IRON }, out: [IT.BOOTS_I, 1] },
  { pattern: ['###', '# #'], key: { '#': IT.DIAMOND }, out: [IT.HELM_D, 1] },
  { pattern: ['# #', '###', '###'], key: { '#': IT.DIAMOND }, out: [IT.CHEST_D, 1] },
  { pattern: ['###', '# #', '# #'], key: { '#': IT.DIAMOND }, out: [IT.LEGS_D, 1] },
  { pattern: ['# #', '# #'], key: { '#': IT.DIAMOND }, out: [IT.BOOTS_D, 1] },

  // 素材
  { shapeless: [ID.WOOL_W, ID.ROSE], out: [ID.WOOL_R, 1] },
  { shapeless: [ID.WOOL_W, ID.DAISY], out: [ID.WOOL_Y, 1] },
  { shapeless: [ID.WOOL_W, ID.TALL_GRASS], out: [ID.WOOL_G, 1] },
  { shapeless: [ID.WOOL_W, IT.COAL], out: [ID.WOOL_K, 1] },
  { shapeless: [ID.WOOL_W, ID.CLAY], out: [ID.WOOL_B, 1] },
  { shapeless: [IT.COAL, ANY_PLANK], out: [ID.DARK_PLANKS, 2] },
];

// かまど：燃料と精錬
export const fuels = { [IT.COAL]: 8, [ID.PLANKS]: 1.5, [ID.DARK_PLANKS]: 1.5, [IT.STICK]: .5, [ID.LOG]: 1.5, [ID.BIRCH_LOG]: 1.5, [ID.PINE_LOG]: 1.5 };
export const smelting = {
  [ID.SAND]: ID.GLASS, [IT.RAW_IRON]: IT.IRON, [ID.CLAY]: ID.BRICK,
  [ID.COBBLE]: ID.STONE, [IT.MEAT_RAW]: IT.MEAT, [ID.STONE]: ID.STONE_BRICK,
};

// 防具スロット（頭・胴・脚・足）
export const ARMOR_SLOTS = 4;

const matches = (cell, want) => {
  if (!cell) return false;
  return Array.isArray(want) ? want.includes(cell.id) : cell.id === want;
};

// 格子(size×size の配列)からレシピを探す
export function findRecipe(grid, size) {
  // 中身のある範囲を切り出す
  let minR = size, maxR = -1, minC = size, maxC = -1, filled = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    if (!grid[r * size + c]) continue;
    filled++;
    minR = Math.min(minR, r); maxR = Math.max(maxR, r);
    minC = Math.min(minC, c); maxC = Math.max(maxC, c);
  }
  if (!filled) return null;
  const h = maxR - minR + 1, w = maxC - minC + 1;

  for (const r of recipes) {
    if (r.pattern) {
      if (r.pattern.length !== h || r.pattern[0].length !== w) continue;
      let ok = true;
      for (let y = 0; y < h && ok; y++) for (let x = 0; x < w && ok; x++) {
        const ch = r.pattern[y][x];
        const cell = grid[(minR + y) * size + (minC + x)];
        if (ch === ' ') { if (cell) ok = false; }
        else if (!matches(cell, r.key[ch])) ok = false;
      }
      if (ok) return r;
    } else if (r.shapeless) {
      if (filled !== r.shapeless.length) continue;
      const pool = grid.filter(Boolean).slice();
      let ok = true;
      for (const want of r.shapeless) {
        const i = pool.findIndex(c => matches(c, want));
        if (i < 0) { ok = false; break; }
        pool.splice(i, 1);
      }
      if (ok) return r;
    }
  }
  return null;
}

// 作れる回数（結果スロットをまとめて取るとき用）
export function craftOnce(grid) {
  for (let i = 0; i < grid.length; i++) {
    const s = grid[i];
    if (!s) continue;
    s.n--;
    if (s.n <= 0) grid[i] = null;
  }
}
