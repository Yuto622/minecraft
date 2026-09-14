// audio.js — WebAudio による手続き効果音（音声ファイル不要）
let ctx = null, master = null, noiseBuf = null, musicGain = null, ambGain = null, rainGain = null;

function init() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = .5; master.connect(ctx.destination);
  musicGain = ctx.createGain(); musicGain.gain.value = .3; musicGain.connect(master);
  ambGain = ctx.createGain(); ambGain.gain.value = 0; ambGain.connect(master);
  const len = ctx.sampleRate * 1.2;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  // 風のアンビエンス
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380; f.Q.value = .4;
  const lfo = ctx.createOscillator(); lfo.frequency.value = .07;
  const lfoG = ctx.createGain(); lfoG.gain.value = 160;
  lfo.connect(lfoG); lfoG.connect(f.frequency);
  src.connect(f); f.connect(ambGain); src.start(); lfo.start();
  return ctx;
}
export function resume() { init(); if (ctx?.state === 'suspended') ctx.resume(); }
export function setVolume(v) { init(); if (master) master.gain.value = v; }
export function ambience(level) { if (ambGain && ctx) ambGain.gain.setTargetAtTime(level * .09, ctx.currentTime, .8); }

function env(node, vol, attack, decay) {
  const g = ctx.createGain(), t = ctx.currentTime;
  g.gain.setValueAtTime(.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(.0002, vol), t + attack);
  g.gain.exponentialRampToValueAtTime(.0001, t + attack + decay);
  node.connect(g); g.connect(master);
  return { g, t, stop: t + attack + decay + .02 };
}
function noise(vol, dur, freq, type = 'lowpass', q = 1) {
  if (!init()) return;
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  s.playbackRate.value = .7 + Math.random() * .6;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  s.connect(f);
  const e = env(f, vol, .008, dur);
  s.start(e.t); s.stop(e.stop);
}
function tone(freq, dur, vol = .12, type = 'triangle', slide = 0) {
  if (!init()) return;
  const o = ctx.createOscillator(); o.type = type;
  const t = ctx.currentTime;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
  const e = env(o, vol, .01, dur);
  o.start(e.t); o.stop(e.stop);
}

// 素材ごとに響きを変える
const MAT = {
  stone: { f: 900, v: .22, q: 2 }, wood: { f: 620, v: .2, q: 1.4 }, dirt: { f: 380, v: .2, q: .8 },
  sand: { f: 1600, v: .13, q: .6 }, grass: { f: 700, v: .15, q: .7 }, glass: { f: 3200, v: .2, q: 6 },
  wool: { f: 300, v: .12, q: .5 }, snow: { f: 1200, v: .1, q: .5 },
};
export function dig(mat = 'dirt') { const m = MAT[mat] || MAT.dirt; noise(m.v * .5, .07, m.f, 'bandpass', m.q); }
export function breakBlock(mat = 'dirt') {
  const m = MAT[mat] || MAT.dirt;
  noise(m.v, .22, m.f, 'bandpass', m.q);
  if (mat === 'glass') { tone(2600, .18, .09, 'square', .4); tone(3300, .12, .06, 'square', .5); }
  else tone(m.f * .35, .12, .05, 'sine', .6);
}
export function place(mat = 'dirt') { const m = MAT[mat] || MAT.dirt; noise(m.v * .8, .12, m.f * .8, 'lowpass', .9); tone(m.f * .2, .08, .05, 'sine', .7); }
export function step(mat = 'grass') { const m = MAT[mat] || MAT.grass; noise(m.v * .32, .06, m.f * 1.1, 'bandpass', 1.2); }
export function hurt() { tone(320, .28, .18, 'sawtooth', .45); noise(.1, .16, 500, 'bandpass', 1.5); }
export function craft() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, .16, .09, 'triangle'), i * 60)); }
export function pickup() { tone(880, .09, .07); setTimeout(() => tone(1320, .1, .06), 55); }
export function splash() { noise(.22, .4, 900, 'lowpass', .7); }
export function hit() { noise(.2, .1, 260, 'lowpass', 1.2); tone(180, .1, .1, 'square', .5); }
export function mob(type) {
  const base = { pig: 380, cow: 180, sheep: 520, chicken: 900, zombie: 120, villager: 240, creeper: 500, skeleton: 700 }[type] || 400;
  tone(base, .3, .08, type === 'zombie' ? 'sawtooth' : 'triangle', type === 'zombie' ? .6 : 1.35);
}
export function fuse() { tone(1200, .5, .1, 'square', .35); noise(.09, .5, 2400, 'bandpass', 3); }
export function explode() {
  noise(.5, .9, 180, 'lowpass', .6);
  noise(.35, .35, 900, 'bandpass', .8);
  tone(70, .8, .3, 'sawtooth', .35);
}
export function rain(level) {
  if (!init()) return;
  if (!rainGain) {
    rainGain = ctx.createGain(); rainGain.gain.value = 0; rainGain.connect(master);
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1100;
    s.connect(f); f.connect(rainGain); s.start();
  }
  rainGain.gain.setTargetAtTime(level * .13, ctx.currentTime, 1.5);
}
export function bow(power) { tone(300 + power * 260, .22, .1, 'triangle', 2.1); noise(.08, .12, 1800, 'bandpass', 2); }
export function ui(up = true) { tone(up ? 660 : 440, .07, .05, 'sine'); }

// --- BGM --------------------------------------------------------------------
// 本家のような「間のある、ゆっくりした」音楽を手続きで生成する。
// 決まった曲ではなく、音階から少しずつ選んで置いていく。
let musicOn = false, musicTimer = null, pieceEnd = 0;
const SCALES = [
  [0, 2, 4, 7, 9, 12, 14, 16, 19],        // メジャー・ペンタトニック
  [0, 2, 3, 5, 7, 10, 12, 14, 15],        // ドリアン
  [0, 2, 4, 5, 7, 9, 11, 12, 16],         // イオニアン
];
let scale = SCALES[0], root = 261.63;

function piano(freq, when, dur, vol) {
  if (!ctx) return;
  const g = ctx.createGain();
  g.gain.setValueAtTime(.0001, when);
  g.gain.exponentialRampToValueAtTime(vol, when + .04);
  g.gain.exponentialRampToValueAtTime(vol * .32, when + dur * .35);
  g.gain.exponentialRampToValueAtTime(.0001, when + dur);
  g.connect(musicGain);
  // 基音と、少しずれた倍音を重ねて柔らかい音に
  for (const [mult, level, type] of [[1, 1, 'sine'], [2, .28, 'sine'], [3, .12, 'triangle']]) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq * mult * (1 + (Math.random() - .5) * .002), when);
    const og = ctx.createGain();
    og.gain.value = level;
    o.connect(og); og.connect(g);
    o.start(when); o.stop(when + dur + .05);
  }
}

function scheduleNote() {
  if (!musicOn || !ctx) return;
  const now = ctx.currentTime;
  if (now > pieceEnd) {                       // 1曲おわり。しばらく静かにする
    musicTimer = setTimeout(scheduleNote, (90 + Math.random() * 180) * 1000);
    scale = SCALES[(Math.random() * SCALES.length) | 0];
    root = [196, 220, 261.63, 293.66][(Math.random() * 4) | 0];
    pieceEnd = now + 70 + Math.random() * 60 + (90 + Math.random() * 180);
    return;
  }
  const step = scale[(Math.random() * scale.length) | 0];
  const oct = Math.random() < .25 ? 2 : 1;
  const f = root * Math.pow(2, step / 12) * oct;
  const dur = 2.2 + Math.random() * 2.6;
  piano(f, now + .05, dur, .16);
  if (Math.random() < .35) {                  // ときどき重ねる
    const s2 = scale[(Math.random() * scale.length) | 0];
    piano(root * Math.pow(2, s2 / 12) * (oct === 2 ? 1 : 2), now + .05 + Math.random() * .4, dur * .8, .09);
  }
  const gap = 1.4 + Math.random() * 3.2;
  musicTimer = setTimeout(scheduleNote, gap * 1000);
}

export function music(on) {
  init();
  if (on === musicOn) return;
  musicOn = on;
  clearTimeout(musicTimer);
  if (!on) return;
  pieceEnd = (ctx?.currentTime || 0) + 70 + Math.random() * 60;
  musicTimer = setTimeout(scheduleNote, (12 + Math.random() * 30) * 1000);
}
export function musicVolume(v) { init(); if (musicGain) musicGain.gain.value = v * .5; }
