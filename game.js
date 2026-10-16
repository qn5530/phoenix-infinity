'use strict';
/* PHOENIX ∞ — a calculator shooter that evolves from 1-bit TI-style Phoenix to full bullet hell.
   One file: engine, renderers (low-res LCD + hi-res vector), audio, input, trailer director. */

// ================= core =================
const W = 384, H = 256, TAU = Math.PI * 2, PI2 = Math.PI / 2, UP = -PI2;
const SW = 960, SH = 640, S = SW / W; // display canvas and world->display scale
let seed = 1;
function rnd() { seed = (seed + 0x6D2B79F5) | 0; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }
const rr = (a, b) => a + (b - a) * rnd();
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, k) => a + (b - a) * k;
const hsl = h => { // quantized hue -> #rrggbb (bullet sprites are cached per colour)
  h = ((Math.round(h / 15) * 15) % 360 + 360) % 360;
  const f = n => { const k = (n + h / 30) % 12, v = 0.62 - 0.38 * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(v * 255).toString(16).padStart(2, '0'); };
  return '#' + f(0) + f(8) + f(4);
};

const ERAS = [
  { name: 'PX-83', model: 'PHOENIX EDITION', sub: '96x64 MONOCHROME', res: [96, 64], hit: 6, spd: 2.4, dmg: 1 },
  { name: 'PX-84 CE', model: 'COLOR EDITION', sub: '192x128 COLOR', res: [192, 128], hit: 5, spd: 2.7, dmg: 1.6 },
  { name: 'PX-9000', model: 'NEON VECTOR', sub: 'VECTOR GLOW ENGINE', res: null, hit: 3.5, spd: 3.1, dmg: 2.8 },
  { name: 'PX-∞', model: '限界突破 · LIMIT BREAK', sub: 'LIMIT BREAK', res: null, hit: 2.2, spd: 3.4, dmg: 4.5 },
];
const DRIVERS = ['', 'INSTALLING COLOR.8XK', 'LOADING NEON.DRV', 'UNLOCKING ∞.SYS'];

// ===== tuning knobs (override in mods.js, or via URL: ?level=7&god=1&speed=1.5&money=9999) =====
const TUNE = {
  speed: 1,             // game speed multiplier
  enemyHp: 1,           // multiplier on normal enemy HP
  bossHp: 1,            // multiplier on boss HP
  playerDamage: 1,      // multiplier on all player weapons
  enemyBulletSpeed: 1,  // multiplier on enemy bullet speed
  money: 1,             // multiplier on cash earned
  waveNext: 0.3,        // next wave arrives when this fraction of the current wave is still alive
  waveTimeout: 600,     // ...or after this many frames (60 = 1s), whichever comes first
  startShields: 3,
  startMoney: 0,
  god: false,           // invincible
};
const HOOKS = { tick: [], kill: [], levelStart: [] }; // mods: HOOKS.kill.push(e => ...)

// Weapons: fire(player, damageMult, focusHeld) spawns bullets and returns the cooldown in frames.
// Flags: beam (continuous railgun), orbit (blades circle the ship). Add your own in mods.js.
const WEAPONS = [
  { id: 'single', name: 'SINGLE', cost: 0, era: 0, d: 'One shot. The 1999 classic.', fire: (p, m) => { pshot(p.x, p.y - 10, UP, 7, 1.4 * m); return 11; } },
  { id: 'double', name: 'DOUBLE', cost: 120, era: 0, d: 'Two parallel shots.', fire: (p, m) => { for (const s of [-5, 5]) pshot(p.x + s, p.y - 8, UP, 7, 1.1 * m); return 11; } },
  { id: 'triple', name: 'TRIPLE', cost: 300, era: 0, d: 'Three-way spread.', fire: (p, m, f) => { const s = f ? 0.06 : 0.22; for (let i = -1; i <= 1; i++) pshot(p.x, p.y - 10, UP + i * s, 7, m); return 13; } },
  { id: 'laser', name: 'LASER', cost: 600, era: 0, d: 'Piercing bolt.', fire: (p, m) => { pshot(p.x, p.y - 14, UP, 9, 1.6 * m, { k: 'laser', pierce: 1, hits: [] }); return 16; } },
  { id: 'wide', name: 'WIDE-5', cost: 1000, era: 0, d: 'Five-way fan.', fire: (p, m, f) => { const s = f ? 0.08 : 0.18; for (let i = -2; i <= 2; i++) pshot(p.x, p.y - 10, UP + i * s, 7, 0.9 * m); return 15; } },
  { id: 'homing', name: 'HOMING Σ', cost: 1500, era: 1, d: 'Missiles that seek targets.', color: '#b28cff',
    fire: (p, m) => { pshot(p.x, p.y - 10, UP, 7, m); for (const s of [-1, 1]) pshot(p.x + s * 8, p.y, UP + s * 0.9, 3.5, 1.6 * m, { k: 'missile', home: 0.12 }); return 14; } },
  { id: 'wave', name: 'SIN() WAVE', cost: 2500, era: 2, d: 'Twin sinusoidal streams.', color: '#7dfcff',
    fire: (p, m, f) => { for (const s of [-1, 1]) pshot(p.x, p.y - 10, UP, 6.5, 0.9 * m, { k: 'wave', x0: p.x, ph: s, amp: f ? 10 : 28 }); return 4; } },
  { id: 'rail', name: '∫ RAILGUN', cost: 3500, era: 2, d: 'Continuous beam. Integrates everything.', beam: 1, fire: p => { p.beam = 3; return 1; } },
  { id: 'swarm', name: 'Σ SWARM', cost: 5000, era: 3, d: 'Dozens of homing micro-missiles.', color: '#ff5fa2',
    fire: (p, m, f) => { const n = f ? 4 : 6; for (let i = 0; i < n; i++) { const s = i % 2 ? 1 : -1; pshot(p.x + s * 6, p.y, UP + s * (0.6 + rnd() * 1.2) * (f ? 0.4 : 1), 4 + rnd(), m, { k: 'missile', home: 0.18 }); } return 9; } },
  { id: 'orbit', name: 'π ORBIT', cost: 6000, era: 3, d: 'Orbiting blades eat bullets + radial bursts.', color: '#ffd24a', orbit: 1,
    fire: (p, m, f) => { const n = f ? 6 : 12; for (let i = 0; i < n; i++) pshot(p.x, p.y, UP + (i - (n - 1) / 2) * (f ? 0.08 : 0.26), 6, 0.8 * m, { k: 'orb' }); return 16; } },
];
const wpn = () => WEAPONS.find(w => w.id === G.weapon) || WEAPONS[0];
const SPELLS = [
  ['数符「テイラー展開の花」', 'Sign: Taylor Series Bloom'],
  ['螺旋「黄金比フィボナッチ」', 'Spiral: Golden Fibonacci'],
  ['禁忌「ゼロ除算」', 'Taboo: Divide by Zero'],
  ['終符「ERR:OVERFLOW ∞」', 'Final: ERR:OVERFLOW'],
];

const G = {
  state: 'title', era: 0, level: 0, frame: 0, lt: 0, money: 0, score: 0, hi: 0,
  owned: { single: 1 }, weapon: 'single', power: 1, rapid: 0, bombs: 0,
  p: { x: W / 2, y: H - 30, hp: 3, maxhp: 3, inv: 0, cd: 0, beam: 0, dead: 0, tilt: 0, hold: 0, burst: 0, laser: 0, lend: 0 },
  combo: 0, comboT: 0, hg: 0, hstock: 0, hyper: 0, auto: '', // DoDonPachi-style chain + hyper (era 3)
  pb: [], eb: [], en: [], parts: [], items: [], fx: [], lz: [], orbs: [],
  phase: 'waves', wave: 0, waveT: 0, warnT: 0, clearT: 0, dieT: 0, bossMax: 1,
  shake: 0, flash: 0, slow: 0, bombT: 0, bx: 0, by: 0, graze: 0,
  menu: 0, scroll: 0, titleLvl: 1, upT: 0, upTo: 0, banner: null, msg: null,
  god: false, trailer: false, refill: null, refillN: 0,
};
const I = { left: 0, right: 0, up: 0, down: 0, fire: 0, focus: 0 };
try { G.hi = +localStorage.getItem('phx_hi') || 0; } catch (e) { }
const D = () => 1 + G.level * 0.06;

// ================= sprites (1-bit bitmaps for eras 0/1) =================
const SPR = {};
function bits(name, rows) { const w = Math.max(...rows.map(r => r.length)); SPR[name] = { w, h: rows.length, rows: rows.map(r => r.padEnd(w, '.')) }; }
bits('ship0', ['....#....', '....#....', '...###...', '..#####..', '.##.#.##.', '#########', '#.#...#.#']);
bits('drone', ['..#..#..', '...##...', '.######.', '##.##.##', '########', '.#....#.']);
bits('drone2', ['..#..#..', '...##...', '.######.', '##.##.##', '########', '#......#']);
bits('diver', ['#.....#', '##...##', '#######', '#.###.#', '.#####.', '..#.#..', '...#...']);
bits('tank', ['...###...', '..#####..', '#########', '##.#.#.##', '#########', '.#.#.#.#.']);
bits('mother', ['..........####..........', '......############......', '....################....', '..####################..',
  '.##..##..##..##..##..##.', '########################', '########################', '.#####.#####.#####.####.', '..##....##....##....##..', '...#.....#.....#.....#..']);
bits('ship1', ['......#......', '.....###.....', '.....#.#.....', '....##.##....', '...#######...', '.#.##.#.##.#.', '#############', '###.##.##.###', '#..#.....#..#', '...#.....#...']);
bits('saucer', ['....####....', '..########..', '.##.##.##.##', '############', '..##....##..', '...#....#...']);
bits('splitter', ['....#....', '...###...', '..##.##..', '.##.#.##.', '##.###.##', '.##.#.##.', '..##.##..', '...###...', '....#....']);
bits('mini', ['.#.#.', '#####', '.###.', '#.#.#', '..#..']);
bits('turret', ['...####...', '..#....#..', '.#.####.#.', '#.#....#.#', '#.#.##.#.#', '#.#.##.#.#', '#.#....#.#', '.#.####.#.', '..#....#..', '...####...']);
bits('divider', ['...######......######...', '..########....########..', '.###.##.###..###.##.###.', '############..##########', '#####....###..###....###',
  '############..##########', '.##########....########.', '..#.#.#.#........#.#.#..', '..#.#.#.#........#.#.#..', '...#...#..........#...#.']);
bits('divhalf', ['...######..', '..########.', '.###.##.###', '###########', '#####....##', '###########', '.##########', '..#.#.#.#..', '...#...#...']);

const SC = {};
function sprImg(name, main, hi) {
  const key = name + main + hi; if (SC[key]) return SC[key];
  const s = SPR[name], cv = document.createElement('canvas'); cv.width = s.w; cv.height = s.h;
  const g = cv.getContext('2d');
  s.rows.forEach((row, y) => { for (let x = 0; x < s.w; x++) if (row[x] === '#') { g.fillStyle = y < s.h * 0.34 ? hi : main; g.fillRect(x, y, 1, 1); } });
  return (SC[key] = cv);
}

// 3x5 calculator font
const F3 = {}; ('0:111101101101111 1:010110010010111 2:111001111100111 3:111001111001111 4:101101111001001 5:111100111001111 6:111100111101111 7:111001010010010 ' +
  '8:111101111101111 9:111101111001111 A:010101111101101 B:110101110101110 C:011100100100011 D:110101101101110 E:111100110100111 F:111100110100100 G:011100101101011 ' +
  'H:101101111101101 I:111010010010111 J:001001001101010 K:101101110101101 L:100100100100111 M:101111111101101 N:110101101101101 O:010101101101010 P:110101110100100 ' +
  'Q:010101101110011 R:110101110101101 S:011100010001110 T:111010010010010 U:101101101101111 V:101101101101010 W:101101111111101 X:101101010101101 Y:101101010010010 ' +
  'Z:111001010100111 $:010110010011010 ::000010000010000 .:000000000000010 -:000000111000000 !:010010010000010 >:100010001010100 <:001010100010001 /:001001010100100 ' +
  '%:101001010100101 +:000010111010000 =:000111000111000 ?:111001010000010 Σ:111100010100111 π:000111101101101 ∫:011010010010110 ∞:000111101111000 ÷:010000111000010 ' +
  '(:010100100100010 ):010001001001010 *:000101010101000 ,:000000000010100 \':010010000000000').split(' ').forEach(s => { F3[s[0]] = s.slice(2); });
function txt3(c, s, x, y, col, sc = 1) {
  c.fillStyle = col; x = Math.round(x); y = Math.round(y);
  for (const ch of String(s).toUpperCase()) { const g = F3[ch]; if (g) for (let i = 0; i < 15; i++) if (g[i] === '1') c.fillRect(x + (i % 3) * sc, y + ((i / 3) | 0) * sc, sc, sc); x += 4 * sc; }
}
const w3 = (s, sc = 1) => [...String(s)].length * 4 * sc - sc;

// ================= enemy types =================
const T = {
  drone: { hp: 1, r: 13, sc: 10, $: 5, ai: 'form', spr: ['drone', 'drone2'], ps: 4,
    fire(e) { if (rnd() < 0.003 * D()) shot(e.x, e.y + 8, PI2, 1.7, { k: 'dot', c: '#ffffff' }); } },
  diver: { hp: 2, r: 13, sc: 25, $: 10, ai: 'form', dives: 1, spr: ['diver'], ps: 4,
    fire(e) { if (e.mode === 'dive' && e.t % 45 === 20) aim(e, 2.1, 1, 0, { k: 'dot', c: '#ffffff' }); } },
  tank: { hp: 5, r: 16, sc: 50, $: 20, ai: 'form', spr: ['tank'], ps: 4,
    fire(e) { if ((e.t + e.ph) % 130 === 0) aim(e, 2, 2, 0.18, { k: 'orb', c: '#ffffff' }); } },
  mother: { hp: 140, r: 38, sc: 2000, $: 400, ai: 'boss', boss: 'MOTHERSHIP', spr: ['mother'], ps: 4, upd: upMother },
  saucer: { hp: 3, r: 11, sc: 30, $: 12, ai: 'path', spr: ['saucer'], ps: 2, col: ['#ff4fd8', '#ffd6f5'],
    fire(e) { if ((e.t + e.ph) % 90 === 0) aim(e, 2.3, 3, 0.22, { k: 'orb', c: '#ff4fd8' }); } },
  splitter: { hp: 6, r: 11, sc: 40, $: 16, ai: 'form', spr: ['splitter'], ps: 2, col: ['#ffd23a', '#fff6c0'],
    fire(e) { if ((e.t + e.ph) % 110 === 0) ring(e.x, e.y, 8, 1.5, e.t * 0.1, { k: 'dot', c: '#ffd23a' }); },
    die(e) { for (const s of [-1, 1]) { const x0 = e.x, y0 = e.y; spawn('mini', x0, y0, { path: t => [x0 + s * t * 1.3, y0 + t * 1.5 - Math.max(0, 20 - t) * 0.8] }); } } },
  mini: { hp: 1, r: 7, sc: 10, $: 4, ai: 'path', spr: ['mini'], ps: 2, col: ['#ff9a3a', '#ffe0b0'],
    fire(e) { if (e.t === 40) aim(e, 2.4, 1, 0, { k: 'dot', c: '#ff9a3a' }); } },
  turret: { hp: 16, r: 13, sc: 80, $: 30, ai: 'form', spr: ['turret'], ps: 2, col: ['#4dff8a', '#d8ffe4'],
    fire(e) { if (e.mode !== 'enter' && e.t % 22 === 0) ring(e.x, e.y, 4, 1.6, e.t * 0.04, { k: 'orb', c: '#4dff8a' }); } },
  divider: { hp: 300, r: 26, sc: 4000, $: 600, ai: 'boss', boss: 'THE DIVIDER', spr: ['divider'], ps: 2, col: ['#ff5a5a', '#ffd0d0'], upd: upDivider },
  divhalf: { hp: 200, r: 16, sc: 2500, $: 300, ai: 'boss', boss: 'THE DIVIDER', spr: ['divhalf'], ps: 2, col: ['#ff5a5a', '#ffd0d0'], upd: upHalf },
  zig: { hp: 5, r: 10, sc: 60, $: 20, ai: 'path', shape: { n: 3, c: '#29f6ff', spin: 0 },
    fire(e) { if ((e.t + e.ph) % 70 === 0) aim(e, 2.8, 1, 0, { k: 'rice', c: '#29f6ff' }); } },
  spinner: { hp: 30, r: 14, sc: 150, $: 40, ai: 'form', shape: { n: 4, c: '#ff3df2', spin: 0.05 },
    fire(e) { if (e.mode !== 'enter' && e.t % 7 === 0) for (let k = 0; k < 2; k++) shot(e.x, e.y, e.t * 0.06 + k * Math.PI, 1.9, { k: 'rice', c: '#ff3df2' }); } },
  carrier: { hp: 80, r: 20, sc: 300, $: 80, ai: 'form', shape: { n: 6, c: '#ffa53d', spin: 0.01 },
    fire(e) { if (e.t % 80 === 40) spawn('mini2', e.x, e.y + 10); if (e.t % 100 === 0) ring(e.x, e.y, 16, 1.4, e.t, { k: 'orb', c: '#ffa53d' }); } },
  mini2: { hp: 3, r: 7, sc: 20, $: 6, ai: 'chase', shape: { n: 3, c: '#ffd27a', spin: 0.15 } },
  eye: { hp: 45, r: 15, sc: 200, $: 60, ai: 'form', shape: { eye: 1, c: '#ff4060' },
    fire(e) {
      if (e.mode === 'enter') return;
      if ((e.t + e.ph) % 170 === 0) laser(e.x, e.y, Math.atan2(G.p.y - e.y, G.p.x - e.x), { w: 9, warn: 55, life: 35, owner: e, c: '#ff4060' });
      if ((e.t + e.ph) % 60 === 30) aim(e, 2.2, 3, 0.3, { k: 'dot', c: '#ff4060' });
    } },
  overflow: { hp: 1500, r: 30, sc: 20000, $: 2000, ai: 'boss', boss: 'OVERFLOW', shape: { boss2: 1, c: '#29f6ff' }, upd: upOverflow },
  swarm: { hp: 6, r: 9, sc: 80, $: 25, ai: 'path', shape: { n: 4, c: '#7dfcff', spin: 0.1 },
    fire(e) { if ((e.t + e.ph) % 80 === 0) aim(e, 2.4, 3, 0.2, { k: 'rice', c: '#7dfcff' }); } },
  seraph: { hp: 80, r: 16, sc: 500, $: 120, ai: 'form', shape: { seraph: 1, c: '#ffd24a' },
    fire(e) { if (e.mode !== 'enter' && (e.t + e.ph) % 55 === 0) { const o = rnd() * TAU; for (const tt of [-0.006, 0.006]) ring(e.x, e.y, 18, 1.5, o, { k: 'rice', c: tt > 0 ? '#ffd24a' : '#ff8a3a', turn: tt }); } } },
  bloom: { hp: 100, r: 18, sc: 700, $: 150, ai: 'form', shape: { bloom: 1, c: '#ff5fa2' },
    fire(e) { if (e.mode !== 'enter' && e.t % 10 === 0) for (let k = 0; k < 3; k++) shot(e.x, e.y, e.t * 0.037 + k * TAU / 3, 1.6, { k: 'star', c: '#ff5fa2' }); },
    die(e) { ring(e.x, e.y, 32, 1.2, 0, { k: 'orb', c: '#ff9ccc' }); ring(e.x, e.y, 32, 1.8, TAU / 64, { k: 'rice', c: '#ff5fa2' }); ring(e.x, e.y, 16, 2.6, 0, { k: 'big', c: '#ffffff' }); } },
  infinity: { hp: 1400, r: 28, sc: 100000, $: 5000, ai: 'boss', boss: '∞ INFINITY', shape: { boss3: 1, c: '#ff5fa2' }, upd: upInfinity },
};
const colorOf = e => { const t = T[e.type]; return t.shape ? t.shape.c : t.col ? t.col[0] : '#ffffff'; };

// ================= levels =================
function grid(type, cols, rows, y0 = 40, dx, dy = 26) {
  dx = dx || Math.min(46, (W - 70) / cols);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const hx = W / 2 + (c - (cols - 1) / 2) * dx, hy = y0 + r * dy;
    spawn(type, hx, -20 - r * 16, { hx, hy, delay: (r * cols + c) * 2 });
  }
}
function stream(type, n, side, y0 = 50) {
  const s = side === 'L' ? 1 : -1;
  for (let i = 0; i < n; i++) spawn(type, 0, -60, { delay: i * 14, path: t => [(s > 0 ? -20 : W + 20) + s * t * 2, y0 + Math.sin(t * 0.035) * 36 + t * 0.15] });
}
function zigs(type, n) {
  for (let i = 0; i < n; i++) { const x0 = rr(60, W - 60), p = rnd(); spawn(type, 0, -60, { delay: i * 16, path: t => [x0 + (2 * Math.abs(2 * (t * 0.012 + p - Math.floor(t * 0.012 + p + 0.5))) - 1) * 70, -20 + t * 1.3] }); }
}
function vform(type, n) {
  for (let i = 0; i < n; i++) { const off = i - (n - 1) / 2; spawn(type, 0, -60, { path: t => [W / 2 + off * 18 + Math.sin(t * 0.02) * 80, -20 - Math.abs(off) * 14 + t * 1.1] }); }
}
const LEVELS = [
  { era: 0, waves: [() => grid('drone', 6, 3), () => { grid('drone', 5, 2); grid('diver', 4, 1, 92); }] },
  { era: 0, waves: [() => grid('diver', 6, 2), () => { grid('drone', 4, 2); grid('tank', 3, 1, 96, 70); }] },
  { era: 0, waves: [() => grid('tank', 5, 2), () => grid('diver', 7, 2)], boss: 'mother' },
  { era: 1, waves: [() => stream('saucer', 8, 'L'), () => stream('saucer', 8, 'R', 70), () => grid('splitter', 5, 2)] },
  { era: 1, waves: [() => { grid('turret', 4, 1); stream('saucer', 6, 'L'); }, () => { grid('splitter', 6, 2); stream('saucer', 6, 'R'); }], boss: 'divider' },
  { era: 2, waves: [() => zigs('zig', 10), () => { grid('spinner', 3, 1); zigs('zig', 8); }, () => grid('spinner', 5, 1)] },
  { era: 2, waves: [() => grid('carrier', 2, 1, 50, 160), () => { grid('eye', 3, 1, 60, 110); zigs('zig', 10); }], boss: 'overflow' },
  { era: 3, waves: [() => vform('swarm', 12), () => { grid('seraph', 3, 1, 50, 110); vform('swarm', 10); }, () => vform('swarm', 16)] },
  { era: 3, waves: [() => grid('bloom', 4, 1, 55, 80), () => { grid('seraph', 2, 1, 45, 180); grid('bloom', 3, 1, 85, 100); }], boss: 'infinity' },
];

// ================= spawning & patterns =================
let EID = 0;
function spawn(type, x, y, o = {}) {
  const t = T[type];
  const e = Object.assign({ id: ++EID, type, x, y, r: t.r, t: 0, flash: 0, mode: 'enter', ai: t.ai, delay: 0, ph: (rnd() * 100) | 0, hx: x, hy: y }, o);
  e.hp = o.hp != null ? o.hp : t.hp * (t.boss ? TUNE.bossHp : D() * TUNE.enemyHp); e.maxhp = e.hp;
  G.en.push(e); return e;
}
function spawnBoss(type) {
  const e = spawn(type, W / 2, -40);
  G.bossMax = e.maxhp;
  if (type === 'infinity') setCard(e, 0);
  if (G.phase !== 'sandbox') G.phase = 'boss';
  return e;
}
function shot(x, y, a, spd, o = {}) {
  if (G.eb.length > 2600) return;
  spd *= TUNE.enemyBulletSpeed * (G.hyper > 0 ? 1.2 : 1); // hyper raises rank, like DDP
  G.eb.push({ x, y, a, spd, r: BR[o.k || 'orb'], k: o.k || 'orb', c: o.c || '#ff4488', acc: o.acc || 0, turn: o.turn || 0, max: o.max || 9, t: 0, gz: 0 });
}
const BR = { dot: 2.5, orb: 4, big: 7, rice: 3, star: 3.5, knife: 3 };
function aim(e, spd, n = 1, spread = 0.2, o) { const a = Math.atan2(G.p.y - e.y, G.p.x - e.x); for (let i = 0; i < n; i++) shot(e.x, e.y, a + (i - (n - 1) / 2) * spread, spd, o); }
function ring(x, y, n, spd, off, o) { for (let i = 0; i < n; i++) shot(x, y, off + i * TAU / n, spd, o); }
function laser(x, y, a, o) { G.lz.push({ x, y, a, w: o.w || 10, warn: o.warn || 50, life: o.life || 40, t: 0, rot: o.rot || 0, owner: o.owner, c: o.c || '#ff4060' }); }
function part(x, y, vx, vy, life, c, s = 1.5) { if (G.parts.length < 4000) G.parts.push({ x, y, vx, vy, life, max: life, c, s }); }
function explode(x, y, size = 1, c = '#ffffff') {
  const e = G.era, n = [5, 12, 26, 42][e] * size, sp = [1.2, 2, 3.2, 4.2][e] * Math.sqrt(size);
  for (let i = 0; i < n; i++) { const a = rnd() * TAU, v = rnd() * sp; part(x, y, Math.cos(a) * v, Math.sin(a) * v, 18 + rnd() * 30, rnd() < 0.3 ? '#ffffff' : c, e >= 2 ? 1 + rnd() * 2 : 1); }
  if (e >= 2) G.fx.push({ k: 'ring', x, y, r: 2, vr: 2.5 * size, life: 22, max: 22, c });
  if (size >= 2) G.shake = Math.max(G.shake, 6 * size);
}
function dropCoins(x, y, v) { const n = Math.min(5, 1 + (v / 20 | 0)); for (let i = 0; i < n; i++) G.items.push({ x, y, vx: rr(-1, 1), vy: rr(-2, -0.5), v: v / n, t: 0 }); }
function cancelBullets(coins) {
  let n = 0;
  for (const b of G.eb) {
    if (G.era >= 1) { part(b.x, b.y, 0, -0.5, 16, b.c, 2); if (coins && n++ < 120) G.items.push({ x: b.x, y: b.y, vx: 0, vy: 0, v: 1 + G.era, t: 0, mag: 1 }); }
  }
  G.eb.length = 0;
}

// ================= bosses =================
function upMother(e) {
  if (e.y < 54) { e.y += 1; return; }
  e.x = W / 2 + Math.sin(e.t * 0.012) * 100;
  const rage = e.hp < e.maxhp / 2;
  if (e.t % (rage ? 40 : 60) === 0) for (let i = -1; i <= 1; i++) shot(e.x + i * 28, e.y + 18, PI2 + i * 0.18, 1.9, { k: 'dot', c: '#ffffff' });
  if (e.t % 50 === 25) aim(e, 2.3, rage ? 3 : 1, 0.2, { k: 'orb', c: '#ffffff' });
  if (e.t % 240 === 120 && G.en.length < 10) for (const s of [-1, 1]) spawn('diver', e.x + s * 30, e.y + 10, { hx: e.x + s * 30, hy: e.y + 34, mode: 'dive' });
}
function upDivider(e) {
  if (e.y < 60) { e.y += 1.2; return; }
  e.x = W / 2 + Math.sin(e.t * 0.015) * 90;
  if (e.t % 70 === 0) ring(e.x, e.y, 14, 1.7, e.t * 0.1, { k: 'dot', c: '#ff5a5a' });
  if (e.t % 36 === 18) aim(e, 2.6, 3, 0.18, { k: 'orb', c: '#ffd0d0' });
  if (e.hp <= e.maxhp / 2) {
    e.dead = 1; explode(e.x, e.y, 2, '#ff5a5a'); sfx('boom'); cancelBullets(true);
    for (const s of [-1, 1]) spawn('divhalf', e.x + s * 24, e.y, { side: s, hp: e.hp / 2 + 40 });
    G.msg = { text: '÷ 2', t: 70 };
  }
}
function upHalf(e) {
  const tx = W / 2 + e.side * 95 + Math.sin(e.t * 0.02) * 40, ty = 62 + Math.sin(e.t * 0.03 + e.side) * 26;
  e.x += (tx - e.x) * 0.05; e.y += (ty - e.y) * 0.05;
  if (e.t % 55 === 0) ring(e.x, e.y, 10, 1.6, e.t * 0.05, { k: 'orb', c: '#ff5a5a', turn: e.side * 0.008 });
  if (e.t % 24 === 12) aim(e, 2.8, 1, 0, { k: 'dot', c: '#ffd0d0' });
}
function upOverflow(e) {
  if (e.y < 70 && e.t < 200) { e.y += 1.2; return; }
  e.x = W / 2 + Math.sin(e.t * 0.01) * 70; e.y = 70 + Math.sin(e.t * 0.017) * 12;
  const r = e.hp / e.maxhp, ph = r > 0.66 ? 1 : r > 0.33 ? 2 : 3;
  if (ph !== e.ph2) { if (e.ph2) { cancelBullets(true); G.flash = 8; sfx('spell'); G.lz.length = 0; } e.ph2 = ph; e.pt = 0; }
  const t = ++e.pt;
  if (ph === 1) {
    if (t % 5 === 0) for (let k = 0; k < 4; k++) shot(e.x, e.y, t * 0.045 + k * TAU / 4, 2.1, { k: 'rice', c: '#29f6ff' });
    if (t % 60 === 0) aim(e, 3, 5, 0.12, { k: 'knife', c: '#ffffff' });
  } else if (ph === 2) {
    if (t % 40 === 0) ring(e.x, e.y, 24, 1.5, t * 0.02, { k: 'orb', c: '#ff3df2' });
    if (t % 90 < 36 && t % 6 === 0) aim(e, 3.2, 5, 0.16, { k: 'knife', c: '#ffe14a' });
  } else {
    if (t % 240 === 1) for (const s of [-1, 1]) laser(e.x, e.y, PI2 + s * 0.15, { w: 12, warn: 60, life: 170, rot: s * 0.006, owner: e, c: '#29f6ff' });
    if (t % 8 === 0) for (let k = 0; k < 3; k++) shot(e.x, e.y, -t * 0.03 + k * TAU / 3, 1.6, { k: 'dot', c: '#ffffff' });
    if (t % 50 === 25) aim(e, 2.6, 3, 0.25, { k: 'orb', c: '#ff3df2' });
  }
}
function setCard(e, k) {
  e.card = k; e.ct = 0; e.hp = e.maxhp = T.infinity.hp * TUNE.bossHp * (k === 3 ? 1.4 : 1); G.bossMax = e.maxhp;
  G.banner = { t: 0, jp: SPELLS[k][0], en: SPELLS[k][1] }; sfx('spell');
}
function cardBreak(e) {
  cancelBullets(true); G.lz.length = 0; explode(e.x, e.y, 2.5, '#ff5fa2'); sfx('boom'); G.flash = 10; G.shake = 12;
  G.hg += 40; G.combo += 20;
  if (e.card >= 3) return false;
  setCard(e, e.card + 1); return true;
}
function upInfinity(e) {
  if (e.y < 72 && e.t < 200) { e.y += 1.2; return; }
  const k = e.card, c = ++e.ct;
  const tx = W / 2 + Math.sin(c * 0.013) * (k === 3 ? 110 : 60), ty = 72 + Math.sin(c * 0.021) * 16;
  e.x += (tx - e.x) * 0.05; e.y += (ty - e.y) * 0.05;
  if (c < 40) return;
  if (k === 0) {
    if (c % 38 === 0) for (let L = 0; L < 3; L++) ring(e.x, e.y, 26, 1.2 + L * 0.45, c * 0.05 + L * 0.12, { k: 'rice', c: ['#ff5fa2', '#ffd24a', '#7dfcff'][L], turn: (L % 2 ? 1 : -1) * 0.0045 });
    if (c % 7 === 0) for (const s of [-1, 1]) shot(e.x, e.y, PI2 + s * (0.6 + Math.sin(c * 0.05) * 0.5), 2.4, { k: 'star', c: '#ffffff' });
  } else if (k === 1) {
    if (c % 2 === 0) { const a = c * 2.39996; for (const o of [0, Math.PI]) shot(e.x, e.y, a + o, 1.2, { k: 'orb', c: hsl(c * 4 + o * 60), acc: 0.015, max: 2.8 }); }
    if (c % 70 === 0) aim(e, 3, 7, 0.13, { k: 'knife', c: '#ffffff' });
  } else if (k === 2) {
    if (c % 55 === 0) { const gap = G.p.x; for (let x = 8; x < W; x += 12) if (Math.abs(x - gap) > 34) shot(x, -4, PI2, 1.3, { k: 'dot', c: '#b28cff' }); }
    if (c % 120 === 60) { const a = Math.atan2(G.p.y - e.y, G.p.x - e.x); for (const s of [-1, 0, 1]) laser(e.x, e.y, a + s * 0.45, { w: 10, warn: 50, life: 40, owner: e, c: '#b28cff' }); }
    if (c % 12 === 0) aim(e, 2.6, 2, 0.4, { k: 'knife', c: '#ffffff' });
  } else {
    if (c % 4 === 0) for (let j = 0; j < 3; j++) { shot(e.x, e.y, c * 0.09 + j * TAU / 3, 2, { k: 'rice', c: hsl(c * 3 + j * 120) }); shot(e.x, e.y, -c * 0.07 + j * TAU / 3, 1.5, { k: 'rice', c: hsl(c * 3 + j * 120 + 60) }); }
    if (c % 48 === 0) ring(e.x, e.y, 36, 1.1, c * 0.01, { k: 'big', c: '#ffffff' });
  }
  if (c > 60 * 45) { if (!cardBreak(e)) kill(e); }
}

// ================= player =================
function pshot(x, y, a, spd, dmg, o) { G.pb.push(Object.assign({ x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, dmg, k: 'b', t: 0 }, o)); }
function hyperOn() {
  if (G.era !== 3 || G.hstock <= 0 || G.hyper > 0 || G.state !== 'play') return;
  G.hstock--; G.hyper = 600; cancelBullets(true); G.flash = 10; G.shake = 8; sfx('spell'); G.msg = { text: 'HYPER!!', t: 60 };
}
function firePlayer() {
  const w = wpn(), m = ERAS[G.era].dmg * (1 + 0.35 * (G.power - 1)) * (G.hyper > 0 ? 1.8 : 1) * TUNE.playerDamage;
  const cd = w.fire(G.p, m, I.focus);
  if (!w.beam) sfx('shot');
  return Math.max(1, Math.round(cd * (1 - 0.15 * G.rapid) * (G.hyper > 0 ? 0.6 : 1)));
}
function updPlayer() {
  const p = G.p, ddp = G.era === 3;
  // DDP-style: tap = burst of shots, hold = laser (ship slows down). Earlier eras: hold to fire.
  if (I.fire) p.hold++; else p.hold = 0;
  if (p.hold === 1) p.burst = 20;
  if (p.burst > 0) p.burst--;
  p.laser = ddp && p.hold > 14 && !wpn().beam && !p.dead;
  const sp = ERAS[G.era].spd * (I.focus ? 0.45 : 1) * (p.laser ? 0.55 : 1);
  let dx = (I.right ? 1 : 0) - (I.left ? 1 : 0), dy = (I.down ? 1 : 0) - (I.up ? 1 : 0);
  if (dx && dy) { dx *= 0.7071; dy *= 0.7071; }
  p.x = clamp(p.x + dx * sp, 10, W - 10); p.y = clamp(p.y + dy * sp, G.era === 0 ? H * 0.45 : 30, H - 12);
  p.tilt = lerp(p.tilt, dx, 0.2);
  if (p.inv > 0) p.inv--;
  if (p.cd > 0) p.cd--;
  const firing = ddp ? (p.burst > 0 || (p.hold > 0 && !p.laser) || (wpn().beam && I.fire)) : I.fire;
  if (firing && p.cd <= 0) p.cd = firePlayer();
  const m = ERAS[G.era].dmg * (1 + 0.35 * (G.power - 1)) * (G.hyper > 0 ? 2 : 1) * TUNE.playerDamage;
  if (p.laser) {
    const bw = G.hyper > 0 ? 15 : 9; let tg = null;
    for (const e of G.en) if (live(e) && e.y < p.y && Math.abs(e.x - p.x) < e.r + bw && (!tg || e.y > tg.y)) tg = e;
    p.lend = tg ? tg.y + tg.r * 0.4 : -10;
    if (tg) { hit(tg, 0.3 * m); if (G.frame % 2 === 0) for (let i = 0; i < 3; i++) part(p.x + rr(-bw, bw), p.lend, rr(-2.5, 2.5), rr(-3, 1), 14, wpn().color || '#7dfcff', 2); }
    if (G.frame % 4 === 0) sfx('beam');
  }
  if (p.beam > 0) {
    p.beam--;
    const bw = I.focus ? 7 : 12;
    for (const e of G.en) if (live(e) && e.y < p.y && Math.abs(e.x - p.x) < e.r + bw) { hit(e, 0.32 * m * (I.focus ? 1.4 : 1)); if (G.frame % 3 === 0) part(e.x + rr(-6, 6), e.y + e.r * 0.5, rr(-2, 2), rr(0.5, 3), 14, '#ffe14a', 2); }
    if (G.frame % 4 === 0) sfx('beam');
  }
  G.orbs.length = 0;
  if (wpn().orbit) {
    for (let i = 0; i < 4; i++) { const a = G.frame * 0.12 + i * TAU / 4, r = I.focus ? 22 : 34; G.orbs.push({ x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r * 0.8 }); }
    for (const o of G.orbs) {
      for (const e of G.en) if (live(e) && (e.x - o.x) ** 2 + (e.y - o.y) ** 2 < (e.r + 7) ** 2) hit(e, 0.35 * m);
      for (const b of G.eb) if (!b.dead && (b.x - o.x) ** 2 + (b.y - o.y) ** 2 < (b.r + 7) ** 2) { b.dead = 1; part(b.x, b.y, rr(-1, 1), rr(-1, 1), 12, '#ffffff', 2); }
    }
  }
  if (G.era >= 2 && G.frame % 2 === 0) part(p.x + rr(-2, 2), p.y + 9, rr(-0.3, 0.3), rr(1.5, 3), 12, G.era === 3 ? '#ff9ccc' : '#29f6ff', 2);
}
function hurt() {
  const p = G.p; if (p.inv > 0 || p.dead) return;
  if (G.god) { for (let i = 0; i < 4; i++) part(p.x, p.y, rr(-2, 2), rr(-2, 2), 10, '#7dfcff', 2); return; }
  p.hp--; p.inv = G.era === 3 ? 150 : 110; G.shake = 10; G.flash = 6; sfx('hurt'); explode(p.x, p.y, 1, '#ffffff');
  if (G.era >= 2) cancelBullets(false);
  if (p.hp <= 0) { p.dead = 1; explode(p.x, p.y, 3, '#ffd24a'); G.state = 'dying'; G.dieT = 110; sfx('big'); }
}
function bomb() {
  if (G.bombs <= 0 || G.bombT > 0 || G.era === 0 || G.state !== 'play') return;
  G.bombs--; G.bombT = G.era === 3 ? 150 : 70; G.p.inv = Math.max(G.p.inv, G.bombT + 30);
  G.bx = G.p.x; G.by = G.era === 3 ? Math.max(40, G.p.y - 90) : G.p.y; G.shake = 8; sfx('bomb');
  if (G.era === 1) { G.flash = 10; cancelBullets(true); for (const e of G.en) if (live(e)) hit(e, 30 * ERAS[1].dmg * (T[e.type].boss ? 0.3 : 1)); }
}
function updBomb() {
  if (G.bombT <= 0) return;
  const m = ERAS[G.era].dmg, k = G.bombT--;
  if (G.era === 2) {
    const r = (70 - k) * 8;
    for (const b of G.eb) if ((b.x - G.bx) ** 2 + (b.y - G.by) ** 2 < r * r) { b.dead = 1; G.items.push({ x: b.x, y: b.y, vx: 0, vy: 0, v: 3, t: 0, mag: 1 }); }
    for (const e of G.en) if (live(e) && (e.x - G.bx) ** 2 + (e.y - G.by) ** 2 < r * r) hit(e, 0.8 * m * (T[e.type].boss ? 0.4 : 1));
    if (k === 70) G.flash = 6;
  } else if (G.era === 3) {
    const x = G.bx, y = G.by;
    for (const b of G.eb) {
      const dx = x - b.x, dy = y - b.y, d = Math.hypot(dx, dy) + 0.01;
      if (d < 16) { b.dead = 1; if (rnd() < 0.3) G.items.push({ x, y, vx: 0, vy: 0, v: 4, t: 0, mag: 1 }); }
      else { const pull = Math.min(6, 900 / d); b.x += dx / d * pull + dy / d * 1.5; b.y += dy / d * pull - dx / d * 1.5; }
    }
    for (const e of G.en) if (live(e) && Math.hypot(e.x - x, e.y - y) < 150) hit(e, 0.5 * m * (T[e.type].boss ? 0.4 : 1));
    for (let i = 0; i < 8; i++) { const a = rnd() * TAU, r = rr(60, 180); part(x + Math.cos(a) * r, y + Math.sin(a) * r, -Math.cos(a) * r / 18 - Math.sin(a) * 4, -Math.sin(a) * r / 18 + Math.cos(a) * 4, 18, ['#b28cff', '#ff5fa2', '#7dfcff', '#ffffff'][i % 4], 2); }
    G.shake = Math.max(G.shake, 4);
    if (k === 1) { explode(x, y, 4, '#b28cff'); G.flash = 14; sfx('big'); for (const e of G.en) if (live(e) && Math.hypot(e.x - x, e.y - y) < 220) hit(e, 30 * m * (T[e.type].boss ? 0.3 : 1)); }
  }
}

// ================= update =================
const live = e => !e.dead && e.delay <= 0;
function hit(e, dmg) {
  if (e.dead) return;
  e.hp -= dmg; e.flash = 3;
  if (G.era === 3) { G.comboT = 110; if (G.frame % 3 === 0) G.combo++; }
  if (G.frame % 3 === 0) sfx('hit');
  if (e.hp <= 0) { if (e.type === 'infinity' && cardBreak(e)) return; kill(e); }
}
function kill(e) {
  if (e.dead) return;
  e.dead = 1; const t = T[e.type];
  G.score += Math.round(t.sc * (1 + G.combo / 100));
  if (G.era === 3) { G.combo += 3; G.comboT = 110; G.hg += t.boss ? 50 : 4; if (G.hg >= 100) { G.hg = 0; if (G.hstock < 3) { G.hstock++; G.msg = { text: 'HYPER READY', t: 50 }; sfx('buy'); } } }
  const cash = Math.round(t.$ * TUNE.money);
  if (G.era === 0) G.money += cash; else dropCoins(e.x, e.y, cash);
  for (const h of HOOKS.kill) h(e);
  explode(e.x, e.y, t.boss ? 3 : t.r > 15 ? 1.6 : 1, colorOf(e));
  sfx(t.boss ? 'big' : 'boom');
  if (t.die) t.die(e);
  if (G.era >= 1) G.fx.push({ k: 'txt', x: e.x, y: e.y, text: '' + t.sc, life: 40, max: 40 });
  if (t.boss && !G.en.some(o => o !== e && !o.dead && T[o.type].boss)) {
    G.slow = 70; G.shake = 25; G.flash = 14; cancelBullets(true); G.lz.length = 0;
    for (let i = 1; i < 7; i++) G.fx.push({ k: 'boomer', x: e.x + rr(-40, 40), y: e.y + rr(-25, 25), t: i * 9, c: colorOf(e) });
  }
}
function nearest(x, y) { let b = null, bd = 1e9; for (const e of G.en) if (live(e) && e.y > -10) { const d = (e.x - x) ** 2 + (e.y - y) ** 2; if (d < bd) { bd = d; b = e; } } return b; }

function updEnemy(e) {
  if (e.delay > 0) { e.delay--; return; }
  e.t++; if (e.flash > 0) e.flash--;
  const t = T[e.type];
  if (t.upd) t.upd(e);
  else if (e.ai === 'form') {
    const hx = e.hx + Math.sin(G.lt * 0.02) * 22, hy = e.hy + Math.sin(G.lt * 0.03 + e.hx * 0.05) * 3;
    if (e.mode === 'dive') {
      e.y += 2.4; e.x += Math.sin(e.t * 0.06) * 2.2 + clamp(G.p.x - e.x, -1, 1) * 0.6;
      if (e.y > H + 20) { e.y = -20; e.mode = 'enter'; }
    } else {
      e.x += (hx - e.x) * 0.09; e.y += (hy - e.y) * 0.09;
      if (e.mode === 'enter' && Math.abs(hy - e.y) < 2) e.mode = 'form';
      if (t.dives && e.mode === 'form' && rnd() < 0.003 * D()) { e.mode = 'dive'; e.t = 0; }
    }
  } else if (e.ai === 'path') {
    const q = e.path(e.t, e); e.x = q[0]; e.y = q[1];
    if (e.t > 60 && (e.x < -40 || e.x > W + 40 || e.y > H + 40)) e.dead = 1;
  } else if (e.ai === 'chase') {
    e.x += clamp(G.p.x - e.x, -1.4, 1.4); e.y += 1.8; if (e.y > H + 20) e.dead = 1;
  }
  if (t.fire && e.y > 0 && e.y < H * 0.75 && !G.p.dead) t.fire(e);
  if (!G.p.dead && (e.x - G.p.x) ** 2 + (e.y - G.p.y) ** 2 < (e.r * 0.7 + ERAS[G.era].hit) ** 2) { hurt(); if (!t.boss) hit(e, 5); }
}
function updBullets() {
  const p = G.p, hr = ERAS[G.era].hit;
  for (const b of G.pb) {
    b.t++;
    if (b.k === 'wave') { b.y += b.vy; b.x = b.x0 + Math.sin(b.t * 0.22) * b.amp * b.ph; }
    else if (b.k === 'missile') {
      if (!b.tg || b.tg.dead) b.tg = nearest(b.x, b.y);
      if (b.tg) {
        const a = Math.atan2(b.tg.y - b.y, b.tg.x - b.x), cur = Math.atan2(b.vy, b.vx);
        let da = a - cur; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
        const na = cur + clamp(da, -b.home, b.home), sp = Math.min(9, Math.hypot(b.vx, b.vy) + 0.25);
        b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp;
      } else b.vy -= 0.2;
      b.x += b.vx; b.y += b.vy;
      if (G.era >= 2) part(b.x, b.y, 0, 0, 10, G.era === 3 ? '#ff9ccc' : '#9ff', 1.5);
    } else { b.x += b.vx; b.y += b.vy; }
    if (b.y < -20 || b.y > H + 20 || b.x < -20 || b.x > W + 20 || b.t > 300) { b.dead = 1; continue; }
    for (const e of G.en) {
      if (!live(e)) continue;
      const dx = e.x - b.x, dy = e.y - b.y;
      const h = b.k === 'laser' ? Math.abs(dx) < e.r && Math.abs(dy) < e.r + 12 : dx * dx + dy * dy < (e.r + 3) ** 2;
      if (!h) continue;
      if (b.pierce) { if (b.hits.includes(e.id)) continue; b.hits.push(e.id); } else b.dead = 1;
      hit(e, b.dmg);
      if (G.era >= 1) for (let i = 0; i < G.era; i++) part(b.x, b.y, rr(-1.5, 1.5), rr(-2, 0.5), 10, '#ffe9a0', 1.5);
      if (b.dead) break;
    }
  }
  for (const b of G.eb) {
    b.t++;
    if (b.acc) b.spd = clamp(b.spd + b.acc, 0.3, b.max);
    b.a += b.turn;
    b.x += Math.cos(b.a) * b.spd; b.y += Math.sin(b.a) * b.spd;
    if (b.y < -30 || b.y > H + 20 || b.x < -20 || b.x > W + 20) { b.dead = 1; continue; }
    if (p.dead || G.state !== 'play') continue;
    const d2 = (b.x - p.x) ** 2 + (b.y - p.y) ** 2;
    if (d2 < (b.r * 0.8 + hr) ** 2) { if (p.inv <= 0) { b.dead = 1; hurt(); } }
    else if (G.era >= 2 && !b.gz && d2 < (b.r + hr + 13) ** 2) {
      b.gz = 1; G.graze++; G.score += 20 * G.era; if (G.era === 3) G.hg = Math.min(99, G.hg + 0.4);
      for (let i = 0; i < 3; i++) part(p.x, p.y, rr(-2, 2), rr(-2, 2), 12, '#ffffff', 1.5);
      sfx('graze');
    }
  }
  for (const l of G.lz) {
    l.t++;
    if (l.owner && !l.owner.dead) { l.x = l.owner.x; l.y = l.owner.y; }
    if (l.t > l.warn) l.a += l.rot;
    if (l.t === l.warn) sfx('laser');
    if (l.t > l.warn + l.life) { l.dead = 1; continue; }
    if (l.t > l.warn && !p.dead && G.state === 'play') {
      const dx = p.x - l.x, dy = p.y - l.y, along = dx * Math.cos(l.a) + dy * Math.sin(l.a);
      if (along > 0 && Math.abs(-dx * Math.sin(l.a) + dy * Math.cos(l.a)) < l.w * 0.45 + hr) hurt();
    }
  }
  G.pb = G.pb.filter(b => !b.dead); G.eb = G.eb.filter(b => !b.dead); G.lz = G.lz.filter(l => !l.dead);
}
function updItems() {
  const p = G.p;
  for (const it of G.items) {
    it.t++;
    const dx = p.x - it.x, dy = p.y - it.y, d = Math.hypot(dx, dy) + 0.01;
    if (!p.dead && (it.mag || d < 55 || G.trailer)) { it.mag = 1; const sp = Math.min(9, 3 + it.t * 0.15); it.x += dx / d * sp; it.y += dy / d * sp; }
    else { it.vy = Math.min(it.vy + 0.05, 1.6); it.x += it.vx; it.y += it.vy; it.vx *= 0.98; }
    if (d < 14 && !p.dead) { it.dead = 1; G.money += Math.round(it.v); G.score += Math.round(it.v * 2); if (G.frame % 3 === 0) sfx('coin'); }
    if (it.y > H + 10) it.dead = 1;
  }
  G.items = G.items.filter(i => !i.dead);
}
function updFx() {
  for (const q of G.parts) { q.x += q.vx; q.y += q.vy; q.vx *= 0.96; q.vy *= 0.96; q.life--; }
  G.parts = G.parts.filter(q => q.life > 0);
  for (const f of G.fx) {
    if (f.k === 'boomer') { if (--f.t <= 0) { explode(f.x, f.y, 2, f.c); sfx('boom'); f.dead = 1; } continue; }
    f.life--; if (f.k === 'ring') f.r += f.vr; if (f.k === 'txt') f.y -= 0.4;
    if (f.life <= 0) f.dead = 1;
  }
  G.fx = G.fx.filter(f => !f.dead);
  if (G.shake > 0) G.shake *= 0.88; if (G.shake < 0.3) G.shake = 0;
  if (G.flash > 0) G.flash--;
  if (G.msg && --G.msg.t <= 0) G.msg = null;
  if (G.banner) G.banner.t++;
  if (G.comboT > 0 && --G.comboT === 0) G.combo = 0;
  if (G.hyper > 0 && G.state === 'play') G.hyper--;
  for (const s of STARS) { s.y += s.z * (G.era + 1) * 0.5; if (s.y > H) { s.y = 0; s.x = rnd() * W; } }
}
function director() {
  const alive = G.en.filter(e => !e.dead).length;
  if (G.phase === 'sandbox') { if (G.refill && G.en.filter(e => !e.dead && !T[e.type].boss).length <= G.refillN) G.refill(); return; }
  const L = LEVELS[G.level];
  if (G.phase === 'waves') {
    G.waveT++;
    if (G.wave < L.waves.length) {
      if ((alive <= Math.floor(G.waveSize * TUNE.waveNext) && G.waveT > 30) || G.waveT > TUNE.waveTimeout) { const n0 = G.en.length; L.waves[G.wave++](); G.waveSize = G.en.length - n0; G.waveT = 0; }
    } else if (alive === 0) { if (L.boss) { G.phase = 'warn'; G.warnT = 100; sfx('warn'); } else { G.phase = 'clear'; G.clearT = 50; } }
  } else if (G.phase === 'warn') { if (--G.warnT <= 0) spawnBoss(L.boss); }
  else if (G.phase === 'boss') { if (!G.en.some(e => !e.dead && T[e.type].boss)) { G.phase = 'clear'; G.clearT = 110; } }
  else if (G.phase === 'clear') { if (--G.clearT <= 0) levelDone(); }
}
function tick() {
  if (G.slow > 0) { G.slow--; if (G.slow % 2) return; }
  G.frame++;
  for (const h of HOOKS.tick) h();
  const st = G.state;
  if (st === 'play' || st === 'dying') {
    G.lt++;
    if (st === 'play') updPlayer();
    director();
    for (const e of G.en) updEnemy(e);
    updBullets(); updItems(); updBomb();
    G.en = G.en.filter(e => !e.dead);
    if (st === 'dying' && --G.dieT <= 0) G.state = 'over';
  } else if (st === 'upgrade') {
    G.upT++;
    if (G.upT === 1) sfx('upgrade');
    if (G.upT === 90) { setEra(G.upTo); clearWorld(); G.flash = 20; sfx('big'); }
    if (G.upT >= 160) { if (G.trailer) G.state = 'play'; else { G.money += 800 * G.era; G.p.hp = G.p.maxhp; openShop(); } }
  }
  updFx();
}

// ================= flow =================
function setEra(e) {
  G.era = e; document.body.dataset.era = e;
  $('brand').textContent = ERAS[e].name; $('model').textContent = ERAS[e].model;
}
function clearWorld() { G.pb = []; G.eb = []; G.en = []; G.items = []; G.lz = []; G.fx = []; G.bombT = 0; G.banner = null; G.warnT = 0; }
function newGame(lvl) {
  G.money = [0, 250, 700, 1500, 2600, 4200, 6500, 9000, 13000][lvl]; G.score = 0; G.owned = { single: 1 }; G.weapon = 'single';
  G.money += TUNE.startMoney; G.god = TUNE.god;
  G.power = 1; G.rapid = 0; G.bombs = 0; G.p.maxhp = TUNE.startShields + Math.min(3, lvl >> 1); G.p.hp = G.p.maxhp; G.level = lvl;
  setEra(LEVELS[lvl].era); G.graze = 0;
  if (lvl > 0) openShop(); else startLevel(0);
}
function startLevel(n) {
  G.level = n; clearWorld(); G.state = 'play'; G.phase = 'waves'; G.wave = 0; G.waveT = 0; G.waveSize = 0; G.lt = 0;
  Object.assign(G.p, { x: W / 2, y: H - 30, inv: 90, cd: 0, dead: 0, beam: 0, hold: 0, burst: 0, laser: 0 });
  G.combo = 0; G.comboT = 0; G.hyper = 0;
  if (G.era >= 1) G.bombs = Math.max(G.bombs, 2);
  G.msg = { text: 'LEVEL ' + (n + 1), t: 90 };
  for (const h of HOOKS.levelStart) h(n);
}
function levelDone() {
  G.level++;
  if (G.level >= LEVELS.length) { G.state = 'win'; saveHi(); sfx('upgrade'); return; }
  if (LEVELS[G.level].era > G.era) startUpgrade(LEVELS[G.level].era); else openShop();
}
function startUpgrade(to) { G.state = 'upgrade'; G.upT = 0; G.upTo = to; if (G.trailer) G.refill = null; }
function openShop() { G.state = 'shop'; G.menu = 0; G.scroll = 0; sfx('menu'); }
function saveHi() { if (G.score > G.hi) { G.hi = G.score; try { localStorage.setItem('phx_hi', G.hi); } catch (e) { } } }
function shopItems() {
  const e = G.era, L = [];
  for (const w of WEAPONS) if (w.era <= e) L.push({ label: w.name, w, d: w.d, right: G.owned[w.id] ? (G.weapon === w.id ? 'ON' : 'OWN') : '$' + w.cost, cost: G.owned[w.id] ? 0 : w.cost });
  L.push({ label: 'REPAIR', d: 'Restore all shields.', cost: 40 * (e + 1), ok: G.p.hp < G.p.maxhp, act() { G.p.hp = G.p.maxhp; } });
  L.push({ label: 'SHIELD+1', d: 'One more shield slot.', cost: 200 + 150 * (G.p.maxhp - 3) * (e + 1), ok: G.p.maxhp < 8, act() { G.p.maxhp++; G.p.hp++; } });
  L.push({ label: 'RAPID ' + (G.rapid + 1), d: 'Faster fire rate.', cost: [250, 700, 1600, 0][G.rapid], ok: G.rapid < 3, act() { G.rapid++; } });
  if (e >= 1) L.push({ label: 'POWER ' + (G.power + 1), d: 'More damage on every weapon.', cost: [900, 2400, 0][G.power - 1], ok: G.power < 3, act() { G.power++; } });
  if (e >= 1) L.push({ label: 'BOMB', d: ['', 'Screen flash.', 'Shockwave.', '÷0 Singularity: a black hole.'][e], cost: 250 * e, ok: G.bombs < 6, act() { G.bombs++; } });
  L.push({ label: 'CONTINUE >', d: 'Next level.', go: 1 });
  for (const it of L) if (it.right == null && !it.go) it.right = it.ok ? '$' + it.cost : '--';
  return L;
}
function shopBuy() {
  const it = shopItems()[G.menu];
  if (it.go) { startLevel(G.level); return; }
  if (it.w) {
    if (G.owned[it.w.id]) { G.weapon = it.w.id; sfx('menu'); return; }
    if (G.money >= it.cost) { G.money -= it.cost; G.owned[it.w.id] = 1; G.weapon = it.w.id; sfx('buy'); } else sfx('err');
    return;
  }
  if (it.ok && G.money >= it.cost) { G.money -= it.cost; it.act(); sfx('buy'); } else sfx('err');
}
function cycleWeapon() {
  const own = WEAPONS.filter(w => G.owned[w.id]); if (own.length < 2) return;
  const i = own.findIndex(w => w.id === G.weapon); G.weapon = own[(i + 1) % own.length].id;
  G.msg = { text: own[(i + 1) % own.length].name, t: 50 }; sfx('menu');
}
function press(k, internal) {
  audioInit();
  flashKey(k);
  if (k === 'mute') { AU.muted = !AU.muted; if (AU.out) AU.out.gain.value = AU.muted ? 0 : 0.5; return; }
  if (TR.on && !internal) { if (k === 'clear' || k === 'enter') location.href = location.pathname; return; }
  const st = G.state;
  if (st === 'title') {
    if (k === 'up' || k === 'down') { G.menu = (G.menu + (k === 'up' ? 2 : 1)) % 3; sfx('menu'); }
    else if ((k === 'left' || k === 'right') && G.menu === 2) { G.titleLvl = clamp(G.titleLvl + (k === 'left' ? -1 : 1), 1, 9); sfx('menu'); }
    else if (/^[1-9]$/.test(k)) { G.titleLvl = +k; newGame(+k - 1); }
    else if (k === 'trailer') startTrailer(false);
    else if (k === 'enter' || k === 'fire') { if (G.menu === 1) startTrailer(false); else newGame(G.menu === 2 ? G.titleLvl - 1 : 0); }
  } else if (st === 'shop') {
    const n = shopItems().length;
    if (k === 'up' || k === 'down') { G.menu = (G.menu + (k === 'up' ? n - 1 : 1)) % n; sfx('menu'); }
    else if (k === 'enter' || k === 'fire') shopBuy();
    else if (k === 'clear') { G.menu = n - 1; shopBuy(); }
  } else if (st === 'play') {
    if (k === 'bomb') bomb();
    else if (k === 'hyper') hyperOn();
    else if (k === 'mode') cycleWeapon();
    else if (k === 'pause' || k === 'enter' || k === 'clear') { G.state = 'pause'; sfx('menu'); }
  } else if (st === 'pause') {
    if (k === 'pause' || k === 'enter' || k === 'fire') G.state = 'play';
    else if (k === 'clear') { saveHi(); toTitle(); }
  } else if (st === 'over') {
    if (k === '1' || k === 'enter' || k === 'fire') { G.p.hp = G.p.maxhp; startLevel(G.level); }
    else if (k === '2' || k === 'clear') { saveHi(); toTitle(); }
  } else if (st === 'win') { if (k === 'enter' || k === 'fire' || k === 'clear') toTitle(); }
}
function toTitle() { G.state = 'title'; G.menu = 0; setEra(0); clearWorld(); G.parts = []; }

// ================= autopilot (trailer) =================
function autopilot() {
  const p = G.p;
  I.fire = G.era < 3 || G.auto === 'laser' ? 1 : G.auto === 'shot' ? +(G.frame % 22 < 3) : +(G.frame % 120 < 80 || G.frame % 12 < 3);
  let tx = p.x, ty = G.era === 0 ? H - 22 : H - 50 + Math.sin(G.frame * 0.02) * 18;
  let best = null, bd = 1e9;
  for (const e of G.en) { if (!live(e) || e.y < 0) continue; const d = Math.abs(e.x - p.x) + (H - e.y) * 0.3 - (T[e.type].boss ? 200 : 0); if (d < bd) { bd = d; best = e; } }
  if (best) tx = best.x + Math.sin(G.frame * 0.03) * 12;
  let fx = 0, fy = 0, near = 0;
  for (const b of G.eb) {
    const px = b.x + Math.cos(b.a) * b.spd * 8, py = b.y + Math.sin(b.a) * b.spd * 8;
    const dx = p.x - px, dy = p.y - py, d2 = dx * dx + dy * dy;
    if (d2 < 2500) { const d = Math.sqrt(d2) + 0.1, w = (50 - d) / 50; fx += dx / d * w * 3; fy += dy / d * w * 3; near++; }
  }
  for (const l of G.lz) { const dx = p.x - l.x, dy = p.y - l.y, s = -dx * Math.sin(l.a) + dy * Math.cos(l.a); if (Math.abs(s) < 40) { fx += -Math.sin(l.a) * Math.sign(s || 1) * 3; fy += Math.cos(l.a) * Math.sign(s || 1) * 3; } }
  const mx = (tx - p.x) * 0.08 + fx, my = (ty - p.y) * 0.05 + fy;
  I.left = mx < -0.35; I.right = mx > 0.35; I.up = my < -0.35; I.down = my > 0.35;
  I.focus = G.era >= 2 && near > 10;
}

// ================= audio =================
const AU = { ac: null, out: null, nb: null, mus: null, muted: false, last: {} };
function mkNoise(ac) { const b = ac.createBuffer(1, ac.sampleRate, ac.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; }
function audioInit() {
  if (AU.ac || TR.rec) { if (AU.ac && AU.ac.state === 'suspended') AU.ac.resume(); return; }
  try { AU.ac = new AudioContext(); AU.out = AU.ac.createGain(); AU.out.gain.value = AU.muted ? 0 : 0.5; AU.out.connect(AU.ac.destination); AU.nb = mkNoise(AU.ac); } catch (e) { AU.ac = null; }
}
const midi = m => 440 * Math.pow(2, (m - 69) / 12);
function tone(ac, out, t, type, f, dur, vol, f2, lp) {
  const o = ac.createOscillator(), g = ac.createGain(); o.type = type;
  o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  if (lp) { const fl = ac.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; o.connect(fl).connect(g); } else o.connect(g);
  g.connect(out); o.start(t); o.stop(t + dur + 0.02);
}
function noise(ac, out, nb, t, dur, vol, f, type = 'lowpass', f2) {
  const s = ac.createBufferSource(); s.buffer = nb; const fl = ac.createBiquadFilter(), g = ac.createGain();
  fl.type = type; fl.frequency.setValueAtTime(f, t); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(fl).connect(g).connect(out); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
}
function playSfx(ac, out, nb, n, era, t) {
  switch (n) {
    case 'shot': [() => tone(ac, out, t, 'square', 1800, 0.03, 0.03, 900), () => tone(ac, out, t, 'square', 900, 0.06, 0.04, 300),
      () => tone(ac, out, t, 'sawtooth', 1200, 0.07, 0.035, 200), () => { tone(ac, out, t, 'triangle', 1600, 0.06, 0.06, 400); noise(ac, out, nb, t, 0.04, 0.03, 6000, 'highpass'); }][era](); break;
    case 'beam': noise(ac, out, nb, t, 0.08, 0.05, 1800, 'bandpass'); break;
    case 'hit': tone(ac, out, t, 'square', 220, 0.03, 0.04, 120); break;
    case 'boom': noise(ac, out, nb, t, era ? 0.4 : 0.15, era ? 0.35 : 0.2, 3000, 'lowpass', 150); if (era >= 2) tone(ac, out, t, 'sine', 140, 0.3, 0.3, 40); break;
    case 'big': noise(ac, out, nb, t, 1.4, 0.6, 4000, 'lowpass', 60); tone(ac, out, t, 'sine', 90, 1.1, 0.55, 25); break;
    case 'coin': tone(ac, out, t, 'square', 1320, 0.05, 0.03); tone(ac, out, t + 0.04, 'square', 1760, 0.07, 0.03); break;
    case 'menu': tone(ac, out, t, 'square', 1200, 0.03, 0.05); break;
    case 'buy': tone(ac, out, t, 'square', 660, 0.08, 0.08); tone(ac, out, t + 0.08, 'square', 990, 0.14, 0.08); break;
    case 'err': tone(ac, out, t, 'square', 120, 0.18, 0.1); break;
    case 'bomb': noise(ac, out, nb, t, 1.6, 0.5, 200, 'bandpass', 4000); tone(ac, out, t, 'sine', 60, 1.4, 0.5, 30); break;
    case 'graze': tone(ac, out, t, 'triangle', 2600, 0.03, 0.025); break;
    case 'laser': tone(ac, out, t, 'sawtooth', 300, 0.5, 0.12, 900, 2400); break;
    case 'spell': tone(ac, out, t, 'sawtooth', 200, 0.7, 0.12, 1600, 3000); noise(ac, out, nb, t, 0.8, 0.2, 500, 'bandpass', 6000); break;
    case 'hurt': tone(ac, out, t, 'sawtooth', 300, 0.35, 0.25, 60); break;
    case 'warn': for (let i = 0; i < 6; i++) tone(ac, out, t + i * 0.25, 'square', i % 2 ? 660 : 880, 0.22, 0.08); break;
    case 'upgrade': for (let i = 0; i < 12; i++) tone(ac, out, t + i * 0.07, 'square', midi(60 + i * 2), 0.09, 0.06); tone(ac, out, t + 1.8, 'sawtooth', 110, 1.2, 0.15, 880, 4000); break;
    case 'hitcard': noise(ac, out, nb, t, 1.2, 0.5, 6000, 'lowpass', 80); tone(ac, out, t, 'sine', 70, 1, 0.6, 30); break;
    case 'boot': tone(ac, out, t, 'square', 2000, 0.02, 0.05); break;
  }
}
const PROG = [
  [[57, 0], [53, 1], [48, 1], [55, 1]],
  [[57, 0], [53, 1], [48, 1], [55, 1]],
  [[45, 0], [41, 1], [43, 1], [40, 0]],
  [[50, 0], [46, 1], [48, 1], [45, 1]],
];
const BPM = [120, 140, 112, 172];
function musicStep(ac, out, nb, era, s, t, st) {
  const i = s % 16, [root, maj] = PROG[era][(s >> 4) % 4], tri = maj ? [0, 4, 7] : [0, 3, 7];
  if (era === 0) {
    if (i % 4 === 0) tone(ac, out, t, 'square', midi(root - 12 + (i % 8 ? 7 : 0)), st * 1.5, 0.035);
    if (i % 2 === 0) tone(ac, out, t, 'square', midi(root + 12 + tri[(i >> 1) % 3]), st * 0.7, 0.015);
  } else if (era === 1) {
    if (i % 2 === 0) tone(ac, out, t, 'triangle', midi(root - 12 + (i % 4 ? 12 : 0)), st * 1.8, 0.2);
    tone(ac, out, t, 'square', midi(root + 12 + tri[i % 3] + (i & 4 ? 12 : 0)), st * 0.8, 0.035);
    if (i % 4 === 2) noise(ac, out, nb, t, 0.03, 0.06, 7000, 'highpass');
    if (i % 8 === 0) tone(ac, out, t, 'square', 120, 0.08, 0.12, 40);
    if (i % 8 === 4) noise(ac, out, nb, t, 0.1, 0.12, 2500, 'bandpass');
  } else if (era === 2) {
    if (i % 4 === 0) tone(ac, out, t, 'sine', 140, 0.25, 0.4, 40);
    if (i % 8 === 4) noise(ac, out, nb, t, 0.18, 0.22, 1800, 'bandpass');
    if (i % 2 === 1) noise(ac, out, nb, t, 0.03, 0.04, 8000, 'highpass');
    tone(ac, out, t, 'sawtooth', midi(root - 12 + (i % 2 ? 12 : 0)), st * 0.9, 0.07, 0, 900);
    tone(ac, out, t, 'square', midi(root + 12 + [0, 7, 12, tri[1], 7, 12, tri[1] + 12, 7][i % 8]), st * 0.7, 0.03, 0, 3000);
    if (i === 0) for (const n of tri) tone(ac, out, t, 'sawtooth', midi(root + 12 + n), st * 16, 0.018, 0, 1500);
  } else {
    if (i % 4 === 0) tone(ac, out, t, 'sine', 160, 0.22, 0.42, 40);
    if (i % 8 === 4) noise(ac, out, nb, t, 0.16, 0.25, 2200, 'bandpass');
    noise(ac, out, nb, t, 0.025, i % 2 ? 0.05 : 0.025, 9000, 'highpass');
    if (i % 2 === 0) tone(ac, out, t, 'sawtooth', midi(root - (i % 4 ? 12 : 24)), st * 1.6, 0.09, 0, 1200);
    const tones = [root, root + tri[1], root + tri[2], root + 12, root + 12 + tri[1]];
    tone(ac, out, t, 'sawtooth', midi(tones[[0, 1, 2, 3, 4, 3, 2, 1, 2, 3, 4, 3, 2, 1, 2, 3][i]] + 12), st * 0.85, 0.035, 0, 4000);
    if (i % 8 === 0) tone(ac, out, t, 'square', midi(root + 24 + tri[(s >> 3) % 3]), st * 7, 0.025, 0, 3000);
  }
}
function sfx(n) {
  if (TR.mute) return;
  if ((n === 'shot' || n === 'hit' || n === 'graze' || n === 'coin' || n === 'beam')) { if (AU.last[n] > G.frame - 4) return; AU.last[n] = G.frame; }
  if (TR.on) TR.log.push({ f: TR.f, n, e: G.era });
  if (TR.rec || !AU.ac || AU.muted) return;
  playSfx(AU.ac, AU.out, AU.nb, n, G.era, AU.ac.currentTime + 0.01);
}
function audioPump() {
  if (!AU.ac || AU.muted || TR.rec) return;
  const era = TR.on ? (TR.cur ? TR.cur.mus : -1) : (G.state === 'pause' ? -1 : G.era);
  if (era < 0) { AU.mus = null; return; }
  const now = AU.ac.currentTime;
  if (!AU.mus || AU.mus.era !== era) AU.mus = { era, s: 0, t: now + 0.05 };
  const st = 60 / BPM[era] / 4;
  while (AU.mus.t < now + 0.15) { musicStep(AU.ac, AU.out, AU.nb, era, AU.mus.s++, AU.mus.t, st); AU.mus.t += st; }
}

// ================= rendering =================
const $ = id => document.getElementById(id);
const scr = $('scr'), sc = scr.getContext('2d');
const buf = document.createElement('canvas'), bc = buf.getContext('2d', { willReadFrequently: true });
const lcd = document.createElement('canvas'); lcd.width = 96; lcd.height = 64; const lc = lcd.getContext('2d');
lc.fillStyle = '#a8b496'; lc.fillRect(0, 0, 96, 64);
const STARS = []; for (let i = 0; i < 90; i++) STARS.push({ x: Math.random() * W, y: Math.random() * H, z: 0.3 + Math.random() * 1.7, c: ['#ffffff', '#8fd3ff', '#ffd0f0'][i % 3] });
function mkCanvas(w, h, fn) { const c = document.createElement('canvas'); c.width = w; c.height = h; fn(c.getContext('2d'), w, h); return c; }
const GRID0 = mkCanvas(SW, SH, (g) => { g.fillStyle = 'rgba(168,180,150,0.55)'; for (let x = 0; x <= SW; x += 10) g.fillRect(x - 0.75, 0, 1.5, SH); for (let y = 0; y <= SH; y += 10) g.fillRect(0, y - 0.75, SW, 1.5);
  const gr = g.createLinearGradient(0, 0, SW, SH); gr.addColorStop(0, 'rgba(255,255,255,0.10)'); gr.addColorStop(1, 'rgba(0,0,0,0.12)'); g.fillStyle = gr; g.fillRect(0, 0, SW, SH); });
const SCAN1 = mkCanvas(SW, SH, (g) => { g.fillStyle = 'rgba(0,0,0,0.28)'; for (let y = 0; y < SH; y += 5) g.fillRect(0, y + 4, SW, 1); g.fillStyle = 'rgba(0,0,0,0.12)'; for (let x = 0; x < SW; x += 5) g.fillRect(x + 4, 0, 1, SH); });
const NEB = mkCanvas(SW, SH * 2, (g, w, h) => {
  g.fillStyle = '#04020a'; g.fillRect(0, 0, w, h);
  const cols = ['#5a0f6b', '#0d4a6e', '#7a1645', '#21125e'];
  for (let i = 0; i < 26; i++) { const x = Math.random() * w, y = Math.random() * h, r = 120 + Math.random() * 300, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, cols[i % 4] + '88'); gr.addColorStop(1, cols[i % 4] + '00'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }
  for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.8})`; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
});
const SYMS = []; for (let i = 0; i < 26; i++) SYMS.push({ x: Math.random() * W, y: Math.random() * H, s: 8 + Math.random() * 26, r: Math.random() * TAU, ch: '∑∫π∞√∂Δθλ÷'[i % 10], v: 0.15 + Math.random() * 0.4 });

function render() {
  if (G.era <= 1) renderLow(); else renderHi();
  if (G.era > 0 && G.state !== 'title') lcdFilter([0, 0.62, 0.42, 0.32][G.era]);
  syncKeys();
  document.documentElement.style.setProperty('--h', (G.frame * 1.5) % 360);
}

// green calculator-LCD look over the colour eras: tint, green-black lift, pixel grid, glass glare
const GRIDF = mkCanvas(SW, SH, g => { g.fillStyle = 'rgba(20,40,16,0.22)'; for (let x = 0; x < SW; x += 4) g.fillRect(x + 3, 0, 1, SH); for (let y = 0; y < SH; y += 4) g.fillRect(0, y + 3, SW, 1);
  const gr = g.createLinearGradient(0, 0, SW * 0.7, SH); gr.addColorStop(0, 'rgba(255,255,255,0.13)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.02)'); gr.addColorStop(1, 'rgba(0,0,0,0.15)'); g.fillStyle = gr; g.fillRect(0, 0, SW, SH); });
function lcdFilter(k) {
  const c = sc; c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = k;
  c.globalCompositeOperation = 'multiply'; c.fillStyle = '#b4d29a'; c.fillRect(0, 0, SW, SH);
  c.globalCompositeOperation = 'screen'; c.fillStyle = '#1c3016'; c.fillRect(0, 0, SW, SH);
  c.globalCompositeOperation = 'source-over'; c.globalAlpha = Math.min(1, k * 1.6); c.drawImage(GRIDF, 0, 0); c.globalAlpha = 1;
}
// ---------- low-res (LCD) ----------
function renderLow() {
  const e = G.era, [bw, bh] = ERAS[e].res, u = W / bw, c = bc, ink = e === 0 ? '#000' : '#ffffff';
  if (buf.width !== bw) { buf.width = bw; buf.height = bh; }
  c.setTransform(1, 0, 0, 1, 0, 0); c.imageSmoothingEnabled = false;
  c.fillStyle = e === 0 ? '#fff' : '#05060f'; c.fillRect(0, 0, bw, bh);
  if (e === 1) for (const s of STARS) { c.fillStyle = s.z > 1.2 ? s.c : '#3a4470'; c.fillRect(Math.round(s.x / u), Math.round(s.y / u), 1, 1); }
  const st = G.state;
  if (st === 'title') drawTitleLow(c, bw, bh);
  else if (st === 'shop') drawShopLow(c, bw, bh, ink);
  else {
    if (st !== 'upgrade' || G.upT < 90) drawWorldLow(c, u, e);
    drawHudLow(c, bw, bh, e, ink);
    if (G.msg) { const s = G.msg.text, sc2 = s.length < 8 ? 2 : 1; boxLow(c, bw / 2 - w3(s, sc2) / 2 - 3, bh / 2 - 6, w3(s, sc2) + 6, 5 * sc2 + 6, e); txt3(c, s, bw / 2 - w3(s, sc2) / 2, bh / 2 - 3, ink, sc2); }
    if (G.phase === 'warn' && (G.warnT >> 3) % 2) { const s = '!! BOSS !!'; boxLow(c, bw / 2 - 24, 18, 48, 11, e); txt3(c, s, bw / 2 - w3(s) / 2, 21, e ? '#ff4060' : ink); }
    if (st === 'pause') { boxLow(c, bw / 2 - 22, bh / 2 - 10, 44, 20, e); txt3(c, 'PAUSED', bw / 2 - w3('PAUSED') / 2, bh / 2 - 7, ink); txt3(c, 'CLR:QUIT', bw / 2 - w3('CLR:QUIT') / 2, bh / 2 + 1, ink); }
    if (st === 'over') { c.fillStyle = e ? '#05060f' : '#fff'; c.fillRect(0, 0, bw, bh); txt3(c, 'ERR:SHIELDS', 1, 1, ink); txt3(c, '1:RETRY', 1, 8, ink); txt3(c, '2:QUIT', 1, 15, ink); txt3(c, 'SCORE ' + G.score, 1, 29, ink); }
    if (st === 'upgrade') drawUpgradeLow(c, bw, bh, e, ink);
  }
  if (e === 1 && G.flash > 0) { c.fillStyle = `rgba(255,255,255,${G.flash / 14})`; c.fillRect(0, 0, bw, bh); }
  sc.setTransform(1, 0, 0, 1, 0, 0); sc.imageSmoothingEnabled = false; sc.globalAlpha = 1; sc.globalCompositeOperation = 'source-over';
  if (e === 0) {
    const id = c.getImageData(0, 0, bw, bh), d = id.data, inv = G.flash > 0 && (G.flash & 2);
    for (let i = 0; i < d.length; i += 4) { const on = (d[i] + d[i + 1] + d[i + 2] < 384) !== !!inv; d[i] = on ? 28 : 168; d[i + 1] = on ? 36 : 180; d[i + 2] = on ? 26 : 150; d[i + 3] = 255; }
    c.putImageData(id, 0, 0);
    lc.globalAlpha = 0.6; lc.drawImage(buf, 0, 0); lc.globalAlpha = 1;
    const sx = G.shake ? Math.round(Math.sin(G.frame * 7.1) * G.shake * 0.3) * 10 : 0;
    sc.fillStyle = '#a8b496'; sc.fillRect(0, 0, SW, SH);
    sc.drawImage(lcd, sx, 0, SW, SH); sc.drawImage(GRID0, 0, 0);
  } else {
    const sx = G.shake ? Math.round(Math.sin(G.frame * 7.1) * G.shake * 0.4) * 5 : 0, sy = G.shake ? Math.round(Math.cos(G.frame * 5.3) * G.shake * 0.4) * 5 : 0;
    sc.fillStyle = '#05060f'; sc.fillRect(0, 0, SW, SH);
    sc.drawImage(buf, sx, sy, SW, SH); sc.drawImage(SCAN1, 0, 0);
    if (st === 'upgrade' && G.upT < 90) glitch(G.upT / 90);
  }
  if (e === 0 && st === 'upgrade' && G.upT < 90) glitch(G.upT / 90);
}
function boxLow(c, x, y, w, h, e) { c.fillStyle = e ? '#ffffff' : '#000'; c.fillRect(x - 1, y - 1, w + 2, h + 2); c.fillStyle = e ? '#101530' : '#fff'; c.fillRect(x, y, w, h); }
function drawSprLow(c, name, x, y, u, ps, main, hi) { const img = sprImg(name, main, hi), k = ps / u; c.drawImage(img, Math.round(x / u - img.width * k / 2), Math.round(y / u - img.height * k / 2), img.width * k, img.height * k); }
function drawWorldLow(c, u, e) {
  const R = v => Math.round(v / u), mono = e === 0, p = G.p;
  for (const en of G.en) {
    if (en.delay > 0) continue;
    const t = T[en.type];
    if (mono && en.flash & 1) continue;
    if (t.spr) { const fr = t.spr[(G.frame >> 4) % t.spr.length], col = t.col || ['#cccccc', '#ffffff']; drawSprLow(c, fr, en.x, en.y, u, t.ps, mono ? '#000' : en.flash ? '#fff' : col[0], mono ? '#000' : col[1]); }
    else { c.fillStyle = mono ? '#000' : colorOf(en); c.fillRect(R(en.x - en.r * 0.6), R(en.y - en.r * 0.6), R(en.r * 1.2), R(en.r * 1.2)); }
  }
  for (const l of G.lz) {
    c.strokeStyle = mono ? '#000' : l.c; c.lineWidth = l.t > l.warn ? Math.max(1, l.w / u) : 1;
    if (l.t <= l.warn && (l.t >> 2) % 2) continue;
    c.beginPath(); c.moveTo(R(l.x), R(l.y)); c.lineTo(R(l.x + Math.cos(l.a) * 600), R(l.y + Math.sin(l.a) * 600)); c.stroke();
  }
  for (const it of G.items) { c.fillStyle = mono ? '#000' : '#ffd23a'; c.fillRect(R(it.x), R(it.y), 2, 2); }
  if (!p.dead && !(p.inv > 0 && !G.god && (G.frame & 4))) {
    if (mono) drawSprLow(c, 'ship0', p.x, p.y, u, 3.6, '#000', '#000'); else drawSprLow(c, 'ship1', p.x, p.y, u, 2, '#5cd6ff', '#ffffff');
  }
  if (p.beam > 0 && !p.dead) { c.fillStyle = mono ? '#000' : '#ffe14a'; const bw = Math.max(1, R(I.focus ? 6 : 10)); c.fillRect(R(p.x) - (bw >> 1), 0, bw, R(p.y - 8)); }
  for (const o of G.orbs) { c.fillStyle = mono ? '#000' : '#ffffff'; c.fillRect(R(o.x) - 1, R(o.y) - 1, 3, 3); }
  for (const b of G.pb) {
    c.fillStyle = mono ? '#000' : b.k === 'missile' ? '#8ff' : '#ffef6a';
    if (b.k === 'laser') c.fillRect(R(b.x), R(b.y) - 3, 1, 6); else if (b.k === 'missile') c.fillRect(R(b.x), R(b.y), 2, 2); else c.fillRect(R(b.x), R(b.y) - 1, 1, 2);
  }
  for (const b of G.eb) {
    c.fillStyle = mono ? '#000' : b.c;
    const s = b.k === 'big' ? 3 : b.k === 'orb' || b.k === 'star' ? 2 : 1;
    if (mono && s === 1) c.fillRect(R(b.x), R(b.y) - 1, 1, 2); else c.fillRect(R(b.x) - (s >> 1), R(b.y) - (s >> 1), s + (mono ? 0 : 1), s + (mono ? 0 : 1));
  }
  for (const q of G.parts) { if (mono && q.life < 6) continue; c.fillStyle = mono ? '#000' : q.c; c.fillRect(R(q.x), R(q.y), 1, 1); }
  if (!mono) for (const f of G.fx) if (f.k === 'txt') txt3(c, f.text, R(f.x) - w3(f.text) / 2, R(f.y), '#ffffffaa');
}
function drawHudLow(c, bw, bh, e, ink) {
  const p = G.p;
  txt3(c, '$' + G.money, 1, 1, e ? '#ffd23a' : ink);
  if (e) txt3(c, String(G.score).padStart(7, '0'), bw / 2 - 13, 1, ink);
  for (let i = 0; i < p.maxhp; i++) { const x = bw - 1 - (p.maxhp - i) * 4; c.fillStyle = e ? '#5cd6ff' : ink; c.fillRect(x, 1, 3, 3); if (i >= p.hp) { c.fillStyle = e ? '#05060f' : '#fff'; c.fillRect(x + 1, 2, 1, 1); } }
  if (e) { for (let i = 0; i < G.bombs; i++) txt3(c, 'B', 1 + i * 5, bh - 6, '#ff4fd8'); const wn = WEAPONS.find(w => w.id === G.weapon).name; txt3(c, wn, bw - w3(wn) - 1, bh - 6, '#8ff'); }
  const bs = G.en.filter(x => !x.dead && T[x.type].boss);
  if (bs.length) { const hp = bs.reduce((a, b) => a + Math.max(0, b.hp), 0) / G.bossMax; c.fillStyle = e ? '#ff5a5a' : ink; c.fillRect(1, 7, Math.ceil((bw - 2) * clamp(hp, 0, 1)), e ? 2 : 1); }
}
function drawTitleLow(c, bw, bh) {
  for (let i = 0; i < 14; i++) { const s = STARS[i]; c.fillStyle = '#000'; c.fillRect(Math.round(s.x / 4), Math.round((s.y + G.frame * s.z * 0.2) / 4) % bh, 1, 1); }
  txt3(c, 'PHOENIX', bw / 2 - w3('PHOENIX', 2) / 2, 3, '#000', 2);
  txt3(c, 'INFINITY', bw / 2 - w3('INFINITY') / 2, 15, '#000');
  const items = ['START GAME', 'WATCH TRAILER', 'LEVEL < ' + G.titleLvl + ' >'];
  items.forEach((s, i) => { const y = 29 + i * 7; if (G.menu === i) { c.fillStyle = '#000'; c.fillRect(14, y - 1, 68, 7); txt3(c, s, 16, y, '#fff'); } else txt3(c, s, 16, y, '#000'); });
  txt3(c, 'HI ' + G.hi, 1, bh - 13, '#000');
  txt3(c, 'AFTER P.DAVIDSON', 1, bh - 6, '#000');
}
function drawShopLow(c, bw, bh, ink) {
  const e = G.era, L = shopItems(), bg = e ? '#05060f' : '#fff';
  c.fillStyle = e ? '#2a3a80' : '#000'; c.fillRect(0, 0, bw, 7);
  txt3(c, 'SHOP', 1, 1, '#fff'); const m = '$' + G.money; txt3(c, m, bw - w3(m) - 1, 1, e ? '#ffd23a' : '#fff');
  const rows = e ? 15 : 7;
  if (G.menu < G.scroll) G.scroll = G.menu; if (G.menu >= G.scroll + rows) G.scroll = G.menu - rows + 1;
  for (let i = 0; i < rows && i + G.scroll < L.length; i++) {
    const it = L[i + G.scroll], y = 9 + i * 7, sel = i + G.scroll === G.menu;
    if (sel) { c.fillStyle = e ? '#5cd6ff' : '#000'; c.fillRect(0, y - 1, bw, 7); }
    const col = sel ? bg : ink;
    txt3(c, (i + G.scroll + 1) % 10 + ':' + it.label, 1, y, col);
    if (it.right) txt3(c, it.right, bw - w3(it.right) - 1, y, sel ? bg : it.right[0] === '$' && G.money < it.cost ? (e ? '#ff5a5a' : ink) : (e ? '#8ff' : ink));
  }
  if (e) { const d = L[G.menu].d || ''; txt3(c, d.slice(0, 47), 1, bh - 13, '#ffd23a'); txt3(c, 'SHIELD ' + G.p.hp + '/' + G.p.maxhp + '  BOMBS ' + G.bombs, 1, bh - 6, '#8ff'); }
  else txt3(c, 'CLEAR:DONE', 1, bh - 6, ink);
}
function drawUpgradeLow(c, bw, bh, e, ink) {
  const t = G.upT;
  if (t < 110) {
    boxLow(c, 8, bh / 2 - 14, bw - 16, 28, e);
    txt3(c, 'SYSTEM UPGRADE', bw / 2 - w3('SYSTEM UPGRADE') / 2, bh / 2 - 11, ink);
    const d = DRIVERS[G.upTo]; txt3(c, d.slice(0, Math.floor(t / 3)), 11, bh / 2 - 4, ink);
    c.fillStyle = ink; c.fillRect(11, bh / 2 + 4, Math.floor((bw - 22) * Math.min(1, t / 85)), 3);
  }
}
function glitch(k) {
  for (let i = 0; i < 4 + k * 14; i++) {
    const y = Math.floor(rndv(i * 7 + G.frame) * SH), h = 4 + rndv(i * 13 + G.frame) * 40 * k, dx = (rndv(i * 31 + G.frame) - 0.5) * 120 * k;
    sc.drawImage(scr, 0, y, SW, h, dx, y, SW, h);
  }
  if (k > 0.6) { sc.globalCompositeOperation = 'lighter'; sc.fillStyle = `rgba(${G.frame % 2 ? 255 : 0},60,${G.frame % 2 ? 80 : 255},${(k - 0.6) * 0.5})`; sc.fillRect(0, 0, SW, SH); sc.globalCompositeOperation = 'source-over'; }
}
function rndv(n) { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); }

// ---------- hi-res (vector glow) ----------
const BS = {};
function bsprite(k, c) {
  const key = k + c; if (BS[key]) return BS[key];
  const r = BR[k], sz = Math.ceil((r * 2 + 8) * S), m = sz / 2, R = r * S;
  return (BS[key] = mkCanvas(sz, sz, g => {
    const gr = g.createRadialGradient(m, m, R * 0.3, m, m, m); gr.addColorStop(0, c); gr.addColorStop(0.55, c + '55'); gr.addColorStop(1, c + '00');
    g.fillStyle = gr; g.translate(m, m);
    if (k === 'rice' || k === 'knife') g.scale(1.7, 0.75);
    g.beginPath(); g.arc(0, 0, m * 0.9, 0, TAU); g.fill();
    g.fillStyle = c; g.beginPath();
    if (k === 'star') { for (let i = 0; i < 10; i++) { const a = i * TAU / 10, rr2 = i % 2 ? R * 0.5 : R * 1.25; g.lineTo(Math.cos(a) * rr2, Math.sin(a) * rr2); } }
    else if (k === 'knife') { g.moveTo(R * 1.2, 0); g.lineTo(-R, R * 0.8); g.lineTo(-R * 0.5, 0); g.lineTo(-R, -R * 0.8); }
    else g.arc(0, 0, R, 0, TAU);
    g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(0, 0, R * 0.55, 0, TAU); g.fill();
  }));
}
const HALO = {};
function halo(c, x, y, r, col, a = 0.55) {
  const sp = HALO[col] || (HALO[col] = mkCanvas(64, 64, g => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, col + 'aa'); gr.addColorStop(0.4, col + '44'); gr.addColorStop(1, col + '00'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }));
  const o = c.globalCompositeOperation, oa = c.globalAlpha; c.globalCompositeOperation = 'lighter'; c.globalAlpha = a; c.drawImage(sp, x - r, y - r, r * 2, r * 2); c.globalCompositeOperation = o; c.globalAlpha = oa;
}
function renderHi() {
  const e = G.era, c = sc, st = G.state;
  c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.shadowBlur = 0;
  if (st === 'title') { renderLow(); return; }
  drawBgHi(c, e);
  const sx = G.shake ? Math.sin(G.frame * 7.1) * G.shake * 0.6 : 0, sy = G.shake ? Math.cos(G.frame * 5.3) * G.shake * 0.6 : 0;
  c.setTransform(S, 0, 0, S, sx * S, sy * S);
  if (st !== 'shop' && (st !== 'upgrade' || G.upT >= 90)) drawWorldHi(c, e);
  c.setTransform(S, 0, 0, S, 0, 0); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
  if (st === 'shop') drawShopHi(c, e);
  else {
    drawHudHi(c, e);
    if (G.msg) bigText(c, G.msg.text, W / 2, H / 2, 22, '#ffffff', Math.min(1, G.msg.t / 20));
    if (G.phase === 'warn') drawWarn(c, e);
    if (st === 'pause') { c.fillStyle = '#000a'; c.fillRect(0, 0, W, H); bigText(c, 'PAUSED', W / 2, H / 2 - 6, 24, '#fff', 1); bigText(c, 'ENTER resume · CLEAR quit', W / 2, H / 2 + 16, 8, '#8ff', 1); }
    if (st === 'over') { c.fillStyle = '#000c'; c.fillRect(0, 0, W, H); bigText(c, 'ERR:SHIELDS', W / 2, H / 2 - 20, 30, '#ff4060', 1); bigText(c, '1: RETRY      2: QUIT', W / 2, H / 2 + 14, 11, '#fff', 1); bigText(c, 'SCORE ' + G.score, W / 2, H / 2 + 34, 9, '#ffd24a', 1); }
    if (st === 'win') { c.fillStyle = '#000b'; c.fillRect(0, 0, W, H); bigText(c, 'PHOENIX ∞', W / 2, H / 2 - 30, 34, '#ffd24a', 1); bigText(c, 'ALL ERAS CLEARED', W / 2, H / 2 + 4, 12, '#fff', 1); bigText(c, 'SCORE ' + G.score + '   GRAZE ' + G.graze, W / 2, H / 2 + 24, 9, '#7dfcff', 1); }
    if (st === 'upgrade') drawUpgradeHi(c, e);
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
  if (G.flash > 0) { c.fillStyle = `rgba(255,255,255,${Math.min(0.8, G.flash / 14)})`; c.fillRect(0, 0, SW, SH); }
  const vg = c.createRadialGradient(SW / 2, SH / 2, SH * 0.45, SW / 2, SH / 2, SW * 0.62); vg.addColorStop(0, '#0000'); vg.addColorStop(1, '#000a'); c.fillStyle = vg; c.fillRect(0, 0, SW, SH);
  if (st === 'upgrade' && G.upT < 90) glitch(G.upT / 90);
}
function drawBgHi(c, e) {
  if (e === 2) {
    const g = c.createLinearGradient(0, 0, 0, SH); g.addColorStop(0, '#07010f'); g.addColorStop(0.6, '#1e0430'); g.addColorStop(1, '#2d0838'); c.fillStyle = g; c.fillRect(0, 0, SW, SH);
    c.setTransform(S, 0, 0, S, 0, 0);
    for (const s of STARS) { c.fillStyle = s.c; c.globalAlpha = 0.3 + s.z * 0.3; c.fillRect(s.x, s.y, s.z * 0.6, s.z * 0.6); }
    const hy = H * 0.58; c.globalAlpha = 0.28;
    const sg = c.createLinearGradient(0, hy - 60, 0, hy); sg.addColorStop(0, '#ffd24a'); sg.addColorStop(1, '#ff3df2'); c.fillStyle = sg;
    c.beginPath(); c.arc(W / 2, hy, 56, Math.PI, 0); c.fill();
    c.fillStyle = '#1e0430'; for (let i = 0; i < 6; i++) c.fillRect(W / 2 - 60, hy - 6 - i * 8, 120, 1.5 + i * 0.4);
    c.globalAlpha = 0.35; c.strokeStyle = '#ff3df2'; c.lineWidth = 0.7; c.beginPath();
    for (let i = -12; i <= 12; i++) { c.moveTo(W / 2 + i * 6, hy); c.lineTo(W / 2 + i * 60, H); }
    const off = (G.frame * 0.02) % 1;
    for (let i = 0; i < 12; i++) { const z = (i + off) / 12, y = hy + (H - hy) * z * z; c.moveTo(0, y); c.lineTo(W, y); }
    c.stroke(); c.globalAlpha = 1;
  } else {
    const off = (G.frame * 0.6) % (SH * 2); c.drawImage(NEB, 0, off - SH * 2, SW, SH * 2); c.drawImage(NEB, 0, off, SW, SH * 2);
    c.setTransform(S, 0, 0, S, 0, 0);
    for (const s of STARS) { c.fillStyle = s.c; c.globalAlpha = 0.4 + s.z * 0.3; c.fillRect(s.x, s.y, 0.8, s.z * 2.5); }
    c.globalAlpha = 0.1;
    for (const m of SYMS) { m.y += m.v; m.r += 0.004; if (m.y > H + 30) { m.y = -30; m.x = Math.random() * W; } const ca = Math.cos(m.r) * S, sa = Math.sin(m.r) * S; c.setTransform(ca, sa, -sa, ca, m.x * S, m.y * S); c.drawImage(symSprite(m.ch), -m.s / 2, -m.s / 2, m.s, m.s); }
    c.setTransform(S, 0, 0, S, 0, 0);
    const b = G.en.find(x => x.type === 'infinity' && !x.dead);
    if (b) drawMagicCircle(c, b.x, b.y, 92, G.frame);
    c.globalAlpha = 1;
  }
}
const SYMC = {};
function symSprite(ch) { return SYMC[ch] || (SYMC[ch] = mkCanvas(96, 96, g => { g.fillStyle = '#b28cff'; g.font = '80px "Hiragino Mincho ProN", serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ch, 48, 52); })); }
const MC = [];
function magicLayers() {
  const R = 92 * S, sz = Math.ceil(R * 2 + 20), m = sz / 2;
  MC[0] = mkCanvas(sz, sz, g => {
    g.translate(m, m); g.strokeStyle = '#ff5fa2'; g.lineWidth = S;
    g.beginPath(); g.arc(0, 0, R, 0, TAU); g.stroke(); g.beginPath(); g.arc(0, 0, R * 0.82, 0, TAU); g.stroke();
    for (let k = 0; k < 2; k++) { g.beginPath(); for (let i = 0; i <= 3; i++) { const a = i * TAU / 3 + k * Math.PI / 3; g.lineTo(Math.cos(a) * R * 0.8, Math.sin(a) * R * 0.8); } g.stroke(); }
    g.fillStyle = '#ffd24a'; g.font = `${9 * S}px "Hiragino Mincho ProN", serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const str = [...'∑∫∂∞√πΔθ無限∑∫∂∞√πΔθ無限'];
    str.forEach((ch, i) => { g.save(); g.rotate(i * TAU / str.length); g.translate(0, -R * 0.91); g.fillText(ch, 0, 0); g.restore(); });
  });
  MC[1] = mkCanvas(sz, sz, g => {
    g.translate(m, m); g.strokeStyle = '#7dfcff'; g.lineWidth = S;
    g.beginPath(); g.arc(0, 0, R * 0.45, 0, TAU); g.stroke();
    for (let i = 0; i < 8; i++) { const a = i * TAU / 8; g.beginPath(); g.moveTo(Math.cos(a) * R * 0.45, Math.sin(a) * R * 0.45); g.lineTo(Math.cos(a + 0.4) * R * 0.8, Math.sin(a + 0.4) * R * 0.8); g.stroke(); }
  });
}
function drawMagicCircle(c, x, y, r, t) {
  if (!MC.length) magicLayers();
  c.save(); c.globalAlpha = 0.3; c.globalCompositeOperation = 'lighter';
  for (const [img, rot] of [[MC[0], t * 0.01], [MC[1], -t * 0.015]]) {
    const ca = Math.cos(rot), sa = Math.sin(rot), w = img.width / S;
    c.setTransform(ca * S, sa * S, -sa * S, ca * S, x * S, y * S); c.drawImage(img, -w / 2, -w / 2, w, w);
  }
  c.restore();
}
function poly(c, n, r, rot) { c.beginPath(); for (let i = 0; i < n; i++) { const a = rot + i * TAU / n - PI2; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); } c.closePath(); }
function drawEnemyHi(c, e) {
  const t = T[e.type], s = t.shape;
  if (!s) { // bitmap enemy in a hi era: draw glowing sprite
    const img = sprImg(t.spr[0], t.col ? t.col[0] : '#ffffff', t.col ? t.col[1] : '#ffffff'); c.drawImage(img, e.x - img.width * t.ps / 2, e.y - img.height * t.ps / 2, img.width * t.ps, img.height * t.ps); return;
  }
  const col = e.flash ? '#ffffff' : s.c;
  halo(c, e.x, e.y, e.r * (s.boss2 || s.boss3 ? 3 : 2.3), s.c);
  c.save(); c.translate(e.x, e.y); c.shadowColor = s.c; c.shadowBlur = 0; c.strokeStyle = col; c.fillStyle = s.c + '33'; c.lineWidth = 1.4;
  if (s.n) { poly(c, s.n, e.r, e.t * (s.spin || 0)); c.fill(); c.stroke(); poly(c, s.n, e.r * 0.45, -e.t * (s.spin || 0) * 2); c.stroke(); }
  else if (s.eye) {
    c.beginPath(); c.ellipse(0, 0, e.r * 1.3, e.r * 0.8, 0, 0, TAU); c.fill(); c.stroke();
    const a = Math.atan2(G.p.y - e.y, G.p.x - e.x); c.fillStyle = col; c.beginPath(); c.arc(Math.cos(a) * 5, Math.sin(a) * 3, 5, 0, TAU); c.fill();
    c.fillStyle = '#000'; c.beginPath(); c.arc(Math.cos(a) * 6, Math.sin(a) * 3.5, 2, 0, TAU); c.fill();
  } else if (s.seraph) {
    const f = Math.sin(e.t * 0.15) * 0.25;
    for (const sd of [-1, 1]) for (let i = 0; i < 3; i++) { c.beginPath(); c.ellipse(sd * (10 + i * 5), -2 + i * 3, 9 - i * 2, 3, sd * (0.5 + f + i * 0.25), 0, TAU); c.fill(); c.stroke(); }
    c.beginPath(); for (let i = 0; i < 12; i++) { const a = i * TAU / 12 + e.t * 0.03, r2 = i % 2 ? 5 : 11; c.lineTo(Math.cos(a) * r2, Math.sin(a) * r2); } c.closePath(); c.fillStyle = col; c.fill();
    c.beginPath(); c.ellipse(0, -15, 8, 2.5, 0, 0, TAU); c.stroke();
  } else if (s.bloom) {
    for (let i = 0; i < 8; i++) { c.save(); c.rotate(i * TAU / 8 + e.t * 0.02); c.beginPath(); c.ellipse(0, -e.r * 0.6, 5, e.r * 0.55, 0, 0, TAU); c.fill(); c.stroke(); c.restore(); }
    c.fillStyle = col; c.beginPath(); c.arc(0, 0, 5, 0, TAU); c.fill();
  } else if (s.boss2) {
    c.rotate(e.t * 0.01);
    for (let i = 0; i < 4; i++) { c.save(); c.rotate(i * PI2 + e.t * 0.02); c.beginPath(); c.moveTo(14, 0); c.lineTo(44, -4); c.lineTo(52, 0); c.lineTo(44, 4); c.closePath(); c.fillStyle = '#ff3df244'; c.fill(); c.strokeStyle = e.flash ? '#fff' : '#ff3df2'; c.stroke(); c.strokeRect(46, -5, 10, 10); c.restore(); }
    poly(c, 8, e.r, 0); c.fill(); c.stroke(); poly(c, 8, e.r * 0.6, -e.t * 0.03); c.stroke();
    c.fillStyle = col; c.font = 'bold 9px Menlo, monospace'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.shadowBlur = 0; c.fillText('E', 0, 0);
  } else if (s.boss3) {
    c.lineWidth = 2.2; const sc2 = 26, pulse = 1 + Math.sin(e.t * 0.08) * 0.05;
    c.beginPath(); for (let i = 0; i <= 80; i++) { const a = i / 80 * TAU, d = 1 + Math.sin(a) ** 2; c.lineTo(sc2 * 1.5 * Math.cos(a) / d * pulse, sc2 * Math.sin(a) * Math.cos(a) / d * pulse); } c.closePath(); c.fillStyle = '#ff5fa222'; c.fill(); c.stroke();
    for (let k = 0; k < 3; k++) { c.save(); c.rotate(e.t * (0.02 + k * 0.012) * (k % 2 ? -1 : 1)); c.strokeStyle = ['#ffd24a', '#7dfcff', '#b28cff'][k]; c.lineWidth = 1; c.beginPath(); c.ellipse(0, 0, 34 + k * 7, 10 + k * 4, k, 0, TAU); c.stroke(); c.restore(); }
    c.fillStyle = '#ffffff'; c.beginPath(); c.arc(0, 0, 4.5, 0, TAU); c.fill();
  }
  c.restore();
}
function drawShipHi(c, p, e) {
  halo(c, p.x, p.y, 26, e === 3 ? '#ff5fa2' : '#29f6ff', 0.5);
  c.save(); c.translate(p.x, p.y);
  c.globalCompositeOperation = 'lighter';
  const fl = 10 + Math.sin(G.frame * 0.9) * 3 + (I.up ? 4 : 0), fg = c.createLinearGradient(0, 6, 0, 6 + fl); fg.addColorStop(0, e === 3 ? '#ffd0e8' : '#c8ffff'); fg.addColorStop(1, '#0000');
  c.fillStyle = fg; c.beginPath(); c.moveTo(-3, 6); c.lineTo(3, 6); c.lineTo(0, 6 + fl); c.fill();
  c.globalCompositeOperation = 'source-over';
  c.scale(1 - Math.abs(p.tilt) * 0.2, 1);
  const main = e === 3 ? '#ff9ccc' : '#29f6ff';
  c.shadowColor = main; c.shadowBlur = 0; c.fillStyle = '#0c1c2c'; c.strokeStyle = main; c.lineWidth = 1.3;
  c.beginPath(); c.moveTo(0, -13); c.lineTo(5, 0); c.lineTo(12, 8); c.lineTo(4, 6); c.lineTo(0, 9); c.lineTo(-4, 6); c.lineTo(-12, 8); c.lineTo(-5, 0); c.closePath(); c.fill(); c.stroke();
  if (e === 3) { c.strokeStyle = '#ffd24a'; c.beginPath(); c.moveTo(-12, 8); c.lineTo(-17, 2); c.moveTo(12, 8); c.lineTo(17, 2); c.stroke(); }
  c.fillStyle = '#ffffff'; c.beginPath(); c.ellipse(0, -2, 1.6, 4, 0, 0, TAU); c.fill();
  c.restore();
  if (I.focus || e === 3) {
    const hr = ERAS[e].hit;
    if (I.focus) { c.save(); c.translate(p.x, p.y); c.rotate(G.frame * 0.05); c.strokeStyle = '#ffffff88'; c.lineWidth = 0.8; c.setLineDash([3, 3]); c.beginPath(); c.arc(0, 0, 16, 0, TAU); c.stroke(); c.restore(); }
    c.fillStyle = '#fff'; c.strokeStyle = '#ff2050'; c.lineWidth = 1; c.beginPath(); c.arc(p.x, p.y, hr + 0.6, 0, TAU); c.fill(); c.stroke();
  }
}
function drawWorldHi(c, e) {
  const p = G.p;
  for (const l of G.lz) {
    const x2 = l.x + Math.cos(l.a) * 700, y2 = l.y + Math.sin(l.a) * 700;
    c.save(); c.globalCompositeOperation = 'lighter';
    if (l.t <= l.warn) { c.globalAlpha = 0.35 + 0.35 * Math.sin(l.t * 0.6); c.strokeStyle = l.c; c.lineWidth = 0.8; c.beginPath(); c.moveTo(l.x, l.y); c.lineTo(x2, y2); c.stroke(); }
    else { const k = Math.min(1, (l.t - l.warn) / 6) * Math.min(1, (l.warn + l.life - l.t) / 8); c.globalAlpha = k * 0.3; c.strokeStyle = l.c; c.lineWidth = l.w * 4; c.beginPath(); c.moveTo(l.x, l.y); c.lineTo(x2, y2); c.stroke(); c.globalAlpha = k; c.lineWidth = l.w * 1.6; c.shadowColor = l.c; c.shadowBlur = 0; c.beginPath(); c.moveTo(l.x, l.y); c.lineTo(x2, y2); c.stroke(); c.strokeStyle = '#fff'; c.lineWidth = l.w * 0.45; c.stroke(); }
    c.restore();
  }
  for (const en of G.en) if (en.delay <= 0) drawEnemyHi(c, en);
  if (G.bombT > 0 && e === 2) { const r = (70 - G.bombT) * 8; c.save(); c.globalCompositeOperation = 'lighter'; c.strokeStyle = '#29f6ff'; c.lineWidth = 6; c.globalAlpha = G.bombT / 70; c.shadowColor = '#29f6ff'; c.shadowBlur = 0; c.beginPath(); c.arc(G.bx, G.by, r, 0, TAU); c.stroke(); c.restore(); }
  if (G.bombT > 0 && e === 3) {
    const k = G.bombT, gr = Math.min(1, (150 - k) / 20) * Math.min(1, k / 10);
    c.save(); c.translate(G.bx, G.by); c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) { c.save(); c.rotate(G.frame * (0.08 + i * 0.03)); c.strokeStyle = ['#b28cff', '#ff5fa2', '#7dfcff', '#ffd24a'][i]; c.globalAlpha = 0.7 * gr; c.lineWidth = 2; c.shadowColor = c.strokeStyle; c.shadowBlur = 0; c.beginPath(); c.ellipse(0, 0, (40 + i * 14) * gr, (12 + i * 4) * gr, i * 0.7, 0, TAU); c.stroke(); c.restore(); }
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; c.fillStyle = '#000'; c.shadowColor = '#b28cff'; c.shadowBlur = 0; c.beginPath(); c.arc(0, 0, 18 * gr, 0, TAU); c.fill();
    c.shadowBlur = 0; c.fillStyle = '#fff'; c.font = `bold ${14 * gr}px Menlo, monospace`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('÷0', 0, 1);
    c.restore();
  }
  for (const it of G.items) { c.drawImage(bsprite('dot', '#ffd24a'), it.x - 4.5, it.y - 4.5, 9, 9); }
  c.save(); c.globalCompositeOperation = 'lighter';
  if (p.beam > 0 && !p.dead) {
    const bw = I.focus ? 7 : 12, fl = 0.8 + Math.sin(G.frame * 1.3) * 0.2;
    const g = c.createLinearGradient(p.x - bw, 0, p.x + bw, 0); g.addColorStop(0, '#ffe14a00'); g.addColorStop(0.5, '#ffe14a'); g.addColorStop(1, '#ffe14a00');
    c.fillStyle = g; c.globalAlpha = fl; c.fillRect(p.x - bw * 1.6, 0, bw * 3.2, p.y - 10);
    c.fillStyle = '#ffffff'; c.fillRect(p.x - bw * 0.25, 0, bw * 0.5, p.y - 10); c.globalAlpha = 1;
  }
  if (p.laser && !p.dead) {
    const bw = G.hyper > 0 ? 15 : 9, col = wpn().color || '#7dfcff', top = Math.max(0, p.lend), len = p.y - 12 - top;
    const g = c.createLinearGradient(p.x - bw * 1.8, 0, p.x + bw * 1.8, 0); g.addColorStop(0, col + '00'); g.addColorStop(0.5, col); g.addColorStop(1, col + '00');
    c.fillStyle = g; c.globalAlpha = 0.85 + Math.sin(G.frame * 1.7) * 0.15; c.fillRect(p.x - bw * 1.8, top, bw * 3.6, len);
    c.fillStyle = '#ffffff'; c.fillRect(p.x - bw * 0.3, top, bw * 0.6, len);
    for (let y = p.y - 12 - ((G.frame * 9) % 24); y > top; y -= 24) { c.globalAlpha = 0.9; c.fillStyle = col; c.beginPath(); c.ellipse(p.x, y, bw * 1.3, 4, 0, 0, TAU); c.fill(); }
    c.globalAlpha = 0.5; c.strokeStyle = col; c.lineWidth = 1.2; c.beginPath(); c.arc(p.x, p.y, 16 + Math.sin(G.frame * 0.5) * 2, 0, TAU); c.stroke();
    if (p.lend > 0) { c.globalAlpha = 0.9; c.drawImage(bsprite('big', col), p.x - 16, top - 16, 32, 32); }
    c.globalAlpha = 1;
  }
  if (G.hyper > 0 && !p.dead) { c.globalAlpha = 0.35 + 0.15 * Math.sin(G.frame * 0.4); c.drawImage(bsprite('big', hsl(G.frame * 8)), p.x - 30, p.y - 30, 60, 60); c.globalAlpha = 1; }
  for (const b of G.pb) {
    if (b.k === 'missile') { c.fillStyle = e === 3 ? '#ffd0e8' : '#bfffff'; c.save(); c.translate(b.x, b.y); c.rotate(Math.atan2(b.vy, b.vx)); c.fillRect(-4, -1.2, 8, 2.4); c.restore(); }
    else if (b.k === 'orb') c.drawImage(bsprite('orb', '#ff9ccc'), b.x - 6, b.y - 6, 12, 12);
    else if (b.k === 'wave') c.drawImage(bsprite('orb', '#7dfcff'), b.x - 5, b.y - 5, 10, 10);
    else { c.fillStyle = b.k === 'laser' ? '#ff6af0' : '#ffe98a'; const L = b.k === 'laser' ? 22 : 9; c.fillRect(b.x - 1.3, b.y - L / 2, 2.6, L); c.fillStyle = '#fff'; c.fillRect(b.x - 0.5, b.y - L / 2, 1, L); }
  }
  for (const o of G.orbs) { c.drawImage(bsprite('big', '#ffd24a'), o.x - 11, o.y - 11, 22, 22); }
  c.restore();
  if (!p.dead && !(p.inv > 0 && !G.god && (G.frame & 4))) drawShipHi(c, p, e);
  for (const b of G.eb) {
    const sp = bsprite(b.k, b.c), w = sp.width / S, ca = Math.cos(b.k === 'star' ? b.t * 0.1 : b.a), sa = Math.sin(b.k === 'star' ? b.t * 0.1 : b.a);
    c.setTransform(ca * S, sa * S, -sa * S, ca * S, (b.x + (G.shake ? Math.sin(G.frame * 7.1) * G.shake * 0.6 : 0)) * S, (b.y + (G.shake ? Math.cos(G.frame * 5.3) * G.shake * 0.6 : 0)) * S);
    c.drawImage(sp, -w / 2, -w / 2, w, w);
  }
  const sx = G.shake ? Math.sin(G.frame * 7.1) * G.shake * 0.6 : 0, sy = G.shake ? Math.cos(G.frame * 5.3) * G.shake * 0.6 : 0;
  c.setTransform(S, 0, 0, S, sx * S, sy * S);
  c.globalCompositeOperation = 'lighter';
  for (const q of G.parts) { c.globalAlpha = q.life / q.max; c.fillStyle = q.c; c.fillRect(q.x - q.s / 2, q.y - q.s / 2, q.s, q.s); }
  c.globalAlpha = 1;
  for (const f of G.fx) {
    if (f.k === 'ring') { c.globalAlpha = f.life / f.max; c.strokeStyle = f.c; c.lineWidth = 2 * f.life / f.max + 0.5; c.beginPath(); c.arc(f.x, f.y, f.r, 0, TAU); c.stroke(); }
    if (f.k === 'txt') { c.globalAlpha = f.life / f.max; c.fillStyle = '#fff'; c.font = '600 6px Menlo, monospace'; c.textAlign = 'center'; c.fillText(f.text, f.x, f.y); }
  }
  c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
}
function bigText(c, s, x, y, size, col, a, font = '"Helvetica Neue", Arial, sans-serif') {
  c.save(); c.globalAlpha = a; c.font = `900 ${size}px ${font}`; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.shadowColor = col; c.shadowBlur = 0; c.fillStyle = col; c.fillText(s, x, y); c.shadowBlur = 0; c.fillStyle = '#fff'; c.globalAlpha = a * 0.6; c.fillText(s, x, y); c.restore();
}
function drawHudHi(c, e) {
  const p = G.p; c.save();
  c.font = '700 8px Menlo, monospace'; c.textBaseline = 'top'; c.textAlign = 'left'; c.shadowBlur = 0;
  c.shadowColor = '#fff'; c.fillStyle = '#fff'; c.fillText('SCORE ' + String(G.score).padStart(9, '0'), 6, 5);
  c.shadowColor = '#ffd24a'; c.fillStyle = '#ffd24a'; c.fillText('$' + G.money, 6, 15);
  if (e === 3) { c.shadowColor = '#7dfcff'; c.fillStyle = '#7dfcff'; c.fillText('GRAZE ' + G.graze, 6, 25); }
  if (e === 3 && G.combo > 0) {
    c.textAlign = 'left'; c.shadowColor = '#ffd24a'; c.fillStyle = '#ffd24a'; c.font = 'italic 900 18px "Helvetica Neue", sans-serif'; c.fillText(String(G.combo), 6, 36);
    const cw = c.measureText(String(G.combo)).width; c.font = 'italic 800 7px "Helvetica Neue", sans-serif'; c.fillStyle = '#fff'; c.fillText('HITS', 9 + cw, 47);
    c.fillStyle = '#ffd24a44'; c.fillRect(6, 56, 50, 2.5); c.fillStyle = '#ffd24a'; c.fillRect(6, 56, 50 * G.comboT / 110, 2.5);
  }
  if (e === 3) {
    c.textAlign = 'center'; c.textBaseline = 'bottom'; c.font = '700 6px Menlo, monospace';
    c.fillStyle = G.hyper > 0 ? hsl(G.frame * 10) : '#ff9ccc'; c.shadowColor = c.fillStyle;
    c.fillText(G.hyper > 0 ? 'HYPER ' + Math.ceil(G.hyper / 60) : 'HYPER ×' + G.hstock, W / 2, H - 9);
    c.fillStyle = '#ffffff22'; c.fillRect(W / 2 - 40, H - 7, 80, 2.5); c.fillStyle = c.shadowColor; c.fillRect(W / 2 - 40, H - 7, 80 * (G.hyper > 0 ? G.hyper / 600 : G.hg / 100), 2.5);
    c.textBaseline = 'top';
  }
  c.textAlign = 'right'; const wn = WEAPONS.find(w => w.id === G.weapon).name; c.shadowColor = '#ff9ccc'; c.fillStyle = '#ff9ccc'; c.fillText(wn, W - 6, 5);
  c.fillText('PWR ' + '■'.repeat(G.power) + '□'.repeat(3 - G.power), W - 6, 15);
  c.textAlign = 'left'; c.textBaseline = 'bottom';
  for (let i = 0; i < p.maxhp; i++) { c.fillStyle = i < p.hp ? '#29f6ff' : '#29f6ff33'; c.shadowColor = '#29f6ff'; c.fillRect(6 + i * 11, H - 9, 9, 4); }
  c.textAlign = 'right'; c.fillStyle = '#ff5fa2'; c.shadowColor = '#ff5fa2'; c.font = '700 9px Menlo, monospace'; c.fillText('◆'.repeat(G.bombs), W - 6, H - 4);
  const bs = G.en.filter(x => !x.dead && T[x.type].boss);
  if (bs.length) {
    const hp = clamp(bs.reduce((a, b) => a + Math.max(0, b.hp), 0) / G.bossMax, 0, 1), t = T[bs[0].type];
    c.shadowBlur = 0; c.fillStyle = '#ffffff22'; c.fillRect(104, 7, W - 208, 3);
    const g = c.createLinearGradient(104, 0, W - 104, 0); g.addColorStop(0, '#ff3d6a'); g.addColorStop(1, '#ffd24a'); c.fillStyle = g; c.fillRect(104, 7, (W - 208) * hp, 3);
    c.font = '700 6px Menlo, monospace'; c.textAlign = 'center'; c.textBaseline = 'top'; c.fillStyle = '#fff'; c.fillText(t.boss + (bs[0].card != null ? '   ' + '★'.repeat(4 - bs[0].card) : ''), W / 2, 12);
  }
  if (G.banner && G.en.some(x => x.type === 'infinity' && !x.dead)) {
    const k = clamp(G.banner.t / 25, 0, 1), x = lerp(W + 100, W - 8, 1 - (1 - k) ** 3);
    c.textAlign = 'right'; c.textBaseline = 'top'; c.shadowColor = '#ff2a6a'; c.shadowBlur = 0;
    c.font = '700 11px "Hiragino Mincho ProN", "Yu Mincho", serif'; c.fillStyle = '#fff'; c.fillText(G.banner.jp, x, 26);
    c.font = 'italic 600 6px "Helvetica Neue", sans-serif'; c.fillStyle = '#ffd24a'; c.fillText(G.banner.en, x, 40);
    if (G.banner.t < 90) { const a = 1 - G.banner.t / 90; c.textAlign = 'center'; c.globalAlpha = a; c.font = `700 ${16 + G.banner.t * 0.1}px "Hiragino Mincho ProN", serif`; c.fillText(G.banner.jp, W / 2, H / 2 - 8); c.globalAlpha = 1; }
  }
  c.restore();
}
function drawWarn(c, e) {
  const t = G.warnT, a = (t >> 3) % 2 ? 1 : 0.5;
  c.save(); c.globalAlpha = a * 0.85;
  for (const y of [H / 2 - 30, H / 2 + 22]) { c.fillStyle = '#300'; c.fillRect(0, y, W, 8); c.fillStyle = '#ff2040'; for (let x = -16; x < W + 16; x += 16) { const o = (G.frame * 0.8) % 16; c.beginPath(); c.moveTo(x + o, y); c.lineTo(x + o + 8, y); c.lineTo(x + o + 4, y + 8); c.lineTo(x + o - 4, y + 8); c.fill(); } }
  c.restore();
  bigText(c, 'WARNING', W / 2, H / 2 - 4, 30, '#ff2040', a);
  bigText(c, e === 3 ? '警告 — 巨大な敵が接近中' : 'A HUGE ENEMY APPROACHES', W / 2, H / 2 + 14, 7, '#ffd24a', a, '"Hiragino Sans", "Helvetica Neue", sans-serif');
}
function drawShopHi(c, e) {
  const L = shopItems();
  c.fillStyle = '#000000b0'; c.fillRect(20, 14, W - 40, H - 28); c.strokeStyle = e === 3 ? '#ff9ccc' : '#29f6ff'; c.lineWidth = 0.8; c.shadowColor = c.strokeStyle; c.shadowBlur = 0; c.strokeRect(20, 14, W - 40, H - 28); c.shadowBlur = 0;
  bigText(c, e === 3 ? 'ARMORY  武器庫' : 'ARMORY', 90, 30, 16, e === 3 ? '#ff9ccc' : '#29f6ff', 1, '"Hiragino Sans", "Helvetica Neue", sans-serif');
  c.font = '700 10px Menlo, monospace'; c.textAlign = 'right'; c.fillStyle = '#ffd24a'; c.fillText('$' + G.money, W - 30, 34);
  const rows = 11;
  if (G.menu < G.scroll) G.scroll = G.menu; if (G.menu >= G.scroll + rows) G.scroll = G.menu - rows + 1;
  for (let i = 0; i < rows && i + G.scroll < L.length; i++) {
    const it = L[i + G.scroll], y = 50 + i * 14, sel = i + G.scroll === G.menu;
    if (sel) { const g = c.createLinearGradient(28, 0, W - 28, 0); g.addColorStop(0, e === 3 ? '#ff5fa2aa' : '#29f6ffaa'); g.addColorStop(1, '#0000'); c.fillStyle = g; c.fillRect(28, y - 9, W - 56, 12); }
    c.font = '700 8px Menlo, monospace'; c.textAlign = 'left'; c.fillStyle = sel ? '#fff' : '#ccd'; c.fillText(it.label, 34, y);
    c.textAlign = 'right'; c.fillStyle = it.right === 'ON' ? '#7dfcff' : it.right && it.right[0] === '$' && G.money < it.cost ? '#ff5a7a' : '#ffd24a'; if (it.right) c.fillText(it.right, W - 34, y);
  }
  c.textAlign = 'left'; c.font = 'italic 600 8px "Helvetica Neue", sans-serif'; c.fillStyle = '#fff'; c.fillText(L[G.menu].d || '', 34, H - 22);
}
function drawUpgradeHi(c, e) {
  const t = G.upT;
  if (t < 110) {
    c.fillStyle = '#000c'; c.fillRect(70, H / 2 - 30, W - 140, 60); c.strokeStyle = '#fff'; c.strokeRect(70, H / 2 - 30, W - 140, 60);
    bigText(c, 'SYSTEM UPGRADE', W / 2, H / 2 - 14, 14, '#fff', 1);
    c.font = '600 8px Menlo, monospace'; c.textAlign = 'left'; c.fillStyle = '#7dfcff'; c.fillText(DRIVERS[G.upTo].slice(0, t / 3 | 0), 80, H / 2 + 4);
    c.fillStyle = '#fff'; c.fillRect(80, H / 2 + 12, (W - 160) * Math.min(1, t / 85), 5);
  } else {
    const k = clamp((t - 90) / 30, 0, 1), a = Math.min(1, (160 - t) / 20);
    bigText(c, ERAS[e].name, W / 2, H / 2 - 10, 20 + 20 * (1 - k) ** 2 + 18, e === 3 ? '#ff5fa2' : '#29f6ff', a);
    bigText(c, ERAS[e].sub, W / 2, H / 2 + 22, 10, '#ffd24a', a, '"Hiragino Sans", "Helvetica Neue", sans-serif');
  }
}

// ================= calculator keypad & input =================
const KEYROWS = [
  [['Y=', 'trailer', 'TRAILER', 'fn'], ['WINDOW', '', '', 'fn'], ['ZOOM', '', '', 'fn'], ['TRACE', '', '', 'fn'], ['GRAPH', 'pause', 'PAUSE', 'fn']],
  [['2ND', 'fire', 'FIRE', 'second'], ['MODE', 'mode', 'WEAPON'], ['DEL', 'clear', 'BACK']],
  [['ALPHA', 'bomb', 'BOMB', 'alpha'], ['X,T,θ,n', 'focus', 'FOCUS'], ['STAT', 'hyper', 'HYPER']],
  [['MATH', ''], ['APPS', ''], ['PRGM', ''], ['VARS', ''], ['CLEAR', 'clear', 'BACK']],
  [['x⁻¹', ''], ['SIN', ''], ['COS', ''], ['TAN', ''], ['^', '']],
  [['x²', ''], [',', ''], ['(', ''], [')', ''], ['÷', '']],
  [['LOG', ''], ['7', '7', '', 'num'], ['8', '8', '', 'num'], ['9', '9', '', 'num'], ['×', '']],
  [['LN', ''], ['4', '4', '', 'num'], ['5', '5', '', 'num'], ['6', '6', '', 'num'], ['−', '']],
  [['STO→', ''], ['1', '1', '', 'num'], ['2', '2', '', 'num'], ['3', '3', '', 'num'], ['+', '']],
  [['ON', 'mute', 'MUTE'], ['0', '0', '', 'num'], ['.', '', '', 'num'], ['(−)', '', '', 'num'], ['ENTER', 'enter', 'SELECT']],
];
const HELD = new Set(['left', 'right', 'up', 'down', 'fire', 'focus']);
const keyEls = {}, keyFlash = {};
(function buildKeys() {
  const box = $('keys');
  const mk = (lbl, k, s, cls) => { const d = document.createElement('div'); d.className = 'k ' + (cls || ''); d.textContent = lbl; if (s) d.dataset.s = s; d.dataset.k = k || 'none'; (keyEls[k] = keyEls[k] || []).push(d); return d; };
  for (const row of KEYROWS) for (const [l, k, s, cls] of row) box.appendChild(mk(l, k, s, cls));
  const pad = document.createElement('div'); pad.className = 'dpad';
  for (const [l, k, cls] of [['▲', 'up', 'u'], ['▼', 'down', 'd'], ['◀', 'left', 'l'], ['▶', 'right', 'r']]) pad.appendChild(mk(l, k, '', cls));
  box.appendChild(pad);
  box.addEventListener('pointerdown', ev => { const el = ev.target.closest('.k'); if (!el) return; ev.preventDefault(); el.setPointerCapture(ev.pointerId); const k = el.dataset.k; if (HELD.has(k)) I[k] = 1; press(k); });
  const up = ev => { const el = ev.target.closest && ev.target.closest('.k'); if (!el) return; const k = el.dataset.k; if (HELD.has(k)) I[k] = 0; };
  box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
})();
function flashKey(k) { keyFlash[k] = 6; }
function syncKeys() {
  for (const k in keyEls) { const on = (HELD.has(k) && I[k]) || keyFlash[k] > 0; if (keyFlash[k] > 0) keyFlash[k]--; for (const el of keyEls[k]) if (el.classList.contains('on') !== !!on) el.classList.toggle('on', !!on); }
}
const KEYMAP = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', KeyA: 'left', KeyD: 'right', KeyW: 'up', KeyS: 'down', KeyZ: 'fire', Space: 'fire', KeyJ: 'fire',
  KeyX: 'bomb', KeyK: 'bomb', ShiftLeft: 'focus', ShiftRight: 'focus', KeyC: 'mode', KeyQ: 'mode', Enter: 'enter', Escape: 'clear', Backspace: 'clear', KeyP: 'pause', KeyT: 'trailer', KeyM: 'mute', KeyV: 'hyper' };
addEventListener('keydown', ev => {
  const k = KEYMAP[ev.code] || (/^Digit[0-9]$/.test(ev.code) ? ev.code[5] : null); if (!k) return;
  ev.preventDefault(); if (HELD.has(k) && !TR.on) I[k] = 1; if (!ev.repeat) press(k);
});
addEventListener('keyup', ev => { const k = KEYMAP[ev.code]; if (k && HELD.has(k) && !TR.on) I[k] = 0; });
addEventListener('blur', () => { for (const k of HELD) I[k] = 0; });

// ================= trailer director =================
const TR = { on: false, rec: false, mute: false, fps: 60, f: 0, sf: 0, cur: null, log: [], total: 0, t0: 0 };
function sandbox(era, lvl, weapon, power, refill, n = 0) {
  setEra(era); G.level = lvl; clearWorld(); G.parts = []; G.state = 'play'; G.phase = 'sandbox';
  G.weapon = weapon; G.owned[weapon] = 1; G.power = power; G.rapid = 2; G.bombs = 3;
  Object.assign(G.p, { x: W / 2, y: H - 30, hp: 5, maxhp: 5, inv: 0, dead: 0, beam: 0, cd: 0, hold: 0, burst: 0, laser: 0 });
  G.combo = 0; G.comboT = 0; G.hyper = 0; G.hstock = 0; G.hg = 0; G.auto = '';
  G.money = [420, 1900, 5200, 12800][era] + lvl * 37; G.refill = refill; G.refillN = n; if (refill) refill();
}
function prerun(n) { TR.mute = true; for (let i = 0; i < n; i++) { autopilot(); tick(); } TR.mute = false; }
function boss(type, card, hpFrac) {
  const e = spawnBoss(type); e.y = type === 'mother' ? 54 : 72; e.t = 200;
  if (card != null) setCard(e, card);
  if (hpFrac != null) e.hp = e.maxhp * hpFrac;
  return e;
}
// Trailer shots. cam: [scale, x, y, rotDeg] at start/end (screen centre sits at 540,760 on the 1080x1920 stage).
// caps: [from, to, text, style]  style: slam | type | glitch | jp | card    lower: [from, to, title, subtitle]
// tr: entry transition — flash | whip | wipe | glitch | invert | punch
const SHOTS = [
  { d: 1.2, mus: -1, calcA: 0, setup() { toTitle(); sfx('boot'); }, caps: [[0.05, 1.2, '1999.', 'type']] },
  { d: 2.0, mus: 0, tr: 'invert', setup() { toTitle(); }, cam: [[1.2, 0, 260], [1.75, 0, 40]], caps: [[0.1, 2.0, 'THE CALCULATOR\nSHOOTER LEGEND', 'slam']], script(f) { if (f === 40) press('down', true); if (f === 80) press('up', true); } },
  { d: 2.4, mus: 0, tr: 'punch', setup() { sandbox(0, 0, 'single', 1, () => grid('drone', 6, 3), 6); prerun(110); }, cam: [[2.2, 0, 0], [1.95, 0, 0]], caps: [[0.1, 2.4, '96×64 PIXELS\nONE BIT', 'type']] },
  { d: 1.8, mus: 0, tr: 'wipe', setup() { sandbox(0, 1, 'single', 1); G.money = 1240; openShop(); }, cam: [[2.2, 0, 0], [2.1, 0, 0, -1]], caps: [[0.05, 0.9, 'EARN CASH', 'slam'], [0.9, 1.8, 'BUY WEAPONS', 'slam']], script(f) { if (f === 18 || f === 36) press('down', true); if (f === 62) press('enter', true); } },
  { d: 2.2, mus: 0, tr: 'whip', setup() { sandbox(0, 2, 'triple', 2); boss('mother'); prerun(40); }, cam: [[2.2, 0, 0], [1.9, 0, 10]], lower: [[0.1, 2.2, 'MOTHERSHIP', 'BOSS · ERA I · MONOCHROME']] },
  { d: 1.5, mus: 0, tr: 'punch', setup() { sandbox(0, 2, 'laser', 2, () => grid('drone', 6, 2)); prerun(60); startUpgrade(1); G.upT = 40; }, cam: [[1.9, 0, 0], [1.55, 0, 40]], caps: [[0.05, 1.5, 'SYSTEM UPGRADE', 'glitch']] },
  { d: 2.2, mus: 1, tr: 'glitch', setup() { sandbox(1, 4, 'homing', 2); boss('divider', null, 0.56); prerun(20); }, cam: [[1.8, 0, 0], [2.15, 0, 0, 1]], caps: [[0.05, 1.0, 'IT EVOLVED.', 'slam']], lower: [[1.0, 2.2, 'THE DIVIDER', 'BOSS · ERA II · SPLITS AT 50%']] },
  { d: 1.4, mus: 1, tr: 'flash', setup() { sandbox(1, 4, 'homing', 2, () => stream('saucer', 8, 'L')); prerun(80); startUpgrade(2); G.upT = 40; }, cam: [[2.15, 0, 0], [1.6, 0, 30, -1]], caps: [[0.05, 1.4, 'AND EVOLVED.', 'slam']] },
  { d: 2.2, mus: 2, tr: 'glitch', setup() { sandbox(2, 6, 'rail', 3); boss('overflow', null, 0.34); prerun(80); }, cam: [[1.9, 0, 0], [2.2, 0, 0, 1]], lower: [[0.1, 2.2, '∫ RAILGUN', 'VS OVERFLOW · ERA III · NEON']] },
  { d: 1.6, mus: 2, tr: 'whip', setup() { sandbox(2, 6, 'wave', 3, () => { grid('eye', 3, 1, 70, 110); zigs('zig', 8); }, 2); prerun(170); }, cam: [[2.2, 0, 0, -1], [2.0, 0, 0]], lower: [[0.05, 1.6, 'SIN() WAVE', 'TWIN SINUSOIDAL STREAMS']] },
  { d: 2.0, mus: 2, tr: 'punch', setup() { sandbox(2, 6, 'wave', 3, () => zigs('zig', 10)); prerun(100); startUpgrade(3); G.upT = 30; }, cam: [[2.2, 0, 0], [1.6, 0, 40]], caps: [[0.95, 2.0, '限界突破<small>LIMIT BREAK</small>', 'jp']] },
  { d: 0.8, mus: 3, tr: 'flash', dim: 1, setup() { sandbox(3, 7, 'swarm', 3, () => vform('swarm', 12), 6); prerun(120); }, cam: [[1.9, 0, 0], [2.0, 0, 0]], caps: [[0, 0.8, '10\nWEAPONS', 'card']] },
  { d: 2.4, mus: 3, tr: 'wipe', setup() { sandbox(3, 7, 'swarm', 3, () => { vform('swarm', 12); grid('seraph', 2, 1, 60, 170); }, 6); G.hstock = 1; prerun(160); G.combo = 87; G.comboT = 110; }, script(f) { if (f === 70) press('hyper', true); }, cam: [[2.0, 0, 0], [2.2, 0, 0, -1]], caps: [[0.05, 1.15, 'TAP = SHOT\nHOLD = LASER', 'slam']], lower: [[1.15, 2.4, 'HYPER', 'CANCEL EVERY BULLET · DOUBLE FIREPOWER']] },
  { d: 1.8, mus: 3, tr: 'whip', auto: 'shot', setup() { sandbox(3, 8, 'orbit', 3, () => { grid('bloom', 3, 1, 60, 110); vform('swarm', 8); }, 4); prerun(140); }, cam: [[2.2, 0, 0, 1], [2.05, 0, 0]], lower: [[0.05, 1.8, 'π ORBIT', 'BLADES EAT BULLETS']] },
  { d: 1.8, mus: 3, tr: 'glitch', setup() { sandbox(3, 8, 'swarm', 3, () => grid('seraph', 3, 1, 50, 110), 2); prerun(220); }, script(f) { if (f === 8) { G.bombs = 3; bomb(); } }, cam: [[2.05, 0, 0], [2.2, 0, 0]], lower: [[0.05, 1.8, '÷0 SINGULARITY', 'DIVIDE BY ZERO. DELETE EVERYTHING.']] },
  { d: 0.8, mus: 3, tr: 'flash', dim: 1, cam: [[2.2, 0, 0], [2.1, 0, 0]], caps: [[0, 0.8, '4\nBOSSES', 'card']] },
  { d: 2.2, mus: 3, tr: 'invert', auto: 'laser', setup() { sandbox(3, 8, 'swarm', 3); boss('infinity', 0); prerun(150); G.banner.t = 0; }, cam: [[1.85, 0, 0], [2.2, 0, 0]], lower: [[0.1, 2.2, '∞ INFINITY', 'FINAL BOSS · 無限の女王']] },
  { d: 1.4, mus: 3, tr: 'whip', auto: 'laser', setup() { sandbox(3, 8, 'orbit', 3); boss('infinity', 1); prerun(170); G.banner.t = 30; }, cam: [[2.2, 0, 0, 1], [2.1, 0, 0, 0]] },
  { d: 1.4, mus: 3, tr: 'glitch', auto: 'laser', setup() { sandbox(3, 8, 'swarm', 3); boss('infinity', 2); prerun(200); G.banner.t = 30; }, cam: [[2.1, 0, 0, -1], [2.2, 0, 0, 0]] },
  { d: 2.6, mus: 3, tr: 'punch', auto: 'laser', setup() { sandbox(3, 8, 'orbit', 3); boss('infinity', 3); prerun(200); G.banner.t = 30; G.combo = 412; G.comboT = 110; G.hyper = 300; }, script(f) { if (f === 60) { const b = G.en.find(e => e.type === 'infinity'); if (b) b.hp = 1; } }, cam: [[2.2, 0, 0, 2], [1.9, 0, 20, 0]] },
  { d: 3.4, mus: -1, tr: 'flash', setup() { sfx('hitcard'); }, cam: [[1.6, 0, 180], [1.5, 0, 200]], title: 1 },
];
function startTrailer(rec) {
  TR.on = true; TR.rec = rec; TR.f = 0; TR.cur = null; TR.log = []; G.trailer = true; G.god = true; seed = 7;
  document.body.classList.add('trailer');
  let f = 0; for (const s of SHOTS) { s.f0 = f; s.n = Math.round(s.d * TR.fps); f += s.n; } TR.total = f;
  for (const k of HELD) I[k] = 0;
  fit(); TR.t0 = performance.now();
}
function trailerStep() {
  if (TR.f >= TR.total) return false;
  const sh = SHOTS.find(s => TR.f >= s.f0 && TR.f < s.f0 + s.n);
  if (sh !== TR.cur) { TR.cur = sh; TR.sf = 0; sh.setup && sh.setup(); G.auto = sh.auto || ''; }
  sh.script && sh.script(TR.sf);
  for (let i = 0; i < 60 / TR.fps; i++) { if (G.state === 'play') autopilot(); else for (const k of HELD) I[k] = 0; tick(); }
  render(); overlay(sh, TR.sf / TR.fps);
  TR.f++; TR.sf++;
  return true;
}
const ease = k => k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
const easeBack = k => { const c = 2.2; return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2; };
// kinetic captions: words / letters are spans animated per frame (deterministic, no CSS animations)
function kinetic(el, cap, lt, fr) {
  const [a, b, text, style] = cap, key = text + style;
  if (el._key !== key) {
    el._key = key; el.className = style;
    if (style === 'jp') el.innerHTML = text;
    else if (style === 'type' || style === 'glitch') el.innerHTML = text.split('\n').map(l => '<div>' + [...l].map(ch => `<span class="w">${ch === ' ' ? '&nbsp;' : ch}</span>`).join('') + '</div>').join('');
    else el.innerHTML = text.split('\n').map(l => '<div>' + l.split(' ').map(w => `<span class="w" data-w="${w}">${w}</span>`).join(' ') + '</div>').join('');
  }
  const out = clamp((b - lt) / 0.16, 0, 1);
  el.style.opacity = 1; el.style.transform = ''; el.style.textShadow = '';
  const spans = el.querySelectorAll('.w');
  if (style === 'jp') {
    const k = clamp((lt - a) / 0.25, 0, 1), sx = Math.sin(fr * 1.7) * 14 * (1 - k), sy = Math.cos(fr * 2.3) * 14 * (1 - k);
    el.style.opacity = Math.min(k * 3, 1) * out; el.style.transform = `translate(${sx}px,${sy}px) scale(${1 + (1 - easeBack(k)) * 2.5 + (1 - out) * 0.4})`;
    return;
  }
  spans.forEach((sp, i) => {
    let tf = '', op = 1;
    if (style === 'type') { op = lt > a + i * 0.045 ? 1 : 0; if (op && lt < a + i * 0.045 + 0.05) tf = 'scale(1.4)'; }
    else if (style === 'glitch') {
      const t = lt - a - i * 0.02; op = t > 0 ? (rndv(fr * 3 + i) < 0.12 ? 0.2 : 1) : 0;
      const j = (rndv(fr + i * 7) - 0.5) * 30 * Math.max(0, 1 - t * 1.2); tf = `translate(${j}px,${(rndv(fr * 2 + i) - 0.5) * j}px)`;
      sp.style.textShadow = `${-6 - Math.abs(j) / 2}px 0 #ff2a6a, ${6 + Math.abs(j) / 2}px 0 #29f6ff`;
    } else {
      const t = lt - a - i * 0.07, k = clamp(t / 0.2, 0, 1), eb = easeBack(k);
      op = clamp(t / 0.06, 0, 1);
      tf = `translateY(${(1 - eb) * -60}px) scale(${1 + (1 - eb) * 2.4}) rotate(${(1 - k) * (i % 2 ? 9 : -9)}deg)`;
      sp.style.filter = k < 1 ? `blur(${(1 - k) * 10}px)` : '';
      if (style === 'card' && /^\d+$/.test(sp.dataset.w)) sp.textContent = Math.round(+sp.dataset.w * clamp(t / 0.3, 0, 1));
    }
    tf += ` translateY(${(1 - out) * -50}px) scale(${1 + (1 - out) * 0.35})`;
    sp.style.opacity = op * out; sp.style.transform = tf;
  });
}
function overlay(sh, lt) {
  const calc = $('calc'), u = ease(clamp(lt / sh.d, 0, 1)), fr = TR.f;
  const a = (sh.cam && sh.cam[0]) || [1, 0, 0, 0], b = (sh.cam && sh.cam[1]) || a;
  let s = lerp(a[0], b[0], u), x = lerp(a[1], b[1], u), y = lerp(a[2], b[2], u), r = lerp(a[3] || 0, b[3] || 0, u);
  const tr = sh.tr || 'flash', tk = clamp(lt / 0.22, 0, 1), ti = 1 - ease(tk);
  let filt = '', flash = 0;
  if (tr === 'punch') s *= 1 + 0.2 * ti;
  if (tr === 'whip') { x += -900 * ti * ti; r += -8 * ti; filt = `blur(${ti * 14}px)`; }
  if (tr === 'glitch' && tk < 1) { x += (rndv(fr) - 0.5) * 80 * ti; filt = `hue-rotate(${rndv(fr * 5) * 360 | 0}deg) saturate(2.5) contrast(1.4)`; }
  if (tr === 'invert' && lt < 0.1) filt = 'invert(1)';
  if (tr === 'flash' || tr === 'punch') flash = 0.85 * ti;
  if (sh.dim) filt = (filt + ' blur(6px) brightness(0.55)').trim();
  const shx = G.shake ? Math.sin(fr * 3.7) * G.shake * 1.5 : 0, shy = G.shake ? Math.cos(fr * 2.6) * G.shake * 1.5 : 0;
  calc.style.transform = `translate(${x + shx}px,${y + shy}px) scale(${s}) rotate(${r}deg)`;
  calc.style.filter = filt; calc.style.opacity = sh.calcA != null ? sh.calcA : 1;
  const wipe = $('wipe'); wipe.style.transform = tr === 'wipe' && tk < 1 ? `skewX(-18deg) translateX(${-30 + ease(tk) * 190}%)` : 'translateX(-300%)';
  const cap = $('cap'), c = (sh.caps || []).find(q => lt >= q[0] && lt < q[1]);
  if (c) { cap.style.display = ''; kinetic(cap, c, lt, fr); } else cap.style.display = 'none';
  const lo = $('lower'), l = (sh.lower || []).find(q => lt >= q[0] && lt < q[1]);
  if (l) {
    const t = lt - l[0], k = clamp(t / 0.18, 0, 1), out = clamp((l[1] - lt) / 0.15, 0, 1), eb = easeBack(k);
    lo.style.opacity = out; lo.style.transform = `translateX(${(1 - out) * -80}px)`;
    const lt1 = lo.querySelector('.lt'), ls = lo.querySelector('.ls'), bar = lo.querySelector('.bar');
    lt1.textContent = l[2]; lt1.style.transform = `scale(${1 + (1 - eb) * 1.8}) rotate(${-3 - (1 - k) * 8}deg)`; lt1.style.opacity = clamp(t / 0.05, 0, 1);
    bar.style.transform = `scaleX(${ease(clamp((t - 0.1) / 0.25, 0, 1))})`;
    ls.textContent = l[3].slice(0, Math.max(0, Math.floor((t - 0.2) * 60)));
  } else lo.style.opacity = 0;
  const tt = $('ttl');
  if (sh.title) {
    tt.style.opacity = clamp(lt / 0.15, 0, 1);
    const t1 = tt.querySelector('.t1');
    if (!t1._built) { t1._built = 1; t1.innerHTML = [...'PHOENIX'].map(ch => `<span class="w">${ch}</span>`).join('') + '<br><span class="w inf">∞</span>'; }
    t1.querySelectorAll('.w').forEach((sp, i) => {
      const t = lt - 0.1 - i * 0.06, k = clamp(t / 0.22, 0, 1), eb = easeBack(k);
      sp.style.opacity = clamp(t / 0.05, 0, 1);
      sp.style.transform = sp.classList.contains('inf') ? `scale(${eb * (1 + Math.sin(lt * 4) * 0.04)}) rotate(${(1 - k) * 540}deg)` : `translateY(${(1 - eb) * -300}px) scale(${1 + (1 - eb)})`;
    });
    const t2 = tt.querySelector('.t2'), t3 = tt.querySelector('.t3');
    t2.style.opacity = clamp((lt - 0.9) / 0.2, 0, 1); t2.style.letterSpacing = `${10 + 30 * (1 - ease(clamp((lt - 0.9) / 0.6, 0, 1)))}px`;
    t3.style.opacity = clamp((lt - 1.5) / 0.2, 0, 1) * (Math.floor(lt * 3) % 2 || lt < 2.4 ? 1 : 0.6);
  } else tt.style.opacity = 0;
  $('flash').style.opacity = Math.max(flash, sh.title && lt < 0.25 ? 1 - lt / 0.25 : 0);
}
function musicSegments() {
  const segs = [];
  for (const s of SHOTS) { const t0 = s.f0 / TR.fps, t1 = (s.f0 + s.n) / TR.fps, last = segs[segs.length - 1]; if (last && last.era === s.mus) last.t1 = t1; else segs.push({ era: s.mus, t0, t1 }); }
  return segs.filter(s => s.era >= 0);
}
window.trailerTotalFrames = () => TR.total;
window.trailerFps = () => TR.fps;
window.trailerFrame = () => trailerStep();
window.renderTrailerAudio = async () => {
  const sr = 44100, dur = TR.total / TR.fps + 1.5, ac = new OfflineAudioContext(2, Math.ceil(sr * dur), sr);
  const out = ac.createGain(); out.gain.value = 0.55; const comp = ac.createDynamicsCompressor(); out.connect(comp).connect(ac.destination);
  const nb = mkNoise(ac);
  for (const sg of musicSegments()) { const st = 60 / BPM[sg.era] / 4; let s = 0; for (let t = sg.t0; t < sg.t1 - 0.02; t += st) musicStep(ac, out, nb, sg.era, s++, t, st); }
  for (const ev of TR.log) playSfx(ac, out, nb, ev.n, ev.e, ev.f / TR.fps + 0.001);
  const ab = await ac.startRendering(), L = ab.getChannelData(0), R = ab.getChannelData(1), n = L.length;
  const wav = new DataView(new ArrayBuffer(44 + n * 4)), ws = (o, s) => { for (let i = 0; i < s.length; i++) wav.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); wav.setUint32(4, 36 + n * 4, true); ws(8, 'WAVEfmt '); wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 2, true);
  wav.setUint32(24, sr, true); wav.setUint32(28, sr * 4, true); wav.setUint16(32, 4, true); wav.setUint16(34, 16, true); ws(36, 'data'); wav.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) { wav.setInt16(44 + i * 4, clamp(L[i], -1, 1) * 32767, true); wav.setInt16(46 + i * 4, clamp(R[i], -1, 1) * 32767, true); }
  const bytes = new Uint8Array(wav.buffer); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

// ================= layout & main loop =================
function fit() {
  const calc = $('calc'), stage = $('stage');
  if (TR.on) {
    const k = Math.min(innerWidth / 1080, innerHeight / 1920); // 9:16 trailer stage
    stage.style.transform = `translate(${(innerWidth - 1080 * k) / 2}px,${(innerHeight - 1920 * k) / 2}px) scale(${k})`;
    const cx = scr.offsetLeft + 240, cy = scr.offsetTop + 160;
    calc.style.left = (540 - cx) + 'px'; calc.style.top = (760 - cy) + 'px'; calc.style.transformOrigin = `${cx}px ${cy}px`;
  } else {
    // portrait phones: fit width and show the whole body; desktop: screen + upper keypad
    const s = Math.min(innerWidth * 0.97 / 560, innerHeight / 760), h = calc.offsetHeight * s;
    calc.style.transform = `translateX(-50%) scale(${s})`;
    calc.style.top = Math.max(innerHeight * 0.015, (innerHeight - h) / 2) + 'px';
  }
}
addEventListener('resize', fit);
// touch / mouse drag on the screen = relative ship movement + autofire (phone-friendly)
const drag = { id: null, x: 0, y: 0, px: 0, py: 0 };
scr.addEventListener('pointerdown', ev => {
  ev.preventDefault(); audioInit();
  if (TR.on) return;
  if (G.state !== 'play') { press('enter'); return; }
  scr.setPointerCapture(ev.pointerId); Object.assign(drag, { id: ev.pointerId, x: ev.clientX, y: ev.clientY, px: G.p.x, py: G.p.y }); I.fire = 1;
});
scr.addEventListener('pointermove', ev => {
  if (ev.pointerId !== drag.id || G.state !== 'play') return;
  const k = W / scr.getBoundingClientRect().width * 1.4;
  G.p.x = clamp(drag.px + (ev.clientX - drag.x) * k, 10, W - 10); G.p.y = clamp(drag.py + (ev.clientY - drag.y) * k, G.era === 0 ? H * 0.45 : 30, H - 12);
});
const dragEnd = ev => { if (ev.pointerId === drag.id) { drag.id = null; I.fire = 0; } };
scr.addEventListener('pointerup', dragEnd); scr.addEventListener('pointercancel', dragEnd);
let last = 0, acc = 0;
function loop(ts) {
  requestAnimationFrame(loop);
  if (TR.on) {
    if (TR.rec) return;
    const target = Math.floor((ts - TR.t0) / 1000 * TR.fps); let n = 0;
    while (TR.f < target && n++ < 3) trailerStep();
    if (TR.f >= TR.total) location.href = location.pathname;
    audioPump(); return;
  }
  const dt = Math.min(100, ts - (last || ts)); last = ts; acc += dt;
  const step = 1000 / (60 * TUNE.speed);
  while (acc >= step) { acc -= step; tick(); }
  render(); audioPump();
}
// Mod API: everything mods.js may touch. Top-level names (T, WEAPONS, LEVELS...) are also global.
window.PHOENIX = { G, T, TUNE, HOOKS, WEAPONS, LEVELS, ERAS, SPELLS, SHOTS, spawn, shot, aim, ring, laser, pshot, grid, stream, zigs, vform, explode, part, bits, sfx };
// boot() runs after mods.js so mods can change anything first
function boot() {
  const q = new URLSearchParams(location.search), num = (k, d) => q.has(k) && isFinite(+q.get(k)) ? +q.get(k) : d;
  TUNE.speed = clamp(num('speed', TUNE.speed), 0.25, 4); TUNE.god = q.has('god') ? q.get('god') !== '0' : TUNE.god; TUNE.startMoney = num('money', TUNE.startMoney);
  setEra(0); fit();
  const tr = q.get('trailer');
  if (tr === 'rec') { startTrailer(true); window.TRAILER_READY = true; }
  else if (tr) { const tap = $('tap'); tap.style.display = 'flex'; tap.onclick = () => { tap.style.display = 'none'; audioInit(); startTrailer(false); }; }
  else if (q.has('level')) newGame(clamp(Math.round(num('level', 1)), 1, LEVELS.length) - 1);
  requestAnimationFrame(loop);
}
