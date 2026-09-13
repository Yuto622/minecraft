// entities.js — 生き物とパーティクル
import * as THREE from '../three.module.js';
import { W, SEA, surface, getBlock, isSolid } from './world.js';
import { ID, IT } from './blocks.js';

const box = (w, h, d, color, x, y, z, parent) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z); parent.add(m); return m;
};

export const MOB = {
  pig:     { name: 'ブタ', hp: 10, body: '#e8a39a', legs: '#c98a82', speed: 1.1, drop: IT.MEAT },
  cow:     { name: 'ウシ', hp: 12, body: '#4b3a2d', legs: '#3b2e24', speed: .95, drop: IT.MEAT },
  sheep:   { name: 'ヒツジ', hp: 10, body: '#eeeadb', legs: '#d8d2c0', speed: 1, drop: ID.WOOL_W },
  chicken: { name: 'ニワトリ', hp: 6, body: '#f2f0e8', legs: '#e0a83c', speed: 1.3, drop: IT.MEAT },
  zombie:  { name: 'ゾンビ', hp: 18, body: '#4f7a52', legs: '#3c4f7a', speed: 1.5, hostile: true },
};

function buildMob(type) {
  const g = new THREE.Group(), d = MOB[type];
  const parts = { legs: [], head: null };
  if (type === 'chicken') {
    box(.5, .45, .34, d.body, 0, .55, 0, g);
    parts.head = box(.26, .26, .24, d.body, .28, .82, 0, g);
    box(.1, .08, .08, '#e0a83c', .44, .8, 0, parts.head);
    box(.06, .2, .28, '#ffffff', -.2, .6, .18, g);
    box(.06, .2, .28, '#ffffff', -.2, .6, -.18, g);
    for (const z of [-.11, .11]) parts.legs.push(box(.08, .32, .08, d.legs, 0, .23, z, g));
    box(.22, .16, .04, '#c8443c', .28, .95, 0, g);
  } else if (type === 'zombie') {
    box(.62, .86, .34, d.body, 0, 1.18, 0, g);
    parts.head = box(.52, .5, .5, '#6f9b6b', 0, 1.86, 0, g);
    box(.1, .1, .04, '#20301f', .14, 1.9, .26, parts.head);
    box(.1, .1, .04, '#20301f', -.14, 1.9, .26, parts.head);
    for (const x of [-.42, .42]) { const a = box(.22, .74, .24, '#5f8a60', x, 1.32, .16, g); a.rotation.x = -1.35; parts.legs.push(a); }
    for (const x of [-.16, .16]) parts.legs.push(box(.24, .76, .24, d.legs, x, .38, 0, g));
  } else {
    const w = type === 'cow' ? 1.28 : 1.1, hgt = type === 'cow' ? .82 : .72;
    box(w, hgt, .68, d.body, 0, .86, 0, g);
    parts.head = box(.52, .52, .5, d.body, w * .58, 1.02, 0, g);
    box(.08, .09, .09, '#25211d', w * .58 + .22, 1.1, .17, parts.head);
    box(.08, .09, .09, '#25211d', w * .58 + .22, 1.1, -.17, parts.head);
    if (type === 'cow') { box(.12, .12, .12, '#e8e2d2', w * .58 + .1, 1.24, .2, parts.head); box(.12, .12, .12, '#e8e2d2', w * .58 + .1, 1.24, -.2, parts.head); box(.3, .2, .3, '#e9dfd0', w * .58 + .2, .92, 0, parts.head); }
    if (type === 'pig') box(.18, .16, .24, '#d98c86', w * .58 + .22, .98, 0, parts.head);
    if (type === 'sheep') { box(1.2, .8, .76, '#f6f3ea', 0, .9, 0, g); box(.44, .44, .42, '#d8cdb8', w * .58, 1.02, 0, g); }
    for (const a of [-.38, .38]) for (const b of [-.22, .22]) parts.legs.push(box(.2, .5, .2, d.legs, a, .28, b, g));
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
    const m = { type, g, parts, def: MOB[type], hp: MOB[type].hp, angle: Math.random() * 6.28, t: Math.random() * 10, vy: 0, walk: 0, idle: Math.random() * 4, hurt: 0, atk: 0 };
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
      this.spawn('zombie', x + .5, y + 1, z + .5);
      return;
    }
  }

  update(dt, ctx) {
    const { player, night, survival, hitPlayer } = ctx;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const m = this.list[i];
      m.t += dt; m.hurt = Math.max(0, m.hurt - dt); m.atk = Math.max(0, m.atk - dt);
      const hostile = m.def.hostile;

      if (hostile && !night) { // 朝日で消える
        m.g.scale.multiplyScalar(1 - dt * 2.2);
        if (m.g.scale.x < .15) { this.scene.remove(m.g); this.list.splice(i, 1); }
        continue;
      }

      const dx = player.x - m.g.position.x, dz = player.z - m.g.position.z;
      const dist = Math.hypot(dx, dz);
      let moving = false, speed = m.def.speed;

      if (hostile && dist < 22 && survival) {
        m.angle = Math.atan2(dz, dx);
        moving = dist > 1.2;
        speed *= 1.15;
        if (dist < 1.7 && Math.abs(player.y - m.g.position.y) < 2.2 && m.atk <= 0) { hitPlayer(4); m.atk = 1.1; }
      } else {
        m.idle -= dt;
        if (m.idle <= 0) { m.idle = 2 + Math.random() * 5; m.angle += (Math.random() - .5) * 3; m.state = Math.random() > .35; }
        moving = m.state;
      }

      if (moving) {
        const nx = m.g.position.x + Math.cos(m.angle) * speed * dt;
        const nz = m.g.position.z + Math.sin(m.angle) * speed * dt;
        const fx = Math.floor(nx), fz = Math.floor(nz);
        const h = surface(fx, fz);
        const blocked = nx < 2 || nz < 2 || nx > W - 2 || nz > W - 2 || h <= SEA - 1 || h + 1 - m.g.position.y > 1.3;
        if (blocked) { m.angle += 2.1; moving = false; }
        else {
          m.g.position.x = nx; m.g.position.z = nz;
          m.g.position.y += (h + 1 - m.g.position.y) * Math.min(1, dt * 9);
          m.walk += dt * speed * 6.5;
        }
      }
      m.g.rotation.y = -m.angle + Math.PI / 2;
      const swing = moving ? Math.sin(m.walk) * .55 : 0;
      m.parts.legs.forEach((l, k) => {
        if (hostile && k < 2) { l.rotation.x = -1.35 + Math.sin(m.walk) * .2; return; }
        l.rotation.x = swing * (k % 2 ? 1 : -1);
      });
      if (m.parts.head && !hostile) m.parts.head.rotation.z = Math.sin(m.t * .8) * .06;
      m.g.children.forEach(c => { if (c.material) c.material.emissive?.setScalar(m.hurt > 0 ? .45 : 0); });
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

  damage(m, dmg, onDrop) {
    m.hp -= dmg; m.hurt = .3;
    m.angle = Math.atan2(m.g.position.z - (m.lastHitZ ?? 0), m.g.position.x - (m.lastHitX ?? 0));
    if (m.hp <= 0) {
      const i = this.list.indexOf(m);
      if (i >= 0) this.list.splice(i, 1);
      this.scene.remove(m.g);
      if (m.def.drop) onDrop?.(m.def.drop, 1 + Math.floor(Math.random() * 2));
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
