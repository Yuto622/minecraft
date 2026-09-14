// server.js — BLOCKWILD のマルチプレイ用サーバー
// dist/ を配信しつつ、同じポートで WebSocket を受ける。追加のパッケージは要らない。
//   node server/server.js [ポート番号]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { attach } from './ws.js';
import { encodeLan, codeFromTunnel, pretty } from '../dist/src/code.js';
import { W, H, SEA, idx, voxels, metaArr, setRaw, getBlock, surface, isSolid } from '../dist/src/world.js';
import { generate, setSeed, findSpawn, villages } from '../dist/src/worldgen.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(DIR, '..', 'dist');
const PORT = Number(process.argv.slice(2).find(a => /^\d+$/.test(a)) || process.env.PORT || 8080);
const MAX_PLAYERS = 20;
const DAY_LEN = 720;

// --- 世界 -------------------------------------------------------------------
const seed = (Math.random() * 1e9) | 0;
console.log('世界を作っています…（シード ' + seed + '）');
let t0 = Date.now();
setSeed(seed);
for (const _ of generate()) { /* 生成の進み具合は使わない */ }
console.log('できました（' + (Date.now() - t0) + 'ms、村 ' + villages.length + ' か所）');

const delta = new Map();          // index -> (meta<<8 | id) 生成後に変わったブロック
let time = 300, weather = 0, weatherT = 300 + Math.random() * 500;

function setBlock(x, y, z, id, m) {
  if (x < 0 || z < 0 || y < 0 || x >= W || z >= W || y >= H) return false;
  setRaw(x, y, z, id, m);
  delta.set(idx(x, y, z), (m << 8) | id);
  return true;
}
function deltaBuffer() {
  const buf = Buffer.alloc(1 + delta.size * 6);
  buf[0] = 1;
  let o = 1;
  for (const [i, v] of delta) {
    buf.writeUInt32LE(i, o); buf[o + 4] = v & 255; buf[o + 5] = v >> 8; o += 6;
  }
  return buf;
}

// --- 生き物（位置だけをサーバーが持ち、見た目は各自が描く）-------------------
const MOBS = {
  pig: { hp: 10, speed: 1.1 }, cow: { hp: 12, speed: .95 }, sheep: { hp: 10, speed: 1 },
  chicken: { hp: 6, speed: 1.3 }, villager: { hp: 20, speed: .9 },
  zombie: { hp: 18, speed: 1.5, hostile: true }, skeleton: { hp: 16, speed: 1.25, hostile: true, ranged: true },
  creeper: { hp: 14, speed: 1.7, hostile: true, fuse: true },
};
let mobSeq = 1;
const mobs = new Map();

function groundAt(x, z, fromY) {
  const bx = Math.floor(x), bz = Math.floor(z);
  for (let y = Math.min(H - 1, Math.floor(fromY) + 1); y >= 0; y--) if (isSolid(getBlock(bx, y, bz))) return y + 1;
  return -1;
}
function spawnMob(type, x, y, z, home) {
  const id = mobSeq++;
  const a = Math.random() * 6.28;
  mobs.set(id, { id, type, x, y, z, angle: a, target: a, hp: MOBS[type].hp, idle: Math.random() * 4, walking: false, vy: 0, fuse: 0, atk: 0, home });
  return id;
}
function populate() {
  let tries = 0;
  while ([...mobs.values()].filter(m => !MOBS[m.type].hostile).length < 46 && tries++ < 4000) {
    const x = 6 + Math.random() * (W - 12), z = 6 + Math.random() * (W - 12);
    const y = surface(Math.floor(x), Math.floor(z));
    if (y <= SEA + 1) continue;
    const t = getBlock(Math.floor(x), y, Math.floor(z));
    if (t !== 1 && t !== 44 && t !== 46) continue;
    spawnMob(['pig', 'cow', 'sheep', 'chicken'][(Math.random() * 4) | 0], x, y + 1, z);
  }
  for (const v of villages) for (let i = 0; i < 6; i++) {
    const x = v.x + (Math.random() - .5) * 20, z = v.z + (Math.random() - .5) * 20;
    const y = surface(Math.floor(x), Math.floor(z));
    if (y > SEA && !getBlock(Math.floor(x), y + 1, Math.floor(z))) spawnMob('villager', x, y + 1, z, { x: v.x, z: v.z });
  }
}
populate();

const isNight = () => {
  const f = (time % DAY_LEN) / DAY_LEN;
  return f < .18 || f > .78;
};

function updateMobs(dt) {
  const list = [...players.values()].filter(p => p.alive);
  for (const m of mobs.values()) {
    const def = MOBS[m.type];
    // 一番近いプレイヤーを探す
    let near = null, nd = 1e9;
    for (const p of list) {
      const d = Math.hypot(p.x - m.x, p.z - m.z);
      if (d < nd) { nd = d; near = p; }
    }
    if (def.hostile && !isNight()) { mobs.delete(m.id); broadcast({ t: 'mobdead', id: m.id }); continue; }

    let want = false, speed = def.speed;
    if (def.fuse && near && nd < 3.2 && Math.abs(near.y - m.y) < 3) {
      m.fuse += dt;
      if (m.fuse > 1.5) { explode(m.x, m.y + .6, m.z, 3.2); mobs.delete(m.id); broadcast({ t: 'mobdead', id: m.id, boom: 1 }); continue; }
    } else if (m.fuse) m.fuse = 0;

    if (def.hostile && near && nd < 22) {
      m.target = Math.atan2(near.z - m.z, near.x - m.x);
      want = def.ranged ? (nd > 9 || nd < 4) : nd > 1.1;
      if (def.ranged && nd < 4) m.target += Math.PI;
      m.atk -= dt;
      if (nd < (def.ranged ? 16 : 1.8) && m.atk <= 0) {
        m.atk = def.ranged ? 2.4 : 1.1;
        if (!def.ranged || Math.random() < .8) hurtPlayer(near, def.ranged ? 4 : 4, def.ranged ? 'スケルトンの矢' : 'ゾンビ');
      }
    } else if (m.home) {
      m.idle -= dt;
      if (m.idle <= 0) {
        m.idle = 2 + Math.random() * 5;
        m.walking = Math.random() > .4;
        const far = Math.hypot(m.home.x - m.x, m.home.z - m.z) > 14;
        m.target = far ? Math.atan2(m.home.z - m.z, m.home.x - m.x) : m.angle + (Math.random() - .5) * 2.4;
      }
      want = m.walking;
    } else {
      m.idle -= dt;
      if (m.idle <= 0) { m.idle = 2.5 + Math.random() * 5; m.walking = Math.random() > .35; if (m.walking) m.target = m.angle + (Math.random() - .5) * 2.4; }
      want = m.walking;
    }

    let da = ((m.target - m.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    m.angle += Math.max(-dt * 3.4, Math.min(dt * 3.4, da));

    if (want) {
      const nx = m.x + Math.cos(m.angle) * speed * dt, nz = m.z + Math.sin(m.angle) * speed * dt;
      const g = groundAt(nx, nz, m.y + .6);
      const head = !isSolid(getBlock(Math.floor(nx), Math.floor(m.y) + 1, Math.floor(nz)));
      if (nx > 2 && nz > 2 && nx < W - 2 && nz < W - 2 && head && g >= 0 && g > SEA - 1 && g - m.y <= 1.05 && m.y - g < 4) {
        m.x = nx; m.z = nz;
      } else { m.target = m.angle + 1.6 + Math.random(); m.idle = Math.min(m.idle, .6); }
    }
    const gy = groundAt(m.x, m.z, m.y + .6);
    if (gy < 0) { m.vy -= dt * 22; m.y += m.vy * dt; if (m.y < -4) { mobs.delete(m.id); broadcast({ t: 'mobdead', id: m.id }); } }
    else if (m.y > gy + .02) { m.vy -= dt * 22; m.y = Math.max(gy, m.y + m.vy * dt); if (m.y <= gy) { m.y = gy; m.vy = 0; } }
    else { m.y += (gy - m.y) * Math.min(1, dt * 12); m.vy = 0; }
    m.walkingNow = want;
  }

  // 夜は敵が湧く
  if (isNight() && list.length) {
    const hostiles = [...mobs.values()].filter(m => MOBS[m.type].hostile).length;
    if (hostiles < 6 * Math.min(4, list.length)) {
      const p = list[(Math.random() * list.length) | 0];
      const a = Math.random() * 6.28, r = 22 + Math.random() * 24;
      const x = Math.floor(p.x + Math.cos(a) * r), z = Math.floor(p.z + Math.sin(a) * r);
      if (x > 4 && z > 4 && x < W - 5 && z < W - 5) {
        const y = surface(x, z);
        if (y > SEA && !getBlock(x, y + 1, z) && !getBlock(x, y + 2, z)) {
          const q = Math.random();
          spawnMob(q < .3 ? 'creeper' : q < .58 ? 'skeleton' : 'zombie', x + .5, y + 1, z + .5);
        }
      }
    }
  }
}

function explode(x, y, z, radius) {
  const r = Math.ceil(radius), cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z);
  const changed = [];
  for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) {
    const d = Math.hypot(a, b, c);
    if (d > radius) continue;
    const bx = cx + a, by = cy + b, bz = cz + c;
    const id = getBlock(bx, by, bz);
    if (!id || id === 17 || id === 19 || id === 45) continue;
    if (Math.random() > 1 - d / radius * .55) continue;
    if (setBlock(bx, by, bz, 0, 0)) changed.push([bx, by, bz, 0, 0]);
  }
  broadcast({ t: 'boom', x, y, z, r: radius, blocks: changed });
  for (const p of players.values()) {
    const pd = Math.hypot(p.x - x, p.y + 1 - y, p.z - z);
    if (pd < radius + 2) hurtPlayer(p, Math.round(11 * Math.max(.2, 1 - pd / (radius + 2))), 'クリーパー');
  }
}

// --- プレイヤー ---------------------------------------------------------------
let seq = 1;
const players = new Map();       // id -> {sock,...}

function broadcast(msg, except) {
  const s = typeof msg === 'string' ? msg : JSON.stringify(msg);
  for (const p of players.values()) if (p.id !== except) p.sock.send(s);
}
function hurtPlayer(p, dmg, from) {
  p.sock.send(JSON.stringify({ t: 'hurt', dmg, from }));
}

function onJoin(sock) {
  if (players.size >= MAX_PLAYERS) { sock.send(JSON.stringify({ t: 'full' })); sock.close(); return; }
  const id = seq++;
  const sp = findSpawn();
  const p = { id, sock, name: 'ぼうけんしゃ' + id, x: sp[0], y: sp[1], z: sp[2], yaw: 0, pitch: 0, f: 0, h: 0, hp: 20, alive: true, last: Date.now() };
  players.set(id, p);

  sock.onmessage = data => {
    let m;
    try { m = JSON.parse(data); } catch { return; }
    p.last = Date.now();
    switch (m.t) {
      case 'join': {
        p.name = String(m.name || p.name).slice(0, 16).replace(/[<>&]/g, '');
        sock.send(deltaBuffer());
        sock.send(JSON.stringify({
          t: 'welcome', id, seed, time, weather, max: MAX_PLAYERS,
          spawn: [p.x, p.y, p.z],
          players: [...players.values()].filter(o => o.id !== id).map(o => ({ id: o.id, name: o.name, x: o.x, y: o.y, z: o.z })),
          mobs: [...mobs.values()].map(mo => [mo.id, mo.type, +mo.x.toFixed(2), +mo.y.toFixed(2), +mo.z.toFixed(2), +mo.angle.toFixed(2)]),
        }));
        broadcast({ t: 'join', id, name: p.name }, id);
        broadcast({ t: 'sys', text: p.name + ' が世界に入った（' + players.size + '人）' });
        console.log('[join]', p.name, '#' + id, '合計', players.size, '人');
        break;
      }
      case 'pos':
        p.x = m.x; p.y = m.y; p.z = m.z; p.yaw = m.yaw; p.pitch = m.pitch; p.f = m.f | 0; p.h = m.h | 0;
        if (typeof m.hp === 'number') { p.hp = m.hp; p.alive = m.hp > 0; }
        break;
      case 'block':
        if (setBlock(m.x, m.y, m.z, m.id | 0, m.m | 0)) broadcast({ t: 'block', x: m.x, y: m.y, z: m.z, id: m.id | 0, m: m.m | 0 }, id);
        break;
      case 'chat': {
        const text = String(m.text || '').slice(0, 200);
        if (!text) break;
        broadcast({ t: 'chat', from: p.name, text });
        console.log('[chat]', p.name + ':', text);
        break;
      }
      case 'needmob': {
        const mo = mobs.get(m.id);
        if (mo) sock.send(JSON.stringify({ t: 'mobspawn', id: mo.id, type: mo.type, x: mo.x, y: mo.y, z: mo.z }));
        break;
      }
      case 'mobhit': {
        const mo = mobs.get(m.id);
        if (!mo) break;
        mo.hp -= m.dmg || 2;
        mo.target = Math.atan2(mo.z - p.z, mo.x - p.x);
        mo.walking = true;
        if (mo.hp <= 0) { mobs.delete(mo.id); broadcast({ t: 'mobdead', id: mo.id, by: id }); }
        else broadcast({ t: 'mobhurt', id: mo.id });
        break;
      }
      case 'pvp': {
        const target = players.get(m.id);
        if (target) hurtPlayer(target, Math.min(10, m.dmg || 1), p.name);
        break;
      }
      case 'time':                       // 誰かがベッドで寝た
        if (m.sleep) { time = Math.ceil(time / DAY_LEN) * DAY_LEN + DAY_LEN * .27; broadcast({ t: 'sys', text: p.name + ' が眠って朝になった' }); }
        break;
    }
  };

  sock.onclose = () => {
    players.delete(id);
    broadcast({ t: 'leave', id });
    broadcast({ t: 'sys', text: p.name + ' が世界を出た' });
    console.log('[leave]', p.name, '残り', players.size, '人');
  };
}

// --- ループ -------------------------------------------------------------------
let lastTick = Date.now(), mobTick = 0;
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(.2, (now - lastTick) / 1000);
  lastTick = now;
  time += dt;
  weatherT -= dt;
  if (weatherT <= 0) {
    weather = weather ? 0 : 1;
    weatherT = weather ? 90 + Math.random() * 260 : 300 + Math.random() * 700;
    broadcast({ t: 'weather', weather });
  }
  updateMobs(dt);
  // 位置は「その人の近くにいるものだけ」送る。人が散らばるほど通信が軽くなる。
  mobTick++;
  const all = [...players.values()];
  const mobList = [...mobs.values()];
  for (const p of all) {
    const near = [];
    for (const o of all) {
      if (o.id === p.id) continue;
      if (Math.abs(o.x - p.x) > 150 || Math.abs(o.z - p.z) > 150) continue;
      near.push([o.id, +o.x.toFixed(1), +o.y.toFixed(1), +o.z.toFixed(1), +o.yaw.toFixed(2), +o.pitch.toFixed(2), o.f, o.h, o.hp]);
    }
    if (near.length) p.sock.send(JSON.stringify({ t: 'players', a: near }));
    if (mobTick % 2) continue;                       // 生き物は 5Hz
    const nm = [];
    for (const m of mobList) {
      if (Math.abs(m.x - p.x) > 72 || Math.abs(m.z - p.z) > 72) continue;
      nm.push([m.id, +m.x.toFixed(1), +m.y.toFixed(1), +m.z.toFixed(1), +m.angle.toFixed(2), m.walkingNow ? 1 : 0, m.fuse > 0 ? 1 : 0]);
    }
    p.sock.send(JSON.stringify({ t: 'mobs', a: nm }));
  }
}, 100);

setInterval(() => {
  broadcast({ t: 'time', time: +time.toFixed(1), weather });
  // 名簿。あとから来た人にも名前が行き渡るように定期的に送る。
  if (players.size) broadcast({ t: 'roster', a: [...players.values()].map(p => [p.id, p.name]) });
}, 5000);
setInterval(() => {                                  // 応答のない接続を切る
  for (const p of players.values()) {
    if (Date.now() - p.last > 40000) { p.sock.close(); continue; }
    p.sock.ping();
  }
}, 15000);

// --- クラスコード -------------------------------------------------------------
// 同じ Wi-Fi なら LAN のコード、離れていればトンネルのコードで合流できる。
const lanIPs = Object.values(os.networkInterfaces()).flat()
  .filter(n => n && n.family === 'IPv4' && !n.internal).map(n => n.address);
const info = { lan: lanIPs.map(ip => ({ ip, code: encodeLan(ip, PORT) })).filter(v => v.code), net: null, url: null, max: MAX_PLAYERS };
const useTunnel = !process.argv.includes('--no-tunnel') && process.env.BLOCKWILD_TUNNEL !== '0';

function startTunnel() {
  const args = ['tunnel', '--url', 'http://localhost:' + PORT, '--no-autoupdate'];
  const tries = [['cloudflared', args], ['npx', ['--yes', 'cloudflared@latest', ...args]]];
  let i = 0;
  const attempt = () => {
    if (i >= tries.length) {
      console.log('  （インターネット越しのコードは出せませんでした）');
      console.log('   同じ Wi-Fi の友達は上のコードで遊べます。');
      console.log('   離れた友達とつなぐときは、別のウィンドウでこれを実行して、');
      console.log('   出てきた https:// のアドレスをそのままクラスコード欄に貼ってください：');
      console.log('     npx --yes cloudflared@latest tunnel --url http://localhost:' + PORT + '\n');
      return;
    }
    const [cmd, a] = tries[i++];
    let proc;
    try { proc = spawn(cmd, a, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' }); }
    catch { attempt(); return; }
    let done = false;
    const scan = buf => {
      const url = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (!url || done) return;
      done = true;
      info.url = url[0];
      info.net = codeFromTunnel(url[0]);
      console.log('\n  ★ 遠くの友達もこのコードで入れます： ' + pretty(info.net));
      console.log('     （そのまま開くなら ' + info.url + ' ）\n');
    };
    proc.stdout.on('data', scan);
    proc.stderr.on('data', scan);
    proc.on('error', () => { if (!done) attempt(); });
    proc.on('exit', () => { if (!done) attempt(); else { info.net = null; info.url = null; console.log('  トンネルが切れました。もう一度つなぎ直しています…'); startTunnel(); } });
    process.on('exit', () => { try { proc.kill(); } catch { /* もう終わっている */ } });
  };
  console.log('  インターネット越しのコードを用意しています…（初回は少し待ちます）');
  attempt();
}

// --- 静的配信 ------------------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/api/info') {                      // ホストの画面にコードを出すため
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ...info, players: players.size, seed }));
    return;
  }
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, path.normalize(p).replace(/^([/\\])+/, ''));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('見つかりません'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
});
attach(server, '/ws', onJoin);

server.listen(PORT, () => {
  console.log('\n  BLOCKWILD サーバーが動いています（最大 ' + MAX_PLAYERS + ' 人）');
  console.log('  自分：            http://localhost:' + PORT);
  for (const v of info.lan) {
    console.log('  同じWi-Fiの友達：  http://' + v.ip + ':' + PORT + '   クラスコード ' + pretty(v.code));
  }
  console.log('');
  if (useTunnel) startTunnel();
  else console.log('  （--no-tunnel を外すと、遠くの友達用のコードも出せます）\n');
  console.log('  止めるときは Ctrl+C\n');
});
