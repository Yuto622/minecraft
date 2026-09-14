// ws.js — 依存パッケージなしの WebSocket サーバー（RFC 6455 の必要な部分だけ）
// npm install を不要にするため、ハンドシェイクとフレームの組み立てを自前で行う。
import crypto from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export class Socket {
  constructor(raw) {
    this.raw = raw;
    this.open = true;
    this.buf = Buffer.alloc(0);
    this.frag = null;          // 分割されたメッセージの組み立て中バッファ
    this.fragOp = 0;
    this.alive = true;
    this.onmessage = null;     // (data: string | Buffer) => void
    this.onclose = null;
    raw.on('data', d => this._feed(d));
    raw.on('close', () => this._closed());
    raw.on('error', () => this._closed());
    raw.setNoDelay(true);
  }

  _closed() {
    if (!this.open) return;
    this.open = false;
    this.onclose?.();
  }

  _feed(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      const frame = this._read();
      if (!frame) break;
      const { op, payload, fin } = frame;
      if (op === 0x8) { this.close(); return; }          // close
      if (op === 0x9) { this._send(0xA, payload); continue; }  // ping → pong
      if (op === 0xA) { this.alive = true; continue; }         // pong
      if (op === 0x0) {                                   // 続き
        if (!this.frag) continue;
        this.frag = Buffer.concat([this.frag, payload]);
      } else {
        this.frag = payload;
        this.fragOp = op;
      }
      if (!fin) continue;
      const data = this.frag;
      const o = this.fragOp;
      this.frag = null;
      try { this.onmessage?.(o === 0x1 ? data.toString('utf8') : data); }
      catch (e) { console.error('[ws] handler error:', e.message); }
    }
  }

  _read() {
    const b = this.buf;
    if (b.length < 2) return null;
    const fin = (b[0] & 0x80) !== 0;
    const op = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let pos = 2;
    if (len === 126) {
      if (b.length < pos + 2) return null;
      len = b.readUInt16BE(pos); pos += 2;
    } else if (len === 127) {
      if (b.length < pos + 8) return null;
      const big = b.readBigUInt64BE(pos);
      if (big > 64n * 1024n * 1024n) { this.close(); return null; }
      len = Number(big); pos += 8;
    }
    let mask = null;
    if (masked) {
      if (b.length < pos + 4) return null;
      mask = b.subarray(pos, pos + 4); pos += 4;
    }
    if (b.length < pos + len) return null;
    const payload = Buffer.from(b.subarray(pos, pos + len));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    this.buf = b.subarray(pos + len);
    return { fin, op, payload };
  }

  _send(op, payload) {
    if (!this.open) return;
    const len = payload.length;
    let head;
    if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
    else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    head[0] = 0x80 | op;
    try { this.raw.write(Buffer.concat([head, payload])); } catch { this._closed(); }
  }

  send(data) {
    if (typeof data === 'string') this._send(0x1, Buffer.from(data, 'utf8'));
    else this._send(0x2, Buffer.from(data));
  }
  ping() { this.alive = false; this._send(0x9, Buffer.alloc(0)); }
  close() {
    if (!this.open) return;
    this._send(0x8, Buffer.alloc(0));
    try { this.raw.end(); } catch { /* すでに閉じている */ }
    this._closed();
  }
}

// HTTP サーバーの upgrade を受けて WebSocket にする
export function attach(server, path, onConnection) {
  server.on('upgrade', (req, socket) => {
    if (path && new URL(req.url, 'http://x').pathname !== path) { socket.destroy(); return; }
    const key = req.headers['sec-websocket-key'];
    if (!key) { socket.destroy(); return; }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    onConnection(new Socket(socket), req);
  });
}
