// entities.js — 生き物とパーティクル
import * as THREE from '../three.module.js';
import { W, H, SEA, surface, getBlock, isSolid } from './world.js';
import { ID, IT } from './blocks.js';

const clampN = (v, a, b) => v < a ? a : v > b ? b : v;

const box = (w, h, d, color, x, y, z, parent) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z); parent.add(m); return m;
};

// 脚は「付け根」で回すためのグループを作る。中心で回すと膝から折れたように見える。
const limb = (w, h, d, color, x, hipY, z, parent) => {
  const g = new THREE.Group();
  g.position.set(x, hipY, z);
  parent.add(g);
  box(w, h, d, color, 0, -h / 2, 0, g);
  return g;
};

// その座標で立てる高さ（足元のブロックの上面）。y から下へ探す。
function groundAt(x, z, fromY) {
  const bx = Math.floor(x), bz = Math.floor(z);
  const top = Math.min(H - 1, Math.floor(fromY) + 1);
  for (let y = top; y >= 0; y--) if (isSolid(getBlock(bx, y, bz))) return y + 1;
  return -1;
}

export const MOB = {
  pig:     { name: 'ブタ', hp: 10, body: '#e8a39a', legs: '#c98a82', speed: 1.1, drop: IT.MEAT_RAW },
  cow:     { name: 'ウシ', hp: 12, body: '#4b3a2d', legs: '#3b2e24', speed: .95, drop: IT.MEAT_RAW, drop2: IT.LEATHER },
  sheep:   { name: 'ヒツジ', hp: 10, body: '#eeeadb', legs: '#d8d2c0', speed: 1, drop: ID.WOOL_W },
  chicken: { name: 'ニワトリ', hp: 6, body: '#f2f0e8', legs: '#e0a83c', speed: 1.3, drop: IT.MEAT_RAW },
  zombie:  { name: 'ゾンビ', hp: 18, body: '#4f7a52', legs: '#3c4f7a', speed: 1.5, hostile: true },
  creeper: { name: 'クリーパー', hp: 14, body: '#5fa356', legs: '#4a8a46', speed: 1.7, hostile: true, fuse: true },
  skeleton: { name: 'スケルトン', hp: 16, body: '#d9d7cf', legs: '#c6c4bc', speed: 1.25, hostile: true, ranged: true },
  villager: { name: '村人', hp: 20, body: '#7a5a3e', legs: '#5a4430', speed: .9, villager: true },
};

export function buildMob(type) {
  const g = new THREE.Group(), d = MOB[type];
  const parts = { legs: [], arms: [], head: null };
  if (type === 'chicken') {
    box(.5, .45, .34, d.body, 0, .55, 0, g);
    parts.head = box(.26, .26, .24, d.body, .28, .82, 0, g);
    box(.1, .08, .08, '#e0a83c', .44, .8, 0, parts.head);
    box(.06, .2, .28, '#ffffff', -.2, .6, .18, g);
    box(.06, .2, .28, '#ffffff', -.2, .6, -.18, g);
    for (const z of [-.11, .11]) parts.legs.push(limb(.08, .32, .08, d.legs, 0, .4, z, g));
    box(.22, .16, .04, '#c8443c', .28, .95, 0, g);
  } else if (type === 'villager') {
    box(.54, .9, .34, d.body, 0, 1.2, 0, g);                       // ローブ
    box(.6, .3, .38, '#5f4630', 0, .75, 0, g);
    parts.head = box(.5, .56, .5, '#d9a877', 0, 1.9, 0, g);
    box(.12, .2, .14, '#c98f6a', 0, 1.82, .3, parts.head);         // 大きな鼻
    box(.1, .1, .04, '#3a6a3a', .13, 1.96, .25, parts.head);
    box(.1, .1, .04, '#3a6a3a', -.13, 1.96, .25, parts.head);
    box(.52, .12, .52, '#5a4430', 0, 2.2, 0, parts.head);
    const armsG = new THREE.Group(); armsG.position.set(0, 1.35, .12); g.add(armsG);
    box(.56, .2, .2, d.body, 0, 0, 0, armsG);                      // 組んだ腕
    for (const x of [-.13, .13]) parts.legs.push(limb(.22, .74, .24, d.legs, x, .78, 0, g));
  } else if (type === 'skeleton') {
    box(.42, .8, .26, d.body, 0, 1.2, 0, g);
    parts.head = box(.5, .5, .5, '#e4e2da', 0, 1.85, 0, g);
    box(.1, .1, .04, '#1c1c1c', .13, 1.9, .25, parts.head);
    box(.1, .1, .04, '#1c1c1c', -.13, 1.9, .25, parts.head);
    for (const x of [-.32, .32]) { const a = limb(.14, .7, .14, d.body, x, 1.55, .08, g); a.rotation.x = -1.5; parts.arms.push(a); }
    for (const x of [-.12, .12]) parts.legs.push(limb(.14, .74, .14, d.legs, x, .76, 0, g));
    box(.06, .8, .06, '#8a6435', .42, 1.5, .18, g);
  } else if (type === 'creeper') {
    box(.52, .9, .34, d.body, 0, 1.05, 0, g);
    parts.head = box(.5, .5, .5, '#63ab58', 0, 1.72, 0, g);
    box(.13, .13, .04, '#0f1a10', .12, 1.78, .25, parts.head);
    box(.13, .13, .04, '#0f1a10', -.12, 1.78, .25, parts.head);
    box(.13, .2, .04, '#0f1a10', 0, 1.64, .25, parts.head);
    box(.26, .1, .04, '#0f1a10', 0, 1.56, .25, parts.head);
    for (const x of [-.16, .16]) for (const z of [-.18, .18]) parts.legs.push(limb(.2, .58, .2, d.legs, x, .6, z, g));
  } else if (type === 'zombie') {
    box(.62, .86, .34, d.body, 0, 1.18, 0, g);
    parts.head = box(.52, .5, .5, '#6f9b6b', 0, 1.86, 0, g);
    box(.1, .1, .04, '#20301f', .14, 1.9, .26, parts.head);
    box(.1, .1, .04, '#20301f', -.14, 1.9, .26, parts.head);
    for (const x of [-.42, .42]) { const a = limb(.22, .74, .24, '#5f8a60', x, 1.55, .1, g); a.rotation.x = -1.4; parts.arms.push(a); }
    for (const x of [-.16, .16]) parts.legs.push(limb(.24, .76, .24, d.legs, x, .78, 0, g));
  } else {
    const w = type === 'cow' ? 1.28 : 1.1, hgt = type === 'cow' ? .82 : .72;
    box(w, hgt, .68, d.body, 0, .86, 0, g);
    parts.head = box(.52, .52, .5, d.body, w * .58, 1.02, 0, g);
    box(.08, .09, .09, '#25211d', w * .58 + .22, 1.1, .17, parts.head);
    box(.08, .09, .09, '#25211d', w * .58 + .22, 1.1, -.17, parts.head);
    if (type === 'cow') { box(.12, .12, .12, '#e8e2d2', w * .58 + .1, 1.24, .2, parts.head); box(.12, .12, .12, '#e8e2d2', w * .58 + .1, 1.24, -.2, parts.head); box(.3, .2, .3, '#e9dfd0', w * .58 + .2, .92, 0, parts.head); }
    if (type === 'pig') box(.18, .16, .24, '#d98c86', w * .58 + .22, .98, 0, parts.head);
    if (type === 'sheep') { box(1.2, .8, .76, '#f6f3ea', 0, .9, 0, g); box(.44, .44, .42, '#d8cdb8', w * .58, 1.02, 0, g); }
    for (const a of [-.38, .38]) for (const b of [-.22, .22]) parts.legs.push(limb(.2, .5, .2, d.legs, a, .54, b, g));
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = false; });
  return { g, parts };
}

export class Mobs {
  constructor(scene) { this.scene = scene; this.list = []; }
  clear() { for (const m of this.list) this.scene.remove(m.g); this.list.length = 0; }

  spawn(type, x, y, z) {
    const { g, parts } = buildMob(type);
    g.position.set(x, y, z);
    const angle = Math.random() * 6.28;
    const m = {
      type, g, parts, def: MOB[type], hp: MOB[type].hp,
      angle, target: angle, t: Math.random() * 10, vy: 0, walkT: 0,
      idle: Math.random() * 4, walking: false, hurt: 0, atk: 0, flee: 0,
      voice: 4 + Math.random() * 20, love: 0, loveCd: 0, baby: false, grow: 0,
    };
    this.scene.add(g); this.list.push(m);
    return m;
  }

  populate(count = 34) {
    this.clear();
    let tries = 0;
    while (this.list.length < count && tries++ < count * 60) {
      const x = 6 + Math.random() * (W - 12), z = 6 + Math.random() * (W - 12);
      const y = surface(Math.floor(x), Math.floor(z));
      if (y <= SEA + 1) continue;
      const t = getBlock(Math.floor(x), y, Math.floor(z));
      if (t !== ID.GRASS && t !== ID.PODZOL && t !== ID.SNOW_GRASS) continue;
      const types = ['pig', 'cow', 'sheep', 'chicken'];
      this.spawn(types[Math.floor(Math.random() * types.length)], x, y + 1, z);
    }
  }

  // 夜になったら暗いところにゾンビを湧かせる
  trySpawnHostile(player, night, max = 12) {
    if (!night) return;
    const zc = this.list.filter(m => m.def.hostile).length;
    if (zc >= max) return;
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * 6.28, r = 20 + Math.random() * 26;
      const x = Math.floor(player.x + Math.cos(a) * r), z = Math.floor(player.z + Math.sin(a) * r);
      if (x < 4 || z < 4 || x > W - 5 || z > W - 5) continue;
      const y = surface(x, z);
      if (y <= SEA) continue;
      if (getBlock(x, y + 1, z) || getBlock(x, y + 2, z)) continue;
      const pick = Math.random();
      this.spawn(pick < .3 ? 'creeper' : pick < .58 ? 'skeleton' : 'zombie', x + .5, y + 1, z + .5);
      return;
    }
  }

  update(dt, ctx) {
    const { player, night, survival, hitPlayer } = ctx;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const m = this.list[i];
      m.t += dt;
      m.hurt = Math.max(0, m.hurt - dt);
      m.love = Math.max(0, (m.love || 0) - dt);
      m.loveCd = Math.max(0, (m.loveCd || 0) - dt);
      if (m.baby) {
        m.grow -= dt;
        if (m.grow <= 0) { m.baby = false; m.g.scale.setScalar(1); }
        else m.g.scale.setScalar(.55 + (1 - m.grow / 150) * .45);
      }
      m.atk = Math.max(0, m.atk - dt);
      const hostile = m.def.hostile;
      const pos = m.g.position;

      if (hostile && !night) {                       // 朝日を浴びて消えていく
        m.g.scale.multiplyScalar(1 - dt * 2.2);
        if (m.g.scale.x < .15) { this.scene.remove(m.g); this.list.splice(i, 1); }
        continue;
      }

      const dx = player.x - pos.x, dz = player.z - pos.z;
      const dist = Math.hypot(dx, dz);
      let want = false, speed = m.def.speed;

      if (m.flee > 0) {                              // 殴られたら少し逃げる
        m.flee -= dt; want = true; speed *= 1.7;
      } else if (hostile && survival && dist < 22) {
        m.target = Math.atan2(dz, dx);
        want = dist > 1.1;
        speed *= 1.15;
        if (dist < 1.8 && Math.abs(player.y - pos.y) < 2.4 && m.atk <= 0) { hitPlayer(4); m.atk = 1.1; }
      } else if (m.def.villager && m.home) {
        m.idle -= dt;
        if (m.idle <= 0) {
          m.idle = 2 + Math.random() * 5;
          m.walking = Math.random() > .4;
          const far = Math.hypot(m.home.x - pos.x, m.home.z - pos.z) > 14;
          m.target = far ? Math.atan2(m.home.z - pos.z, m.home.x - pos.x) : m.angle + (Math.random() - .5) * 2.4;
        }
        want = m.walking;
        if (dist < 3 && !night) { m.target = Math.atan2(dz, dx); want = false; }   // 近づくと向いてくる
      } else if (m.love > 0) {
        let mate = null;
        for (const o of this.list) if (o !== m && o.type === m.type && o.love > 0 && !o.baby) { mate = o; break; }
        if (mate) { m.target = Math.atan2(mate.g.position.z - pos.z, mate.g.position.x - pos.x); want = true; speed *= 1.2; }
        else { m.idle -= dt; want = m.walking; }
      } else {
        m.idle -= dt;
        if (m.idle <= 0) {                           // ときどき向きを変えて、歩いたり止まったり
          m.idle = 2.5 + Math.random() * 5;
          m.walking = Math.random() > .35;
          if (m.walking) m.target = m.angle + (Math.random() - .5) * 2.4;
        }
        want = m.walking;
      }

      // 向きはなめらかに回す（その場でくるっと向き直らない）
      let da = ((m.target - m.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      m.angle += clampN(da, -dt * 3.4, dt * 3.4);

      // 足元の地面。葉や幹の上には登らない（1ブロックの段差までしか上がらない）
      let moved = false;
      if (want) {
        const nx = pos.x + Math.cos(m.angle) * speed * dt;
        const nz = pos.z + Math.sin(m.angle) * speed * dt;
        const g = groundAt(nx, nz, pos.y + .6);
        const headFree = !isSolid(getBlock(Math.floor(nx), Math.floor(pos.y) + 1, Math.floor(nz)));
        const inBounds = nx > 2 && nz > 2 && nx < W - 2 && nz < W - 2;
        if (inBounds && headFree && g >= 0 && g > SEA - 1 && g - pos.y <= 1.05 && pos.y - g < 4) {
          pos.x = nx; pos.z = nz; moved = true;
          m.walkT += dt * speed * 6.2;
        } else {
          m.target = m.angle + 1.6 + Math.random();  // 行き止まりなら向きを変える
          m.idle = Math.min(m.idle, .6);
        }
      }

      // 落下と着地
      const gy = groundAt(pos.x, pos.z, pos.y + .6);
      if (gy < 0) {                                  // 足場が無ければ落ちる
        m.vy -= dt * 22;
        pos.y += m.vy * dt;
        if (pos.y < -4) { this.scene.remove(m.g); this.list.splice(i, 1); continue; }
      } else if (pos.y > gy + .02) {
        m.vy -= dt * 22;
        pos.y = Math.max(gy, pos.y + m.vy * dt);
        if (pos.y <= gy) { pos.y = gy; m.vy = 0; }
      } else {
        pos.y += (gy - pos.y) * Math.min(1, dt * 12);
        m.vy = 0;
      }

      m.g.rotation.y = -m.angle;                     // 体の正面(+X)を進行方向へ
      const swing = moved ? Math.sin(m.walkT) * .62 : Math.sin(m.t * 1.4) * .03;
      m.parts.legs.forEach((l, k) => { l.rotation.x = swing * (k % 2 ? 1 : -1); });
      m.parts.arms.forEach((a, k) => { a.rotation.x = -1.4 + Math.sin(m.walkT) * .18 * (k ? 1 : -1); });
      if (m.parts.head) {
        m.parts.head.rotation.y = hostile ? 0 : Math.sin(m.t * .55) * .28;
        m.parts.head.rotation.z = Math.sin(m.t * .9) * .05;
      }
      m.g.traverse(o => { if (o.isMesh && o.material.emissive) o.material.emissive.setScalar(m.hurt > 0 ? .5 : 0); });

      // ときどき鳴く
      m.voice -= dt;
      if (m.voice <= 0) { m.voice = 9 + Math.random() * 22; if (dist < 24 && ctx.voice !== false) ctx.onVoice?.(m.type); }
    }
  }

  // 照準の先にいる生き物
  pick(origin, dir, maxDist = 4.2) {
    let best = null, bd = maxDist;
    for (const m of this.list) {
      const c = m.g.position.clone().add(new THREE.Vector3(0, .8, 0));
      const to = c.sub(origin);
      const t = to.dot(dir);
      if (t < 0 || t > bd) continue;
      if (to.addScaledVector(dir, -t).length() < .85) { bd = t; best = m; }
    }
    return best;
  }

  // 小麦を食べさせる。近くに同じ種類の相手がいれば子が生まれる。
  feed(m) {
    if (m.baby || m.loveCd > 0) return false;
    m.love = 18;
    m.loveCd = 24;
    for (const o of this.list) {
      if (o === m || o.type !== m.type || !(o.love > 0) || o.baby) continue;
      if (o.g.position.distanceTo(m.g.position) > 6) continue;
      o.love = 0; m.love = 0;
      const baby = this.spawn(m.type, (m.g.position.x + o.g.position.x) / 2, m.g.position.y, (m.g.position.z + o.g.position.z) / 2);
      baby.baby = true;
      baby.grow = 150;
      baby.g.scale.setScalar(.55);
      return true;
    }
    return true;
  }

  damage(m, dmg, from, onDrop) {
    m.hp -= dmg;
    m.hurt = .3;
    if (from) {                       // 殴られた方向と逆へ逃げる
      m.target = Math.atan2(m.g.position.z - from.z, m.g.position.x - from.x);
      m.flee = m.def.hostile ? 0 : 2.6;
      m.walking = true;
    }
    if (m.hp <= 0) {
      const i = this.list.indexOf(m);
      if (i >= 0) this.list.splice(i, 1);
      this.scene.remove(m.g);
      if (m.def.drop) onDrop?.(m.def.drop, 1 + Math.floor(Math.random() * 2));
      if (m.def.drop2 && Math.random() < .6) onDrop?.(m.def.drop2, 1);
      if (m.type === 'skeleton') { onDrop?.(IT.ARROW, 1 + Math.floor(Math.random() * 2)); }
      return true;
    }
    return false;
  }
}

// --- パーティクル -----------------------------------------------------------
export class Particles {
  constructor(scene, cap = 400) {
    this.cap = cap;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.items = [];
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
  }
  burst(x, y, z, colorHex, n = 14, power = 1) {
    for (let i = 0; i < n && this.items.length < this.cap; i++) {
      this.items.push({
        p: new THREE.Vector3(x + Math.random(), y + Math.random(), z + Math.random()),
        v: new THREE.Vector3((Math.random() - .5) * 4 * power, Math.random() * 3.4 * power + .6, (Math.random() - .5) * 4 * power),
        life: .6 + Math.random() * .7, max: 1.3, size: .06 + Math.random() * .09, c: colorHex,
        rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
      });
    }
  }
  update(dt) {
    const arr = this.items;
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      p.life -= dt;
      if (p.life <= 0) { arr.splice(i, 1); continue; }
      p.v.y -= dt * 16;
      p.p.addScaledVector(p.v, dt);
      const gx = Math.floor(p.p.x), gy = Math.floor(p.p.y), gz = Math.floor(p.p.z);
      if (isSolid(getBlock(gx, gy, gz))) { p.p.y = gy + 1.01; p.v.y = Math.abs(p.v.y) * .28; p.v.x *= .6; p.v.z *= .6; }
      p.rot.x += dt * 3; p.rot.z += dt * 2;
    }
    this.mesh.count = arr.length;
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i], s = p.size * Math.min(1, p.life * 3);
      this._q.setFromEuler(p.rot);
      this._s.setScalar(s);
      this._m.compose(p.p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
      this._c.set(p.c);
      this.mesh.setColorAt(i, this._c);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

// --- サーバーから送られてくる生き物を、位置だけ受け取って描く ------------------
export class RemoteMobs {
  constructor(scene) { this.scene = scene; this.map = new Map(); }
  clear() { for (const m of this.map.values()) this.scene.remove(m.g); this.map.clear(); }
  remove(id) {
    const m = this.map.get(id);
    if (!m) return null;
    this.scene.remove(m.g);
    this.map.delete(id);
    return m;
  }
  add(id, type, x, y, z, angle = 0) {
    if (this.map.has(id)) return this.map.get(id);
    const { g, parts } = buildMob(type);
    g.position.set(x, y, z);
    this.scene.add(g);
    const m = { id, type, g, parts, def: MOB[type] || MOB.pig, tx: x, ty: y, tz: z, angle, tangle: angle, walkT: 0, moving: false, hurt: 0, fuse: 0 };
    this.map.set(id, m);
    return m;
  }
  sync(list) {                               // [id, x, y, z, angle, walking, fuse]
    for (const [id, x, y, z, a, w, fu] of list) {
      const m = this.map.get(id);
      if (!m) continue;
      m.tx = x; m.ty = y; m.tz = z; m.tangle = a; m.moving = !!w; m.fuse = fu;
    }
  }
  update(dt) {
    for (const m of this.map.values()) {
      const p = m.g.position;
      const k = Math.min(1, dt * 11);
      p.x += (m.tx - p.x) * k; p.y += (m.ty - p.y) * k; p.z += (m.tz - p.z) * k;
      let da = ((m.tangle - m.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      m.angle += da * Math.min(1, dt * 9);
      m.g.rotation.y = -m.angle;
      m.hurt = Math.max(0, m.hurt - dt);
      if (m.moving) m.walkT += dt * m.def.speed * 6.2;
      const swing = m.moving ? Math.sin(m.walkT) * .62 : 0;
      m.parts.legs.forEach((l, i) => { l.rotation.x = swing * (i % 2 ? 1 : -1); });
      m.parts.arms.forEach((a, i) => { a.rotation.x = -1.4 + Math.sin(m.walkT) * .18 * (i ? 1 : -1); });
      if (m.fuse) m.g.scale.setScalar(1 + Math.sin(performance.now() * .02) * .16);
      else if (m.g.scale.x !== 1) m.g.scale.setScalar(1);
      m.g.traverse(o => { if (o.isMesh && o.material.emissive) o.material.emissive.setScalar(m.hurt > 0 ? .5 : (m.fuse ? .5 : 0)); });
    }
  }
  pick(origin, dir, maxDist = 4.2) {
    let best = null, bd = maxDist;
    for (const m of this.map.values()) {
      const c = m.g.position.clone().add(new THREE.Vector3(0, .8, 0));
      const to = c.sub(origin);
      const t = to.dot(dir);
      if (t < 0 || t > bd) continue;
      if (to.addScaledVector(dir, -t).length() < .85) { bd = t; best = m; }
    }
    return best;
  }
}

// --- 矢 ---------------------------------------------------------------------
export class Arrows {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.geo = new THREE.CylinderGeometry(.028, .028, .8, 5);
    this.geo.rotateX(Math.PI / 2);
    this.mat = new THREE.MeshLambertMaterial({ color: '#c9c2b2' });
    this.tipMat = new THREE.MeshLambertMaterial({ color: '#5a5f63' });
  }
  clear() { for (const a of this.list) this.scene.remove(a.mesh); this.list.length = 0; }

  shoot(x, y, z, dx, dy, dz, power, fromPlayer) {
    const len = Math.hypot(dx, dy, dz) || 1;
    const speed = 18 + power * 26;
    const mesh = new THREE.Mesh(this.geo, this.mat);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(.055, .16, 5), this.tipMat);
    tip.rotation.x = -Math.PI / 2;
    tip.position.z = .44;
    mesh.add(tip);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.list.push({
      mesh, fromPlayer,
      vx: dx / len * speed, vy: dy / len * speed, vz: dz / len * speed,
      life: 12, dmg: fromPlayer ? 3 + power * 6 : 4,
    });
  }

  update(dt, ctx) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const a = this.list[i];
      a.life -= dt;
      const p = a.mesh.position;
      a.vy -= dt * 17;
      const nx = p.x + a.vx * dt, ny = p.y + a.vy * dt, nz = p.z + a.vz * dt;
      let done = a.life <= 0;

      if (isSolid(getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz)))) {
        ctx.onHitBlock?.(nx, ny, nz);
        done = true;
      } else if (a.fromPlayer) {
        const m = ctx.pickMob?.(nx, ny, nz);
        if (m) { ctx.hitMob?.(m, a.dmg); done = true; }
      } else {
        const pl = ctx.player;
        if (Math.abs(pl.x - nx) < .5 && Math.abs(pl.z - nz) < .5 && ny > pl.y && ny < pl.y + 1.85) {
          ctx.hitPlayer?.(a.dmg);
          done = true;
        }
      }
      if (done) { this.scene.remove(a.mesh); this.list.splice(i, 1); continue; }
      p.set(nx, ny, nz);
      a.mesh.lookAt(nx + a.vx, ny + a.vy, nz + a.vz);
    }
  }
}
