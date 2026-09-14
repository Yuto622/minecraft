// net.js — マルチプレイの通信
// サーバーとは JSON でやりとりし、世界の差分だけバイナリで受け取る。
export class Net {
  constructor() {
    this.ws = null;
    this.id = 0;
    this.connected = false;
    this.name = '';
    this.players = new Map();     // id -> {id,name,x,y,z,yaw,pitch,f,h,hp, tx,ty,tz,tyaw}
    this.on = {};                 // イベント名 -> 関数
    this.pending = null;          // welcome 前に届いた差分
    this.lastSent = 0;
  }

  // 同じサーバーから配信されていれば、その場所へつなぐ
  static defaultURL() {
    const l = location;
    if (l.protocol === 'file:') return 'ws://localhost:8080/ws';
    return (l.protocol === 'https:' ? 'wss://' : 'ws://') + l.host + '/ws';
  }

  connect(url, name) {
    this.close();
    this.name = name;
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(url); } catch (e) { reject(e); return; }
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      const timer = setTimeout(() => { reject(new Error('timeout')); ws.close(); }, 12000);

      ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name }));
      ws.onerror = () => { clearTimeout(timer); reject(new Error('つながりませんでした')); };
      ws.onclose = () => {
        clearTimeout(timer);
        const was = this.connected;
        this.connected = false;
        this.players.clear();
        if (was) this.on.close?.();
        else reject(new Error('つながりませんでした'));
      };
      ws.onmessage = ev => {
        if (typeof ev.data !== 'string') { this.pending = new Uint8Array(ev.data); return; }
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'full') { clearTimeout(timer); reject(new Error('満員です')); return; }
        if (m.t === 'welcome') {
          clearTimeout(timer);
          this.id = m.id;
          this.connected = true;
          m.delta = this.pending;
          this.pending = null;
          for (const p of m.players) this.players.set(p.id, { ...p, tx: p.x, ty: p.y, tz: p.z, tyaw: 0 });
          resolve(m);
          return;
        }
        this._handle(m);
      };
    });
  }

  _handle(m) {
    switch (m.t) {
      case 'players':
        for (const [id, x, y, z, yaw, pitch, f, h, hp] of m.a) {
          if (id === this.id) continue;
          let p = this.players.get(id);
          if (!p) { p = { id, name: '…', x, y, z, tyaw: yaw }; this.players.set(id, p); }
          p.tx = x; p.ty = y; p.tz = z; p.tyaw = yaw; p.pitch = pitch; p.f = f; p.h = h; p.hp = hp;
          if (p.x === undefined) { p.x = x; p.y = y; p.z = z; }
        }
        break;
      case 'roster':
        for (const [id, name] of m.a) {
          if (id === this.id) continue;
          const p = this.players.get(id);
          if (p) p.name = name;
          else this.players.set(id, { id, name, x: 0, y: -99, z: 0, tx: 0, ty: -99, tz: 0, tyaw: 0 });
        }
        for (const id of [...this.players.keys()]) if (!m.a.some(r => r[0] === id)) this.players.delete(id);
        this.on.roster?.(m);
        break;
      case 'join':
        this.players.set(m.id, { id: m.id, name: m.name, x: 0, y: -99, z: 0, tx: 0, ty: -99, tz: 0, tyaw: 0 });
        this.on.sys?.(m.name + ' が参加した');
        break;
      case 'leave':
        this.players.delete(m.id);
        this.on.leave?.(m.id);
        break;
      default:
        this.on[m.t]?.(m);
    }
  }

  send(obj) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(obj)); }

  sendPos(p, held, hp, flags, now) {
    if (!this.connected || now - this.lastSent < 90) return;
    this.lastSent = now;
    this.send({ t: 'pos', x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), yaw: +p.yaw.toFixed(2), pitch: +p.pitch.toFixed(2), f: flags, h: held, hp });
  }

  close() {
    if (this.ws) { this.ws.onclose = null; try { this.ws.close(); } catch { /* 既に閉じている */ } }
    this.ws = null;
    this.connected = false;
    this.players.clear();
  }
}
