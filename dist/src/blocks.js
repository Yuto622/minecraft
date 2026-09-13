// blocks.js — ブロック／アイテム定義と、手続き生成のテクスチャアトラス

export const AIR = 0;

// --- ブロックID -------------------------------------------------------------
export const ID = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, LOG: 5, LEAVES: 6, PLANKS: 7,
  BRICK: 8, GLASS: 9, COBBLE: 10, SNOW: 11, COAL_ORE: 12, IRON_ORE: 13,
  LANTERN: 14, BENCH: 15, GRANITE: 16, WATER: 17, GRAVEL: 18, BEDROCK: 19,
  BIRCH_LOG: 20, BIRCH_LEAVES: 21, PINE_LOG: 22, PINE_LEAVES: 23, CACTUS: 24,
  SANDSTONE: 25, GOLD_ORE: 26, DIAMOND_ORE: 27, CLAY: 28, MOSSY: 29,
  DARK_PLANKS: 30, GLOWSTONE: 31, ICE: 32, TALL_GRASS: 33, ROSE: 34,
  DAISY: 35, MUSHROOM: 36, TORCH: 37, WOOL_W: 38, WOOL_R: 39, WOOL_B: 40,
  WOOL_Y: 41, WOOL_K: 42, WOOL_G: 43, PODZOL: 44, OBSIDIAN: 45, SNOW_GRASS: 46,
};

// --- アイテム（100番台）-----------------------------------------------------
export const IT = {
  STICK: 100, COAL: 101, RAW_IRON: 102, IRON: 103, DIAMOND: 104, MEAT: 105,
  WOOD_PICK: 110, STONE_PICK: 111, IRON_PICK: 112, DIAMOND_PICK: 113,
  WOOD_AXE: 120, STONE_AXE: 121, IRON_AXE: 122,
  WOOD_SHOVEL: 130, STONE_SHOVEL: 131, IRON_SHOVEL: 132,
  SWORD: 140, IRON_SWORD: 141,
};

export const TOOL = { NONE: 0, PICK: 1, AXE: 2, SHOVEL: 3, SWORD: 4 };

// 道具: tier は採掘可能レベル / speed は採掘速度倍率 / dur は耐久
export const items = {
  [IT.STICK]:        { name: '棒', color: '#9a7444' },
  [IT.COAL]:         { name: '石炭', color: '#2f3335' },
  [IT.RAW_IRON]:     { name: '鉄の原石', color: '#c8a889' },
  [IT.IRON]:         { name: '鉄インゴット', color: '#dcdcdc' },
  [IT.DIAMOND]:      { name: 'ダイヤモンド', color: '#5ee6d8' },
  [IT.MEAT]:         { name: '焼けた肉', color: '#b4593c', food: 6 },
  [IT.WOOD_PICK]:    { name: '木のツルハシ', color: '#bb965e', tool: TOOL.PICK, tier: 1, speed: 2.2, dur: 60 },
  [IT.STONE_PICK]:   { name: '石のツルハシ', color: '#8b918d', tool: TOOL.PICK, tier: 2, speed: 4, dur: 132 },
  [IT.IRON_PICK]:    { name: '鉄のツルハシ', color: '#d8d8d8', tool: TOOL.PICK, tier: 3, speed: 6.5, dur: 250 },
  [IT.DIAMOND_PICK]: { name: 'ダイヤのツルハシ', color: '#5ee6d8', tool: TOOL.PICK, tier: 4, speed: 9, dur: 1561 },
  [IT.WOOD_AXE]:     { name: '木の斧', color: '#bb965e', tool: TOOL.AXE, tier: 1, speed: 2.2, dur: 60 },
  [IT.STONE_AXE]:    { name: '石の斧', color: '#8b918d', tool: TOOL.AXE, tier: 2, speed: 4, dur: 132 },
  [IT.IRON_AXE]:     { name: '鉄の斧', color: '#d8d8d8', tool: TOOL.AXE, tier: 3, speed: 6.5, dur: 250 },
  [IT.WOOD_SHOVEL]:  { name: '木のシャベル', color: '#bb965e', tool: TOOL.SHOVEL, tier: 1, speed: 2.2, dur: 60 },
  [IT.STONE_SHOVEL]: { name: '石のシャベル', color: '#8b918d', tool: TOOL.SHOVEL, tier: 2, speed: 4, dur: 132 },
  [IT.IRON_SHOVEL]:  { name: '鉄のシャベル', color: '#d8d8d8', tool: TOOL.SHOVEL, tier: 3, speed: 6.5, dur: 250 },
  [IT.SWORD]:        { name: '石の剣', color: '#8b918d', tool: TOOL.SWORD, tier: 1, speed: 1, dur: 132, dmg: 5 },
  [IT.IRON_SWORD]:   { name: '鉄の剣', color: '#d8d8d8', tool: TOOL.SWORD, tier: 2, speed: 1, dur: 250, dmg: 7 },
};

export const isItem = id => id >= 100;

// --- ブロック定義 -----------------------------------------------------------
// tiles: [top, side, bottom] のテクスチャキー
// hard: 硬さ(秒) / tool: 有効な道具 / tier: 必要ツールレベル(0=素手可)
export const blocks = [];
function def(id, o) { blocks[id] = Object.assign({ id, hard: .6, tool: TOOL.NONE, tier: 0, solid: true, opaque: true, absorb: 15, emit: 0 }, o); }

def(ID.AIR, { name: '空気', solid: false, opaque: false, absorb: 0 });
def(ID.GRASS, { name: '草ブロック', tiles: ['grass_top', 'grass_side', 'dirt'], color: '#7cae4e', hard: .6, tool: TOOL.SHOVEL, drop: ID.DIRT });
def(ID.DIRT, { name: '土', tiles: ['dirt'], color: '#8a6243', hard: .5, tool: TOOL.SHOVEL });
def(ID.PODZOL, { name: '灰土', tiles: ['podzol_top', 'podzol_side', 'dirt'], color: '#6c5233', hard: .5, tool: TOOL.SHOVEL, drop: ID.DIRT });
def(ID.SNOW_GRASS, { name: '雪の草原', tiles: ['snow', 'snow_side', 'dirt'], color: '#e9f1ed', hard: .5, tool: TOOL.SHOVEL, drop: ID.DIRT });
def(ID.STONE, { name: '石', tiles: ['stone'], color: '#8d9490', hard: 1.5, tool: TOOL.PICK, tier: 1, drop: ID.COBBLE });
def(ID.COBBLE, { name: '丸石', tiles: ['cobble'], color: '#787f7e', hard: 2, tool: TOOL.PICK, tier: 1 });
def(ID.MOSSY, { name: '苔むした丸石', tiles: ['mossy'], color: '#6c8264', hard: 2, tool: TOOL.PICK, tier: 1 });
def(ID.GRANITE, { name: '花崗岩', tiles: ['granite'], color: '#b08774', hard: 1.6, tool: TOOL.PICK, tier: 1 });
def(ID.SAND, { name: '砂', tiles: ['sand'], color: '#ded0a0', hard: .5, tool: TOOL.SHOVEL });
def(ID.SANDSTONE, { name: '砂岩', tiles: ['sandstone_top', 'sandstone', 'sandstone_top'], color: '#d9c893', hard: 1.2, tool: TOOL.PICK, tier: 1 });
def(ID.GRAVEL, { name: '砂利', tiles: ['gravel'], color: '#928e8b', hard: .6, tool: TOOL.SHOVEL });
def(ID.CLAY, { name: '粘土', tiles: ['clay'], color: '#a4aab5', hard: .6, tool: TOOL.SHOVEL });
def(ID.LOG, { name: 'オークの原木', tiles: ['log_top', 'log', 'log_top'], color: '#6f5034', hard: 1.2, tool: TOOL.AXE });
def(ID.BIRCH_LOG, { name: '白樺の原木', tiles: ['birch_top', 'birch_log', 'birch_top'], color: '#d8d3c4', hard: 1.2, tool: TOOL.AXE });
def(ID.PINE_LOG, { name: 'マツの原木', tiles: ['pine_top', 'pine_log', 'pine_top'], color: '#4c3728', hard: 1.2, tool: TOOL.AXE });
def(ID.LEAVES, { name: 'オークの葉', tiles: ['leaves'], color: '#4f883c', hard: .25, absorb: 2 });
def(ID.BIRCH_LEAVES, { name: '白樺の葉', tiles: ['birch_leaves'], color: '#7fa44b', hard: .25, absorb: 2 });
def(ID.PINE_LEAVES, { name: 'マツの葉', tiles: ['pine_leaves'], color: '#2f5f3c', hard: .25, absorb: 2 });
def(ID.PLANKS, { name: '木材', tiles: ['planks'], color: '#bb965e', hard: 1, tool: TOOL.AXE });
def(ID.DARK_PLANKS, { name: '濃色の木材', tiles: ['dark_planks'], color: '#6b4a2c', hard: 1, tool: TOOL.AXE });
def(ID.BENCH, { name: '作業台', tiles: ['bench_top', 'bench_side', 'planks'], color: '#9f783f', hard: 1, tool: TOOL.AXE });
def(ID.BRICK, { name: 'レンガ', tiles: ['brick'], color: '#ac6955', hard: 2, tool: TOOL.PICK, tier: 1 });
def(ID.GLASS, { name: 'ガラス', tiles: ['glass'], color: '#c3e7e6', hard: .4, opaque: false, absorb: 0, alpha: true });
def(ID.ICE, { name: '氷', tiles: ['ice'], color: '#93c9ef', hard: .6, tool: TOOL.PICK, opaque: false, absorb: 2, alpha: true });
def(ID.WATER, { name: '水', tiles: ['water'], color: '#3d8bb5', solid: false, opaque: false, absorb: 3, alpha: true, liquid: true, hard: 999 });
def(ID.SNOW, { name: '雪', tiles: ['snow'], color: '#eef4f2', hard: .3, tool: TOOL.SHOVEL });
def(ID.COAL_ORE, { name: '石炭鉱石', tiles: ['coal_ore'], color: '#5a615d', hard: 3, tool: TOOL.PICK, tier: 1, drop: IT.COAL });
def(ID.IRON_ORE, { name: '鉄鉱石', tiles: ['iron_ore'], color: '#b3a08a', hard: 3, tool: TOOL.PICK, tier: 2, drop: IT.RAW_IRON });
def(ID.GOLD_ORE, { name: '金鉱石', tiles: ['gold_ore'], color: '#c7a85a', hard: 3, tool: TOOL.PICK, tier: 3 });
def(ID.DIAMOND_ORE, { name: 'ダイヤモンド鉱石', tiles: ['diamond_ore'], color: '#7fd8d0', hard: 4.5, tool: TOOL.PICK, tier: 3, drop: IT.DIAMOND });
def(ID.OBSIDIAN, { name: '黒曜石', tiles: ['obsidian'], color: '#221a33', hard: 9, tool: TOOL.PICK, tier: 4 });
def(ID.BEDROCK, { name: '岩盤', tiles: ['bedrock'], color: '#2f3234', hard: Infinity, tier: 9 });
def(ID.LANTERN, { name: 'ランタン', tiles: ['lantern_top', 'lantern', 'lantern_top'], color: '#ffcd6e', hard: .5, emit: 14 });
def(ID.GLOWSTONE, { name: 'グロウストーン', tiles: ['glowstone'], color: '#ffe1a0', hard: .6, emit: 15 });
def(ID.TORCH, { name: 'たいまつ', tiles: ['torch'], color: '#ffbb55', hard: .05, solid: false, opaque: false, absorb: 0, emit: 13, plant: true });
def(ID.TALL_GRASS, { name: '草', tiles: ['tall_grass'], color: '#77a94a', hard: .05, solid: false, opaque: false, absorb: 0, plant: true });
def(ID.ROSE, { name: '赤い花', tiles: ['rose'], color: '#c8484a', hard: .05, solid: false, opaque: false, absorb: 0, plant: true });
def(ID.DAISY, { name: '白い花', tiles: ['daisy'], color: '#e8e6d2', hard: .05, solid: false, opaque: false, absorb: 0, plant: true });
def(ID.MUSHROOM, { name: 'キノコ', tiles: ['mushroom'], color: '#b4553f', hard: .05, solid: false, opaque: false, absorb: 0, plant: true });
def(ID.CACTUS, { name: 'サボテン', tiles: ['cactus_top', 'cactus', 'cactus_top'], color: '#4f7b3a', hard: .5, hurt: 1 });
def(ID.WOOL_W, { name: '白の羊毛', tiles: ['wool_w'], color: '#e9e9e4', hard: .8 });
def(ID.WOOL_R, { name: '赤の羊毛', tiles: ['wool_r'], color: '#a9382f', hard: .8 });
def(ID.WOOL_B, { name: '青の羊毛', tiles: ['wool_b'], color: '#3a5ea8', hard: .8 });
def(ID.WOOL_Y, { name: '黄の羊毛', tiles: ['wool_y'], color: '#d6ab3a', hard: .8 });
def(ID.WOOL_K, { name: '黒の羊毛', tiles: ['wool_k'], color: '#2b2b30', hard: .8 });
def(ID.WOOL_G, { name: '緑の羊毛', tiles: ['wool_g'], color: '#4e7a35', hard: .8 });

export const name = id => (isItem(id) ? items[id]?.name : blocks[id]?.name) || '???';
export const color = id => (isItem(id) ? items[id]?.color : blocks[id]?.color) || '#888';
