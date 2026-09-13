// craft.js — クラフトのレシピ表
import { ID, IT } from './blocks.js';

// need: [[id, 個数], ...] / out: [id, 個数] / bench: 作業台が近くに必要
export const recipes = [
  { out: [ID.PLANKS, 4], need: [[ID.LOG, 1]], alt: [ID.BIRCH_LOG, ID.PINE_LOG], tag: '木を割る' },
  { out: [IT.STICK, 4], need: [[ID.PLANKS, 2]], tag: '木を割る' },
  { out: [ID.BENCH, 1], need: [[ID.PLANKS, 4]], tag: '基本' },
  { out: [ID.TORCH, 4], need: [[IT.COAL, 1], [IT.STICK, 1]], tag: '明かり' },
  { out: [ID.LANTERN, 1], need: [[IT.COAL, 2], [ID.PLANKS, 2]], tag: '明かり' },
  { out: [ID.GLASS, 2], need: [[ID.SAND, 2], [IT.COAL, 1]], tag: '焼く' },
  { out: [IT.IRON, 1], need: [[IT.RAW_IRON, 1], [IT.COAL, 1]], tag: '焼く' },
  { out: [ID.BRICK, 4], need: [[ID.CLAY, 4], [IT.COAL, 1]], tag: '焼く' },
  { out: [ID.COBBLE, 1], need: [[ID.STONE, 1]], tag: '基本' },
  { out: [IT.WOOD_PICK, 1], need: [[ID.PLANKS, 3], [IT.STICK, 2]], bench: true, tag: '道具' },
  { out: [IT.STONE_PICK, 1], need: [[ID.COBBLE, 3], [IT.STICK, 2]], bench: true, tag: '道具' },
  { out: [IT.IRON_PICK, 1], need: [[IT.IRON, 3], [IT.STICK, 2]], bench: true, tag: '道具' },
  { out: [IT.DIAMOND_PICK, 1], need: [[IT.DIAMOND, 3], [IT.STICK, 2]], bench: true, tag: '道具' },
  { out: [IT.WOOD_AXE, 1], need: [[ID.PLANKS, 3], [IT.STICK, 2]], bench: true, tag: '道具' },
  { out: [IT.STONE_AXE, 1], need: [[ID.COBBLE, 3], [IT.STICK, 2]], bench: true, tag: '道具' },
  { out: [IT.IRON_AXE, 1], need: [[IT.IRON, 3], [IT.STICK, 2]], bench: true, tag: '道具' },
  { out: [IT.WOOD_SHOVEL, 1], need: [[ID.PLANKS, 1], [IT.STICK, 2]], bench: true, tag: '道具' },
  { out: [IT.STONE_SHOVEL, 1], need: [[ID.COBBLE, 1], [IT.STICK, 2]], bench: true, tag: '道具' },
  { out: [IT.IRON_SHOVEL, 1], need: [[IT.IRON, 1], [IT.STICK, 2]], bench: true, tag: '道具' },
  { out: [IT.SWORD, 1], need: [[ID.COBBLE, 2], [IT.STICK, 1]], bench: true, tag: '道具' },
  { out: [IT.IRON_SWORD, 1], need: [[IT.IRON, 2], [IT.STICK, 1]], bench: true, tag: '道具' },
  { out: [ID.WOOL_R, 1], need: [[ID.WOOL_W, 1], [ID.ROSE, 1]], tag: '染める' },
  { out: [ID.WOOL_Y, 1], need: [[ID.WOOL_W, 1], [ID.DAISY, 1]], tag: '染める' },
  { out: [ID.WOOL_G, 1], need: [[ID.WOOL_W, 1], [ID.TALL_GRASS, 1]], tag: '染める' },
  { out: [ID.WOOL_K, 1], need: [[ID.WOOL_W, 1], [IT.COAL, 1]], tag: '染める' },
  { out: [ID.DARK_PLANKS, 2], need: [[ID.PLANKS, 2], [IT.COAL, 1]], tag: '基本' },
];

// 所持品で作れるか（alt は need[0] の代わりに使える id）
export function canCraft(r, inv) {
  for (let i = 0; i < r.need.length; i++) {
    const [id, n] = r.need[i];
    let have = inv[id] || 0;
    if (i === 0 && r.alt) for (const a of r.alt) have += inv[a] || 0;
    if (have < n) return false;
  }
  return true;
}
export function consume(r, inv) {
  for (let i = 0; i < r.need.length; i++) {
    let [id, n] = r.need[i];
    const pool = i === 0 && r.alt ? [id, ...r.alt] : [id];
    for (const p of pool) {
      const take = Math.min(n, inv[p] || 0);
      inv[p] -= take; n -= take;
      if (n <= 0) break;
    }
  }
}
