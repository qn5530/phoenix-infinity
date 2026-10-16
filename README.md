# PHOENIX ∞

**A calculator shooter that evolves** — from a faithful 1‑bit, 96×64 recreation of the classic TI‑83/84 shoot‑'em‑up *Phoenix* to a full‑blown, DoDonPachi‑inspired Japanese bullet hell. The whole game lives on the screen of a calculator, and the calculator itself evolves with it.

**▶ Play in your browser:** https://qn5530.github.io/phoenix-infinity/ — works on desktop and in portrait on phones (or open `index.html` locally).

**🎬 Trailer:** [phoenix_trailer.mp4](https://github.com/qn5530/phoenix-infinity/releases/download/v1.0/phoenix_trailer.mp4) (9:16, 60 fps, real gameplay)

## The four eras

| Era | Calculator | Look | New mechanics |
|---|---|---|---|
| I | **PX‑83** | 96×64 monochrome LCD, pixel ghosting, 3×5 font | Phoenix classic: cash per kill, shop between levels, 5 weapons, shields, Mothership boss |
| II | **PX‑84 CE** | 192×128 colour LCD | Coins, homing missiles, bombs, *The Divider* (splits at 50%) |
| III | **PX‑9000** | Neon vector glow, synthwave grid | Grazing, telegraphed lasers, ∫ Railgun, *Overflow* (3 phases) |
| IV | **PX‑∞** | Full bullet hell + particles | Tap = shot / hold = laser, hit chain, **HYPER**, ÷0 singularity bomb, *∞ Infinity* with four spell cards |

A green calculator‑LCD filter stays on top of every era, so it always feels like it's running on a calculator.

## Controls

| Action | Keyboard | Calculator key | Touch |
|---|---|---|---|
| Move | Arrows / WASD | ▲▼◀▶ | Drag anywhere on the screen |
| Fire (tap = shot, hold = laser in era IV) | Z / Space | 2ND | Auto while dragging |
| Bomb | X | ALPHA | ALPHA |
| Hyper (era IV) | V | STAT | STAT |
| Switch weapon | C | MODE | MODE |
| Focus (slow + show hitbox) | Shift | X,T,θ,n | X,T,θ,n |
| Select / pause | Enter / P | ENTER / GRAPH | Tap screen |
| Back | Esc | CLEAR / DEL | CLEAR |
| Mute | M | ON | ON |

On the title screen press **1–9** to jump to any level.

## URL options

```
index.html?level=8      start at level 8
index.html?god=1        invincible
index.html?speed=1.5    game speed (0.25 – 4)
index.html?money=9999   starting cash
index.html?trailer=1    play the in-engine trailer
```

## Modding

Everything is plain data and functions — open **`mods.js`**, uncomment an example, reload. It loads after `game.js` and before the game boots.

- **`TUNE`** — speed, enemy/boss HP, player damage, bullet speed, cash, wave pacing, starting shields, god mode.
- **`WEAPONS`** — each weapon is `{ id, name, cost, era, d, fire(player, dmg, focus) → cooldown }`. Push your own.
- **`T`** — enemy types: HP, radius, score, cash, AI (`form` / `path` / `chase`), sprite bitmap (eras I–II) or vector shape (III–IV), `fire(e)` and `die(e)` patterns.
- **`LEVELS`** — `{ era, waves: [spawn functions], boss }`. Spawners: `grid`, `stream`, `zigs`, `vform`.
- **Bullet patterns** — `shot(x, y, angle, speed, opts)`, `aim(e, speed, n, spread)`, `ring(x, y, n, speed, offset)`, `laser(x, y, angle, opts)`.
- **`HOOKS`** — `tick`, `kill`, `levelStart` callbacks.
- **`SHOTS`** — the trailer's shot list (camera, captions, transitions), if you want to cut your own trailer.

Everything is also reachable as `window.PHOENIX` from the browser console.

## Recording the trailer

The trailer is real gameplay, simulated deterministically and captured frame by frame (1080×1920, 60 fps, 9:16), with the soundtrack rendered by the game's own synth.

```bash
npm install
node record.mjs        # needs ffmpeg on PATH and Google Chrome (set CHROME=/path/to/chrome if elsewhere)
```

## Credits

Inspired by **Phoenix** by Patrick Davidson for TI‑82/83/84/85/86 calculators, and by Cave's **DoDonPachi** series. This is an independent fan tribute; no code or assets from either were used. Not affiliated with Texas Instruments.

MIT licensed.
