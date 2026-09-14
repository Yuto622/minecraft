// code.js — クラスコード
// 「どこにつなぐか」を短い文字列にしまう。数字の 0/1 と紛らわしい O/I などは使わない。
// 例）A7K3Q        … 同じ Wi-Fi のホスト（192.168.0.5:8080）
//     PLANTS-SHOOT-MAD-REFUSE … インターネット越しのホスト（トンネル）
const ALPHA = '23456789ABCDEFGHJKMNPQRSTVWXYZ';   // 30文字（紛らわしい 0 1 I L O U を除く）
const B = ALPHA.length;

const toNum = bytes => bytes.reduce((a, v) => a * 256 + v, 0);
function toCode(bytes) {
  let n = toNum(bytes), s = '';
  const len = Math.ceil(bytes.length * 8 / Math.log2(B));
  for (let i = 0; i < len; i++) { s = ALPHA[n % B] + s; n = Math.floor(n / B); }
  return s;
}
function fromCode(code, len) {
  let n = 0;
  for (const ch of code) {
    const i = ALPHA.indexOf(ch);
    if (i < 0) return null;
    n = n * B + i;
  }
  const out = new Array(len);
  for (let i = len - 1; i >= 0; i--) { out[i] = n % 256; n = Math.floor(n / 256); }
  return out;
}

const DEFAULT_PORT = 8080;

// IPv4 とポートからコードを作る
export function encodeLan(ip, port = DEFAULT_PORT) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(v => !(v >= 0 && v <= 255))) return null;
  let head, body;
  if (p[0] === 192 && p[1] === 168) { head = 1; body = [p[2], p[3]]; }
  else if (p[0] === 10) { head = 2; body = [p[1], p[2], p[3]]; }
  else if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) { head = 3; body = [p[1] - 16, p[2], p[3]]; }
  else { head = 4; body = p; }
  const extra = port === DEFAULT_PORT ? [] : [port >> 8, port & 255];
  const bytes = [head * 2 + (extra.length ? 1 : 0), ...body, ...extra];
  return toCode(bytes);
}

const BODY_LEN = { 1: 2, 2: 3, 3: 3, 4: 4 };

// コードを WebSocket のアドレスに戻す
export function decodeCode(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^wss?:\/\//i.test(s)) return s.replace(/\/+$/, '') + (/\/ws$/i.test(s) ? '' : '/ws');
  if (/^https?:\/\//i.test(s)) {
    const u = new URL(s);
    return (u.protocol === 'https:' ? 'wss://' : 'ws://') + u.host + '/ws';
  }
  const clean = s.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const words = clean.split('-').filter(Boolean);
  // 単語がハイフンで3つ以上並んでいたら、インターネット越しのホスト
  if (words.length >= 3 && words.every(w => /^[A-Z]+$/.test(w))) {
    return 'wss://' + words.join('-').toLowerCase() + '.trycloudflare.com/ws';
  }
  const body = clean.replace(/-/g, '');
  for (const head of [1, 2, 3, 4]) for (const withPort of [0, 1]) {
    const len = 1 + BODY_LEN[head] + withPort * 2;
    const expect = Math.ceil(len * 8 / Math.log2(B));
    if (body.length !== expect) continue;
    const bytes = fromCode(body, len);
    if (!bytes || bytes[0] !== head * 2 + withPort) continue;
    const b = bytes.slice(1);
    let ip;
    if (head === 1) ip = '192.168.' + b[0] + '.' + b[1];
    else if (head === 2) ip = '10.' + b[0] + '.' + b[1] + '.' + b[2];
    else if (head === 3) ip = '172.' + (b[0] + 16) + '.' + b[1] + '.' + b[2];
    else ip = b.slice(0, 4).join('.');
    const port = withPort ? (b[b.length - 2] << 8) | b[b.length - 1] : DEFAULT_PORT;
    return 'ws://' + ip + ':' + port + '/ws';
  }
  return null;
}

// トンネルのアドレスからクラスコードを作る
export function codeFromTunnel(url) {
  const m = String(url).match(/https?:\/\/([a-z0-9-]+)\.trycloudflare\.com/i);
  return m ? m[1].toUpperCase() : null;
}

// 見やすく 4 文字ずつに区切る（単語のコードはそのまま）
export function pretty(code) {
  if (!code) return '';
  if (code.includes('-')) return code;
  return code.replace(/(.{4})(?=.)/g, '$1-');
}
