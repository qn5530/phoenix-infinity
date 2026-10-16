/* PHOENIX ∞ — mods.js
   Loaded after game.js and before the game boots, so anything here wins.
   Everything below is commented out: uncomment a block (remove the leading //) and reload.
   Full reference: README.md → "Modding".

   Quick tweaks without editing code, via the URL:
     index.html?level=8        start at level 8 (1–9)
     index.html?god=1          invincible
     index.html?speed=1.5      game speed (0.25–4)
     index.html?money=9999     starting cash
     index.html?trailer=1      play the in-engine trailer
*/

// ---------- 1. Tuning knobs ----------
// TUNE.speed = 1.2;            // whole game faster
// TUNE.enemyHp = 0.7;          // weaker enemies
// TUNE.bossHp = 1.5;           // tougher bosses
// TUNE.playerDamage = 1.3;
// TUNE.enemyBulletSpeed = 0.8; // gentler bullet hell
// TUNE.money = 2;              // double cash
// TUNE.waveNext = 0;           // wait until a wave is fully dead before the next one
// TUNE.startShields = 6;

// ---------- 2. A new weapon ----------
// fire(player, damageMultiplier, focusHeld) spawns bullets and returns the cooldown in frames.
// pshot(x, y, angle, speed, damage, options) — options.k: 'b' (bolt) | 'laser' (pierces) | 'missile' (homes, set home: 0.15) | 'orb' | 'wave'
// WEAPONS.push({
//   id: 'tan', name: 'TAN() FAN', cost: 400, era: 0, d: 'Seven bolts in a widening fan.', color: '#ffe14a',
//   fire: (p, m, focus) => {
//     for (let i = -3; i <= 3; i++) pshot(p.x, p.y - 10, -Math.PI / 2 + Math.tan(i * 0.12) * (focus ? 0.3 : 1), 7, 0.8 * m);
//     return 12;
//   },
// });

// ---------- 3. Change an enemy ----------
// T.drone.hp = 2;
// T.drone.fire = e => { if ((e.t + e.ph) % 90 === 0) aim(e, 2, 3, 0.25, { k: 'dot', c: '#ffffff' }); };

// ---------- 4. A new enemy ----------
// Era 0/1 enemies use a bitmap ('#' = pixel). Era 2/3 enemies use a vector shape { n: sides, c: colour, spin }.
// bits('ufo', ['..####..', '.######.', '##.##.##', '########', '.#.##.#.']);
// T.ufo = {
//   hp: 3, r: 12, sc: 40, $: 15, ai: 'form', spr: ['ufo'], ps: 4,            // ai: 'form' | 'path' | 'chase'
//   shape: { n: 5, c: '#7dfcff', spin: 0.05 },                                  // used in the colour/vector eras
//   fire(e) { if ((e.t + e.ph) % 70 === 0) ring(e.x, e.y, 6, 1.5, e.t * 0.1, { k: 'orb', c: '#7dfcff' }); },
//   die(e) { ring(e.x, e.y, 10, 2, 0, { k: 'dot', c: '#ffffff' }); },           // optional "revenge" bullets
// };
// LEVELS[0].waves.unshift(() => grid('ufo', 5, 2));                           // put it in level 1

// ---------- 5. Rewrite the level list ----------
// Each level: { era: 0-3, waves: [functions that spawn enemies], boss: 'mother' | 'divider' | 'overflow' | 'infinity' }
// Spawners: grid(type, cols, rows, y0, dx, dy) · stream(type, n, 'L'|'R', y0) · zigs(type, n) · vform(type, n)
// LEVELS.splice(0, LEVELS.length,
//   { era: 0, waves: [() => grid('drone', 8, 4)], boss: 'mother' },
//   { era: 3, waves: [() => vform('swarm', 20)], boss: 'infinity' },
// );

// ---------- 6. Hooks ----------
// HOOKS.kill.push(e => { if (T[e.type].boss) G.money += 1000; });   // boss bounty
// HOOKS.levelStart.push(n => { G.bombs = 3; });                       // refill bombs every level
// HOOKS.tick.push(() => { if (G.frame % 600 === 0 && G.state === 'play') G.msg = { text: 'STAY FOCUSED', t: 60 }; });
