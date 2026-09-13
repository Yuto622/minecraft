// drops.js — 落ちているアイテム
// 壊したブロックはその場に落ち、近づくと吸い寄せられて拾える。
import * as THREE from '../three.module.js';
import { getBlock, isSolid } from './world.js';
import { blocks, items, isItem, color as blockColor } from './blocks.js';
import { blockTextures, tileTexture } from './textures.js';

const geoBlock = new THREE.BoxGeometry(.26, .26, .26);
const geoFlat = new THREE.PlaneGeometry(.34, .34);

export class Drops {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.matCache = new Map();
  }
  clear() { for (const d of this.list) this.scene.remove(d.mesh); this.list.length = 0; }

  _mesh(id) {
    if (isItem(id) || blocks[id]?.plant) {
      let mat = this.matCache.get(id);
      if (!mat) {
        const b = blocks[id];
        mat = b?.plant
          ? new THREE.MeshLambertMaterial({ map: tileTexture(b.tiles[0]), transparent: true, alphaTest: .5, side: THREE.DoubleSide })
          : new THREE.MeshLambertMaterial({ color: items[id]?.color || '#ccc', side: THREE.DoubleSide });
        this.matCache.set(id, mat);
      }
      return new THREE.Mesh(geoFlat, mat);
    }
    const texs = blockTextures(id);
    return new THREE.Mesh(geoBlock, texs
      ? texs.map(t => new THREE.MeshLambertMaterial({ map: t }))
      : new THREE.MeshLambertMaterial({ color: blockColor(id) }));
  }

  spawn(id, n, x, y, z, spread = .18, dur) {
    if (this.list.length > 220) this.list.splice(0, 20).forEach(d => this.scene.remove(d.mesh));
    const mesh = this._mesh(id);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.list.push({
      id, n, mesh, dur,
      vx: (Math.random() - .5) * spread * 6, vy: 1.6 + Math.random() * 1.2, vz: (Math.random() - .5) * spread * 6,
      age: 0, spin: Math.random() * 6.28, pickCd: .45,
    });
  }

  update(dt, player, onPickup) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const d = this.list[i];
      d.age += dt;
      d.pickCd -= dt;
      if (d.age > 300) { this.scene.remove(d.mesh); this.list.splice(i, 1); continue; }

      const p = d.mesh.position;
      const dx = player.x - p.x, dy = player.y + .6 - p.y, dz = player.z - p.z;
      const dist = Math.hypot(dx, dy, dz);

      if (d.pickCd <= 0 && dist < 1.9) {                 // 吸い寄せ
        const pull = Math.min(14, 5 / Math.max(.25, dist)) * dt;
        p.x += dx * pull; p.y += dy * pull; p.z += dz * pull;
        if (dist < .55) {
          const left = onPickup(d.id, d.n, d.dur);
          if (left <= 0) { this.scene.remove(d.mesh); this.list.splice(i, 1); continue; }
          d.n = left;
        }
      } else {
        d.vy -= dt * 20;
        const nx = p.x + d.vx * dt, nz = p.z + d.vz * dt, ny = p.y + d.vy * dt;
        if (!isSolid(getBlock(Math.floor(nx), Math.floor(p.y), Math.floor(p.z)))) p.x = nx;
        if (!isSolid(getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(nz)))) p.z = nz;
        if (isSolid(getBlock(Math.floor(p.x), Math.floor(ny - .12), Math.floor(p.z)))) {
          if (d.vy < 0) { p.y = Math.floor(ny) + 1.14; d.vy = 0; d.vx *= .55; d.vz *= .55; }
        } else p.y = ny;
      }
      d.spin += dt * 1.9;
      d.mesh.rotation.y = d.spin;
      d.mesh.position.y += Math.sin(d.age * 2.6) * .0016;
      if (d.mesh.geometry === geoFlat) d.mesh.rotation.y = d.spin;
    }
  }

  toJSON() { return this.list.map(d => [d.id, d.n, +d.mesh.position.x.toFixed(2), +d.mesh.position.y.toFixed(2), +d.mesh.position.z.toFixed(2)]); }
  fromJSON(a) {
    this.clear();
    (a || []).forEach(([id, n, x, y, z]) => { this.spawn(id, n, x, y, z, 0); });
  }
}
