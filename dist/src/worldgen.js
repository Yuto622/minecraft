// worldgen.js — 島ひとつぶんの地形生成
// 大陸ノイズ + 尾根ノイズで山を作り、気温と湿度でバイオームを決め、
// 3Dノイズで洞窟を掘り、鉱脈・木・草花・遺跡を配置する。
import { voxels, biomeMap, heightMap, W, H, SEA, setRaw, getBlock, surface } from './world.js';
import { ID } from './blocks.js';

export const BIOME = { PLAINS: 0, FOREST: 1, DESERT: 2, MOUNTAIN: 3, SNOW: 4, BEACH: 5, OCEAN: 6, SWAMP: 7, TAIGA: 8 };
export const biomeName = ['花咲く平原', '深い森', '灼ける砂漠', '険しい山岳', '凍える雪原', '白い浜辺', '静かな湖', '霧の湿地', '針葉樹の森'];
export const biomeTint = ['#9ccf6a', '#5f9c47', '#e2cf95', '#b9bcc0', '#e9f2f4', '#e8dcae', '#4f92b5', '#6f8f5d', '#3f7550'];

let SEED = 1;
export const setSeed = s => { SEED = s >>> 0 || 1; };

function hash2(x, y, s) {
  let h = x * 374761393 + y * 668265263 + s * 144665 + SEED * 2654435761;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function hash3(x, y, z, s) {
  let h = x * 374761393 + y * 1103515245 + z * 668265263 + s * 144665 + SEED * 2654435761;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const fade = t => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

export function noise2(x, z, s = 0) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = fade(x - xi), zf = fade(z - zi);
  return lerp(lerp(hash2(xi, zi, s), hash2(xi + 1, zi, s), xf),
              lerp(hash2(xi, zi + 1, s), hash2(xi + 1, zi + 1, s), xf), zf);
}
function noise3(x, y, z, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
  const c = (dy) => lerp(lerp(hash3(xi, yi + dy, zi, s), hash3(xi + 1, yi + dy, zi, s), xf),
                         lerp(hash3(xi, yi + dy, zi + 1, s), hash3(xi + 1, yi + dy, zi + 1, s), xf), zf);
  return lerp(c(0), c(1), yf);
}
function fbm(x, z, oct, s = 0) {
  let a = 0, amp = .5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { a += noise2(x * f, z * f, s + i) * amp; norm += amp; amp *= .5; f *= 2; }
  return a / norm;
}
const ridge = (x, z, s) => 1 - Math.abs(fbm(x, z, 4, s) * 2 - 1);

// --- 地形の高さとバイオーム -------------------------------------------------
function columnInfo(x, z) {
  const nx = x / W - .5, nz = z / W - .5;
  const d = Math.sqrt(nx * nx + nz * nz) * 2;                 // 0(中心) .. 1.41(角)
  const coast = Math.max(0, (d - .72)) * 46;                   // 外周は海へ沈む
  const cont = fbm(x / 150, z / 150, 5, 11);
  const hills = fbm(x / 46, z / 46, 4, 21);
  const mMask = Math.max(0, fbm(x / 210, z / 210, 3, 31) - .48) * 3.4;
  const mount = ridge(x / 130, z / 130, 41) * 34 * Math.min(1, mMask);
  let h = SEA - 4 + cont * 22 + hills * 7 + mount - coast;
  h = Math.max(2, Math.min(H - 12, Math.round(h)));

  const temp = fbm(x / 190, z / 190, 3, 51) + (1 - Math.min(1, (h - SEA) / 28)) * .18;
  const humid = fbm(x / 165, z / 165, 3, 61);
  let b;
  if (h <= SEA - 1) b = BIOME.OCEAN;
  else if (h <= SEA + 1) b = BIOME.BEACH;
  else if (h > SEA + 26) b = temp < .46 ? BIOME.SNOW : BIOME.MOUNTAIN;
  else if (temp > .62 && humid < .42) b = BIOME.DESERT;
  else if (temp < .36) b = humid > .5 ? BIOME.TAIGA : BIOME.SNOW;
  else if (humid > .66) b = h < SEA + 4 ? BIOME.SWAMP : BIOME.FOREST;
  else if (humid > .5) b = BIOME.FOREST;
  else b = BIOME.PLAINS;
  return { h, b, temp, humid };
}

// --- 生成本体（進捗を yield する）------------------------------------------
export function* generate() {
  voxels.fill(0);
  yield { p: 0, msg: '大地を持ち上げています' };

  // 1) 地形
  for (let x = 0; x < W; x++) {
    for (let z = 0; z < W; z++) {
      const { h, b } = columnInfo(x, z);
      const ci = x + z * W;
      heightMap[ci] = h; biomeMap[ci] = b;
      const stoneTop = h - (b === BIOME.MOUNTAIN || b === BIOME.SNOW ? 1 : 3) - Math.floor(hash2(x, z, 7) * 2);
      for (let y = 0; y <= h; y++) {
        let id;
        if (y <= 1 + Math.floor(hash2(x, z, 3) * 2)) id = ID.BEDROCK;
        else if (y <= stoneTop) id = ID.STONE;
        else if (y < h) id = (b === BIOME.DESERT || b === BIOME.BEACH) ? ID.SAND : (b === BIOME.OCEAN ? ID.SAND : ID.DIRT);
        else {
          if (b === BIOME.OCEAN) id = hash2(x, z, 9) > .78 ? ID.CLAY : (hash2(x, z, 13) > .6 ? ID.GRAVEL : ID.SAND);
          else if (b === BIOME.BEACH) id = ID.SAND;
          else if (b === BIOME.DESERT) id = ID.SAND;
          else if (b === BIOME.SNOW) id = ID.SNOW_GRASS;
          else if (b === BIOME.MOUNTAIN) id = h > SEA + 30 ? ID.SNOW_GRASS : ID.STONE;
          else if (b === BIOME.TAIGA) id = hash2(x, z, 17) > .6 ? ID.PODZOL : ID.GRASS;
          else id = ID.GRASS;
        }
        setRaw(x, y, z, id);
      }
      // 砂漠の砂岩、水
      if (b === BIOME.DESERT) for (let y = h - 4; y < h - 1; y++) if (y > 1 && getBlock(x, y, z) === ID.SAND) setRaw(x, y, z, ID.SANDSTONE);
      for (let y = h + 1; y <= SEA; y++) setRaw(x, y, z, ID.WATER);
    }
    if ((x & 31) === 0) yield { p: x / W * .35, msg: '大地を持ち上げています' };
  }

  // 2) 洞窟
  yield { p: .36, msg: '地下に洞窟を掘っています' };
  for (let x = 1; x < W - 1; x++) {
    for (let z = 1; z < W - 1; z++) {
      const top = heightMap[x + z * W];
      for (let y = 2; y < Math.min(top, H - 8); y++) {
        const c = noise3(x / 17, y / 11, z / 17, 71) * .6 + noise3(x / 7, y / 5, z / 7, 81) * .4;
        const cavern = y < 26 ? .04 + (26 - y) * .004 : 0;
        if (c > .70 - cavern) {
          const cur = getBlock(x, y, z);
          if (cur !== ID.BEDROCK && cur !== ID.WATER) setRaw(x, y, z, ID.AIR);
        }
      }
    }
    if ((x & 31) === 0) yield { p: .36 + x / W * .18, msg: '地下に洞窟を掘っています' };
  }
  // 洞窟で浮いた地面の下を整える & 水漏れ防止
  for (let x = 0; x < W; x++) for (let z = 0; z < W; z++) {
    const top = heightMap[x + z * W];
    if (top <= SEA + 1) for (let y = Math.max(2, top - 3); y <= top; y++) if (!getBlock(x, y, z)) setRaw(x, y, z, ID.STONE);
  }

  // 3) 鉱脈
  yield { p: .56, msg: '鉱脈を埋めています' };
  const vein = (id, count, yMax, size) => {
    for (let i = 0; i < count; i++) {
      const x = 2 + Math.floor(hash2(i, id, 91) * (W - 4));
      const z = 2 + Math.floor(hash2(i, id, 92) * (W - 4));
      const y = 3 + Math.floor(hash2(i, id, 93) * (yMax - 3));
      const n = 3 + Math.floor(hash2(i, id, 94) * size);
      let cx = x, cy = y, cz = z;
      for (let k = 0; k < n; k++) {
        for (let dx = 0; dx <= 1; dx++) for (let dy = 0; dy <= 1; dy++) for (let dz = 0; dz <= 1; dz++)
          if (getBlock(cx + dx, cy + dy, cz + dz) === ID.STONE) setRaw(cx + dx, cy + dy, cz + dz, id);
        cx += Math.round(hash2(k, i + id, 95) * 2 - 1);
        cy += Math.round(hash2(k, i + id, 96) * 2 - 1);
        cz += Math.round(hash2(k, i + id, 97) * 2 - 1);
      }
    }
  };
  vein(ID.COAL_ORE, 420, 48, 6);
  vein(ID.IRON_ORE, 300, 36, 5);
  vein(ID.GOLD_ORE, 90, 22, 3);
  vein(ID.DIAMOND_ORE, 44, 14, 2);
  vein(ID.GRANITE, 160, 44, 8);
  vein(ID.GRAVEL, 140, 44, 7);

  // 3.5) 地下の溶岩だまり
  yield { p: .63, msg: '地の底に溶岩を溜めています' };
  // 一帯にだけ溶岩だまりを作る（地下がすべて溶岩にならないように）
  for (let x = 2; x < W - 2; x++) for (let z = 2; z < W - 2; z++) {
    const pool = noise2(x / 26, z / 26, 121);
    if (pool < .62) continue;
    const top = pool > .78 ? 9 : 6;
    for (let y = 2; y < top; y++) {
      if (getBlock(x, y, z)) continue;
      if (!getBlock(x, y - 1, z)) continue;      // 底が抜けている所には溜まらない
      setRaw(x, y, z, ID.LAVA);
    }
  }

  // 4) 木と草花
  yield { p: .66, msg: '森を育てています' };
  const setIfAir = (x, y, z, id) => { if (!getBlock(x, y, z)) setRaw(x, y, z, id); };
  const leafBall = (x, y, z, r, leaf) => {
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) {
      const d = Math.abs(a) + Math.abs(b) * 1.15 + Math.abs(c);
      if (d > r + .6 || hash3(x + a, y + b, z + c, 33) > .92) continue;
      setIfAir(x + a, y + b, z + c, leaf);
    }
  };
  for (let x = 3; x < W - 3; x++) for (let z = 3; z < W - 3; z++) {
    const ci = x + z * W, b = biomeMap[ci], y = surface(x, z);
    const top = getBlock(x, y, z);
    if (y <= SEA || getBlock(x, y + 1, z)) continue;
    const r = hash2(x, z, 101);
    const dense = b === BIOME.FOREST ? .965 : b === BIOME.TAIGA ? .955 : b === BIOME.PLAINS ? .992 : b === BIOME.SWAMP ? .982 : 1.1;
    if ((top === ID.GRASS || top === ID.PODZOL) && r > dense) {
      const pine = b === BIOME.TAIGA, birch = !pine && hash2(x, z, 102) > .72;
      const log = pine ? ID.PINE_LOG : birch ? ID.BIRCH_LOG : ID.LOG;
      const leaf = pine ? ID.PINE_LEAVES : birch ? ID.BIRCH_LEAVES : ID.LEAVES;
      const hgt = (pine ? 7 : 4) + Math.floor(hash2(x, z, 103) * (pine ? 5 : 3));
      for (let j = 1; j <= hgt; j++) setRaw(x, y + j, z, log);
      if (pine) {
        for (let k = 0; k < 4; k++) {
          const rr = 3 - k;
          for (let a = -rr; a <= rr; a++) for (let c = -rr; c <= rr; c++)
            if (Math.abs(a) + Math.abs(c) <= rr) setIfAir(x + a, y + hgt - 3 + k * 1 - 1, z + c, leaf);
        }
        setIfAir(x, y + hgt + 1, z, leaf);
      } else leafBall(x, y + hgt, z, 2 + (hash2(x, z, 104) > .6 ? 1 : 0), leaf);
    } else if (top === ID.SAND && b === BIOME.DESERT && r > .9975) {
      const hgt = 2 + Math.floor(hash2(x, z, 105) * 3);
      for (let j = 1; j <= hgt; j++) setRaw(x, y + j, z, ID.CACTUS);
    } else if (top === ID.GRASS || top === ID.SNOW_GRASS || top === ID.PODZOL) {
      const q = hash2(x, z, 106);
      const cold = b === BIOME.SNOW || (b === BIOME.MOUNTAIN && y > SEA + 30);
      if (cold) { /* 雪原は草花を生やさず、一面の雪にする */ }
      else if (b === BIOME.SWAMP && q > .93) setRaw(x, y + 1, z, ID.MUSHROOM);
      else if (q > .93) setRaw(x, y + 1, z, ID.TALL_GRASS);
      else if (q > .915) setRaw(x, y + 1, z, hash2(x, z, 107) > .5 ? ID.ROSE : ID.DAISY);
      if (cold && !getBlock(x, y + 1, z)) setRaw(x, y + 1, z, ID.SNOW);
    }
  }

  // 5) 遺跡と小屋（探索のごほうび）
  yield { p: .8, msg: '古い遺跡を隠しています' };
  for (let i = 0; i < 10; i++) {
    const x = 12 + Math.floor(hash2(i, 1, 111) * (W - 24));
    const z = 12 + Math.floor(hash2(i, 2, 112) * (W - 24));
    const y = surface(x, z);
    if (y <= SEA + 1) continue;
    const cabin = i % 4 === 0;
    if (cabin) {
      const w = 5, d = 5, hh = 4;
      for (let a = 0; a < w; a++) for (let c = 0; c < d; c++) for (let b = 0; b <= hh; b++) {
        const edge = a === 0 || c === 0 || a === w - 1 || c === d - 1;
        let id = ID.AIR;
        if (b === 0) id = ID.DARK_PLANKS;
        else if (b === hh) id = ID.PLANKS;
        else if (edge) id = (a + c) % 3 === 0 && b === 2 ? ID.GLASS : ID.LOG;
        if (b > 0 && b < hh && a === Math.floor(w / 2) && c === 0) id = ID.AIR; // 入口
        if (id) setRaw(x + a, y + b, z + c, id); else if (b > 0) setRaw(x + a, y + b, z + c, ID.AIR);
      }
      setRaw(x + 1, y + 1, z + 1, ID.BENCH);
      setRaw(x + w - 2, y + hh - 1, z + d - 2, ID.LANTERN);
    } else {
      for (let a = -3; a <= 3; a++) for (let c = -3; c <= 3; c++) {
        const yy = surface(x + a, z + c);
        if (Math.abs(a) === 3 || Math.abs(c) === 3) {
          const hgt = 1 + Math.floor(hash2(x + a, z + c, 113) * 4);
          for (let b = 1; b <= hgt; b++) setRaw(x + a, yy + b, z + c, hash2(a, c + b, 114) > .4 ? ID.MOSSY : ID.COBBLE);
        } else setRaw(x + a, yy, z + c, ID.COBBLE);
      }
      setRaw(x, surface(x, z) + 1, z, ID.GLOWSTONE);
    }
  }
  yield { p: .86, msg: '村を建てています' };
  placeVillages();
  yield { p: .88, msg: '光を通しています' };
}

// --- 村 ---------------------------------------------------------------------
export const villages = [];
function flatness(cx, cz, r) {
  let min = 1e9, max = -1e9, water = 0;
  for (let x = cx - r; x <= cx + r; x += 2) for (let z = cz - r; z <= cz + r; z += 2) {
    const h = heightMap[Math.max(0, Math.min(W - 1, x)) + Math.max(0, Math.min(W - 1, z)) * W];
    if (h <= SEA) water++;
    min = Math.min(min, h); max = Math.max(max, h);
  }
  return water ? 99 : max - min;
}
const setB = (x, y, z, id, m = 0) => setRaw(x, y, z, id, m);
const clearAbove = (x, y, z, n) => { for (let i = 0; i < n; i++) setB(x, y + i, z, ID.AIR); };

function buildHouse(x0, z0, w, d, dir, rng) {
  // 土台の高さ：足元の平均
  let sum = 0, n = 0;
  for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) { sum += surface(x0 + x, z0 + z); n++; }
  const y = Math.round(sum / n);
  const wallH = 4;
  for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) {
    // 土台を埋めて上を空ける
    for (let yy = surface(x0 + x, z0 + z); yy < y; yy++) setB(x0 + x, yy, z0 + z, ID.COBBLE);
    for (let yy = y + 1; yy <= y + wallH + 4; yy++) setB(x0 + x, yy, z0 + z, ID.AIR);
    setB(x0 + x, y, z0 + z, ID.PLANKS);
    const edge = x === 0 || z === 0 || x === w - 1 || z === d - 1;
    const corner = (x === 0 || x === w - 1) && (z === 0 || z === d - 1);
    for (let h = 1; h <= wallH; h++) {
      if (!edge) continue;
      let id = corner ? ID.LOG : ID.PLANKS;
      if (h === 1 && !corner) id = ID.COBBLE;
      if (h === 2 || h === 3) {
        const mid = (x === 0 || x === w - 1) ? (z === Math.floor(d / 2)) : (x === Math.floor(w / 2));
        if (mid && !corner && h === 2) id = ID.GLASS_PANE;
      }
      setB(x0 + x, y + h, z0 + z, id);
    }
  }
  // 屋根：ハーフブロックを段々に
  for (let step = 0; step <= Math.ceil(Math.min(w, d) / 2); step++) {
    for (let x = -1 + step; x <= w - step; x++) for (let z = -1 + step; z <= d - step; z++) {
      const rim = x === -1 + step || x === w - step || z === -1 + step || z === d - step;
      if (rim) setB(x0 + x, y + wallH + 1 + step, z0 + z, ID.WOOD_SLAB);
      else if (step === 0) setB(x0 + x, y + wallH + 1, z0 + z, ID.PLANKS);
    }
  }
  // ドア（南側の中央）
  const dx = x0 + Math.floor(w / 2), dz = z0 + d - 1;
  setB(dx, y + 1, dz, ID.DOOR, 0);
  setB(dx, y + 2, dz, ID.DOOR, 4);
  setB(dx, y, dz + 1, ID.COBBLE);
  // 家具
  setB(x0 + 1, y + 1, z0 + 1, ID.BED, 1);
  setB(x0 + 2, y + 1, z0 + 1, ID.BED, 5);
  setB(x0 + w - 2, y + 1, z0 + 1, ID.BENCH, 0);
  setB(x0 + w - 2, y + 1, z0 + 2, ID.CHEST, 2);
  setB(x0 + 1, y + 3, z0 + d - 2, ID.TORCH);
  setB(x0 + w - 2, y + 3, z0 + d - 2, ID.TORCH);
  setB(x0 + Math.floor(w / 2), y + wallH + 2, z0 + Math.floor(d / 2), ID.LANTERN);
  return y;
}

function buildWell(cx, cz) {
  const y = surface(cx, cz);
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) {
    clearAbove(cx + x, y + 1, cz + z, 6);
    for (let yy = y - 3; yy <= y; yy++) setB(cx + x, yy, cz + z, (x === 0 && z === 0) ? (yy > y - 3 ? ID.WATER : ID.COBBLE) : ID.COBBLE);
    setB(cx + x, y + 1, cz + z, (x === 0 && z === 0) ? ID.AIR : ID.COBBLE);
  }
  setB(cx, y, cz, ID.WATER);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { setB(cx + x, y + 2, cz + z, ID.FENCE); setB(cx + x, y + 3, cz + z, ID.FENCE); }
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) setB(cx + x, y + 4, cz + z, ID.WOOD_SLAB);
}

function buildFarm(x0, z0, w, d) {
  const y = surface(x0 + 1, z0 + 1);
  for (let x = -1; x <= w; x++) for (let z = -1; z <= d; z++) {
    for (let yy = surface(x0 + x, z0 + z); yy < y; yy++) setB(x0 + x, yy, z0 + z, ID.DIRT);
    clearAbove(x0 + x, y + 1, z0 + z, 4);
    const rim = x === -1 || z === -1 || x === w || z === d;
    if (rim) { setB(x0 + x, y, z0 + z, ID.LOG); continue; }
    if (x === Math.floor(w / 2)) { setB(x0 + x, y, z0 + z, ID.WATER); continue; }
    setB(x0 + x, y, z0 + z, ID.FARMLAND);
    setB(x0 + x, y + 1, z0 + z, ID.WHEAT, Math.floor(hash2(x0 + x, z0 + z, 131) * 4));
  }
}

function buildVillage(cx, cz) {
  const rng = k => hash2(cx + k, cz, 141);
  const houses = [[-11, -11, 7, 6], [4, -12, 6, 6], [-12, 4, 6, 7], [5, 5, 7, 7]];
  buildWell(cx, cz);
  const ys = [];
  houses.forEach(([dx, dz, w, d], i) => { ys.push(buildHouse(cx + dx, cz + dz, w, d, i, rng)); });
  buildFarm(cx - 4, cz + 8, 8, 4);
  // 小道：井戸から各家へ砂利
  for (const [dx, dz, w, d] of houses) {
    const tx = cx + dx + Math.floor(w / 2), tz = cz + dz + d + 1;
    let x = cx, z = cz + 2;
    for (let i = 0; i < 40 && (x !== tx || z !== tz); i++) {
      if (x !== tx) x += Math.sign(tx - x); else z += Math.sign(tz - z);
      const y = surface(x, z);
      const t = getBlock(x, y, z);
      if (t === ID.GRASS || t === ID.DIRT || t === ID.SAND) setB(x, y, z, ID.GRAVEL);
    }
  }
  // 明かりの柱
  for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
    const y = surface(cx + dx, cz + dz);
    setB(cx + dx, y + 1, cz + dz, ID.FENCE); setB(cx + dx, y + 2, cz + dz, ID.FENCE);
    setB(cx + dx, y + 3, cz + dz, ID.LANTERN);
  }
  villages.push({ x: cx, z: cz, houses: houses.length });
}

export function placeVillages() {
  villages.length = 0;
  const cands = [];
  for (let cx = 28; cx < W - 28; cx += 6) for (let cz = 28; cz < W - 28; cz += 6) {
    const b = biomeMap[cx + cz * W];
    if (b !== BIOME.PLAINS && b !== BIOME.FOREST) continue;
    const f = flatness(cx, cz, 14);
    if (f <= 4) cands.push([f + hash2(cx, cz, 151) * 2, cx, cz]);
  }
  cands.sort((a, b) => a[0] - b[0]);
  for (const [, cx, cz] of cands) {
    if (villages.some(v => Math.hypot(v.x - cx, v.z - cz) < 70)) continue;
    buildVillage(cx, cz);
    if (villages.length >= 3) break;
  }
}

// 安全なスポーン地点（陸地で、木の中でない場所）
export function findSpawn() {
  for (let r = 0; r < 3000; r++) {
    const x = Math.floor(W / 2 + (Math.random() - .5) * W * .5);
    const z = Math.floor(W / 2 + (Math.random() - .5) * W * .5);
    const y = surface(x, z);
    const t = getBlock(x, y, z);
    if (y > SEA + 1 && (t === ID.GRASS || t === ID.SAND || t === ID.PODZOL || t === ID.SNOW_GRASS) &&
        !getBlock(x, y + 1, z) && !getBlock(x, y + 2, z)) return [x + .5, y + 1.02, z + .5];
  }
  return [W / 2, 40, W / 2];
}
