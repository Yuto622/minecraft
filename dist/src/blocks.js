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
  FURNACE: 47, FURNACE_LIT: 48, CHEST: 49, STONE_SLAB: 50, COBBLE_SLAB: 51,
  WOOD_SLAB: 52, COBBLE_STAIRS: 53, WOOD_STAIRS: 54, FENCE: 55, DOOR: 56,
  GLASS_PANE: 57, BED: 58, STONE_BRICK: 59, LADDER: 60, TNT: 61,
  FARMLAND: 62, WHEAT: 63, HAY: 64, LAVA: 65, FIRE: 66, PUMPKIN: 67, LANTERN_JACK: 68,
};

// --- アイテム（100番台）-----------------------------------------------------
export const IT = {
  STICK: 100, COAL: 101, RAW_IRON: 102, IRON: 103, DIAMOND: 104, MEAT: 105,
  WOOD_PICK: 110, STONE_PICK: 111, IRON_PICK: 112, DIAMOND_PICK: 113,
  WOOD_AXE: 120, STONE_AXE: 121, IRON_AXE: 122,
  WOOD_SHOVEL: 130, STONE_SHOVEL: 131, IRON_SHOVEL: 132,
  SWORD: 140, IRON_SWORD: 141,
  MEAT_RAW: 106, WOOL_ITEM: 107, FLINT: 108,
  SEEDS: 150, WHEAT_ITEM: 151, BREAD: 152,
  WOOD_HOE: 153, STONE_HOE: 154, IRON_HOE: 155,
  BUCKET: 156, WATER_BUCKET: 157, LAVA_BUCKET: 158,
  BOW: 160, ARROW: 161,
  LEATHER: 162, HELM_L: 163, CHEST_L: 164, LEGS_L: 165, BOOTS_L: 166,
  HELM_I: 167, CHEST_I: 168, LEGS_I: 169, BOOTS_I: 170,
  HELM_D: 171, CHEST_D: 172, LEGS_D: 173, BOOTS_D: 174,
};

export const ARMOR = { HEAD: 0, BODY: 1, LEGS: 2, FEET: 3 };

export const TOOL = { NONE: 0, PICK: 1, AXE: 2, SHOVEL: 3, SWORD: 4, HOE: 5 };

// 道具: tier は採掘可能レベル / speed は採掘速度倍率 / dur は耐久
export const items = {
  [IT.STICK]:        { name: '棒', color: '#9a7444' },
  [IT.COAL]:         { name: '石炭', color: '#2f3335' },
  [IT.RAW_IRON]:     { name: '鉄の原石', color: '#c8a889' },
  [IT.IRON]:         { name: '鉄インゴット', color: '#dcdcdc' },
  [IT.DIAMOND]:      { name: 'ダイヤモンド', color: '#5ee6d8' },
  [IT.MEAT]:         { name: '焼けた肉', color: '#b4593c', food: 6 },
  [IT.MEAT_RAW]:     { name: '生の肉', color: '#d4796a', food: 2 },
  [IT.FLINT]:        { name: '火打石', color: '#3c3f44' },
  [IT.SEEDS]:        { name: '種', color: '#8fae55' },
  [IT.WHEAT_ITEM]:   { name: '小麦', color: '#d6b957' },
  [IT.BREAD]:        { name: 'パン', color: '#c08b46', food: 5 },
  [IT.LEATHER]:      { name: '革', color: '#a8753f' },
  [IT.BUCKET]:       { name: 'バケツ', color: '#c9ced4' },
  [IT.WATER_BUCKET]: { name: '水入りバケツ', color: '#3d8bb5' },
  [IT.LAVA_BUCKET]:  { name: '溶岩入りバケツ', color: '#e2621f' },
  [IT.ARROW]:        { name: '矢', color: '#b9b3a6' },
  [IT.BOW]:          { name: '弓', color: '#a5813f', bow: true, dur: 220 },
  [IT.WOOD_HOE]:     { name: '木のクワ', color: '#bb965e', tool: TOOL.HOE, tier: 1, speed: 1, dur: 60 },
  [IT.STONE_HOE]:    { name: '石のクワ', color: '#8b918d', tool: TOOL.HOE, tier: 2, speed: 1, dur: 132 },
  [IT.IRON_HOE]:     { name: '鉄のクワ', color: '#d8d8d8', tool: TOOL.HOE, tier: 3, speed: 1, dur: 250 },
  [IT.HELM_L]:  { name: '革の帽子', color: '#a8753f', armor: 0, def: 1, dur: 55 },
  [IT.CHEST_L]: { name: '革の上着', color: '#a8753f', armor: 1, def: 3, dur: 80 },
  [IT.LEGS_L]:  { name: '革のズボン', color: '#a8753f', armor: 2, def: 2, dur: 75 },
  [IT.BOOTS_L]: { name: '革のブーツ', color: '#a8753f', armor: 3, def: 1, dur: 65 },
  [IT.HELM_I]:  { name: '鉄の兜', color: '#d8d8d8', armor: 0, def: 2, dur: 165 },
  [IT.CHEST_I]: { name: '鉄の胸当て', color: '#d8d8d8', armor: 1, def: 6, dur: 240 },
  [IT.LEGS_I]:  { name: '鉄の脚当て', color: '#d8d8d8', armor: 2, def: 5, dur: 225 },
  [IT.BOOTS_I]: { name: '鉄のブーツ', color: '#d8d8d8', armor: 3, def: 2, dur: 195 },
  [IT.HELM_D]:  { name: 'ダイヤの兜', color: '#5ee6d8', armor: 0, def: 3, dur: 363 },
  [IT.CHEST_D]: { name: 'ダイヤの胸当て', color: '#5ee6d8', armor: 1, def: 8, dur: 528 },
  [IT.LEGS_D]:  { name: 'ダイヤの脚当て', color: '#5ee6d8', armor: 2, def: 6, dur: 495 },
  [IT.BOOTS_D]: { name: 'ダイヤのブーツ', color: '#5ee6d8', armor: 3, def: 3, dur: 429 },
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
function def(id, o) { blocks[id] = Object.assign({ id, hard: .6, tool: TOOL.NONE, tier: 0, solid: true, opaque: true, full: true, absorb: 15, emit: 0 }, o); }

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

// --- 形のあるブロック -------------------------------------------------------
// boxes: [x0,y0,z0,x1,y1,z1] の並び（0..1 のブロック内座標）。
// full=false のブロックは隣の面を隠さない。rot=true は向き(meta)を持つ。
def(ID.STONE_BRICK, { name: '石レンガ', tiles: ['stone_brick'], color: '#8a8f8c', hard: 2, tool: TOOL.PICK, tier: 1 });
def(ID.FURNACE, { name: 'かまど', tiles: ['furnace_top', 'furnace_side', 'furnace_top'], front: 'furnace_front', color: '#7b8080', hard: 3.5, tool: TOOL.PICK, tier: 1, rot: true, interact: 'furnace' });
def(ID.FURNACE_LIT, { name: 'かまど（燃焼中）', tiles: ['furnace_top', 'furnace_side', 'furnace_top'], front: 'furnace_lit', color: '#8b7f6f', hard: 3.5, tool: TOOL.PICK, tier: 1, rot: true, emit: 13, interact: 'furnace', drop: ID.FURNACE });
def(ID.CHEST, { name: 'チェスト', tiles: ['chest_top', 'chest_side', 'chest_top'], front: 'chest_front', color: '#a97c3f', hard: 2.5, tool: TOOL.AXE, rot: true, interact: 'chest',
  full: false, opaque: false, absorb: 0, boxes: [[.0625, 0, .0625, .9375, .875, .9375]] });
def(ID.STONE_SLAB, { name: '石のハーフブロック', tiles: ['stone'], color: '#8d9490', hard: 1.6, tool: TOOL.PICK, tier: 1, slab: true, full: false, opaque: false, absorb: 0, boxes: [[0, 0, 0, 1, .5, 1]] });
def(ID.COBBLE_SLAB, { name: '丸石のハーフブロック', tiles: ['cobble'], color: '#787f7e', hard: 2, tool: TOOL.PICK, tier: 1, slab: true, full: false, opaque: false, absorb: 0, boxes: [[0, 0, 0, 1, .5, 1]] });
def(ID.WOOD_SLAB, { name: '木のハーフブロック', tiles: ['planks'], color: '#bb965e', hard: 1, tool: TOOL.AXE, slab: true, full: false, opaque: false, absorb: 0, boxes: [[0, 0, 0, 1, .5, 1]] });
def(ID.COBBLE_STAIRS, { name: '丸石の階段', tiles: ['cobble'], color: '#787f7e', hard: 2, tool: TOOL.PICK, tier: 1, rot: true, stairs: true, full: false, opaque: false, absorb: 0,
  boxes: [[0, 0, 0, 1, .5, 1], [0, .5, 0, 1, 1, .5]] });
def(ID.WOOD_STAIRS, { name: '木の階段', tiles: ['planks'], color: '#bb965e', hard: 1, tool: TOOL.AXE, rot: true, stairs: true, full: false, opaque: false, absorb: 0,
  boxes: [[0, 0, 0, 1, .5, 1], [0, .5, 0, 1, 1, .5]] });
def(ID.FENCE, { name: '柵', tiles: ['planks'], color: '#bb965e', hard: 1, tool: TOOL.AXE, connect: 'fence', full: false, opaque: false, absorb: 0, tall: 1.5,
  boxes: [[.375, 0, .375, .625, 1, .625]] });
def(ID.GLASS_PANE, { name: '板ガラス', tiles: ['glass'], color: '#c3e7e6', hard: .4, connect: 'pane', full: false, opaque: false, absorb: 0, alpha: true,
  boxes: [[.4375, 0, .4375, .5625, 1, .5625]] });
def(ID.DOOR, { name: '木のドア', tiles: ['door_top', 'door_top', 'door_bottom'], color: '#9a6f3c', hard: 1, tool: TOOL.AXE, rot: true, door: true, interact: 'door',
  full: false, opaque: false, absorb: 0, boxes: [[0, 0, 0, 1, 1, .1875]] });
def(ID.BED, { name: 'ベッド', tiles: ['bed_top', 'bed_side', 'planks'], color: '#b03a34', hard: .4, rot: true, bed: true, interact: 'bed',
  full: false, opaque: false, absorb: 0, boxes: [[0, 0, 0, 1, .5625, 1]] });
def(ID.FARMLAND, { name: '耕地', tiles: ['farmland', 'dirt', 'dirt'], color: '#6b4a2c', hard: .6, tool: TOOL.SHOVEL, drop: ID.DIRT,
  full: false, opaque: true, boxes: [[0, 0, 0, 1, .9375, 1]] });
def(ID.WHEAT, { name: '小麦', tiles: ['wheat0'], stages: ['wheat0', 'wheat1', 'wheat2', 'wheat3'], color: '#bda855',
  hard: .05, solid: false, opaque: false, absorb: 0, plant: true, crop: true });
def(ID.HAY, { name: '干し草', tiles: ['hay_top', 'hay', 'hay_top'], color: '#c8a33c', hard: .6 });
def(ID.PUMPKIN, { name: 'カボチャ', tiles: ['pumpkin_top', 'pumpkin', 'pumpkin_top'], front: 'pumpkin_face', color: '#d08a2a', hard: 1, tool: TOOL.AXE, rot: true });
def(ID.LANTERN_JACK, { name: 'ジャック・オ・ランタン', tiles: ['pumpkin_top', 'pumpkin', 'pumpkin_top'], front: 'pumpkin_lit', color: '#ffb347', hard: 1, rot: true, emit: 15 });
def(ID.LAVA, { name: '溶岩', tiles: ['lava'], color: '#e2621f', solid: false, opaque: false, absorb: 1, emit: 15, liquid: true, hurt: 4, hard: 999 });
def(ID.FIRE, { name: '火', tiles: ['fire'], color: '#ff9a3c', solid: false, opaque: false, absorb: 0, emit: 12, plant: true, hurt: 1, hard: .02 });
def(ID.LADDER, { name: 'はしご', tiles: ['ladder'], color: '#a5813f', hard: .4, rot: true, climb: true, solid: false, full: false, opaque: false, absorb: 0,
  boxes: [[0, 0, 0, 1, 1, .125]] });

export const name = id => (isItem(id) ? items[id]?.name : blocks[id]?.name) || '???';
export const color = id => (isItem(id) ? items[id]?.color : blocks[id]?.color) || '#888';
