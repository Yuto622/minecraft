// save.js — ランレングス圧縮してローカル保存／ファイル書き出し
import { voxels, W, H } from './world.js';

const KEY = 'blockwild-v2';

function rle(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const v = src[i]; let n = 1;
    while (i + n < src.length && src[i + n] === v && n < 0xffffff) n++;
    out.push(v);
    // 可変長で個数を書く
    let c = n;
    do { const b = c & 127; c >>>= 7; out.push(c ? (b | 128) : b); } while (c);
    i += n;
  }
  return Uint8Array.from(out);
}
function unrle(src, len) {
  const out = new Uint8Array(len);
  let i = 0, o = 0;
  while (i < src.length && o < len) {
    const v = src[i++];
    let n = 0, shift = 0, b;
    do { b = src[i++]; n |= (b & 127) << shift; shift += 7; } while (b & 128);
    out.fill(v, o, Math.min(len, o + n));
    o += n;
  }
  return out;
}
function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return btoa(s);
}
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export function snapshot(state) {
  return { v: 2, w: W, h: H, at: Date.now(), state, world: b64(rle(voxels)) };
}
export function applySnapshot(data) {
  if (!data || data.v !== 2 || data.w !== W || data.h !== H) throw new Error('bad save');
  voxels.set(unrle(unb64(data.world), voxels.length));
  return data.state;
}

export function saveLocal(state) {
  const json = JSON.stringify(snapshot(state));
  localStorage.setItem(KEY, json);
  return json.length;
}
export function loadLocal() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  return applySnapshot(JSON.parse(raw));
}
export function hasLocal() { return !!localStorage.getItem(KEY); }
export function savedAt() {
  try { return new Date(JSON.parse(localStorage.getItem(KEY)).at); } catch { return null; }
}

export function exportFile(state) {
  const blob = new Blob([JSON.stringify(snapshot(state))], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `blockwild-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
export function importFile() {
  return new Promise((res, rej) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'application/json,.json';
    inp.onchange = () => {
      const f = inp.files?.[0];
      if (!f) return rej(new Error('no file'));
      const r = new FileReader();
      r.onload = () => { try { res(applySnapshot(JSON.parse(r.result))); } catch (e) { rej(e); } };
      r.onerror = () => rej(r.error);
      r.readAsText(f);
    };
    inp.click();
  });
}
