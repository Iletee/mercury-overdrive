[![Gitpod ready-to-code](https://img.shields.io/badge/Gitpod-ready--to--code-blue?logo=gitpod)](https://gitpod.io/#https://github.com/Iletee/mercury-overdrive)

# Mercury Overdrive

A Tron-styled meteorite gauntlet. Fly a neon dart through a procedurally
generated — but finite — asteroid field, shoot down the picket fleet, and
reach the gate at the far end. Everything is synthesized at runtime: the
music (a four-layer synthwave engine on raw Web Audio), the sound effects,
the ship, the rocks, the sky. No downloaded assets, no build step.

## Running

```
npm install
npm start
```

Then open http://localhost:3000

## Controls

| Input | Action |
|---|---|
| WASD / arrows | Steer |
| Mouse | Aim — the crosshair is a free turret cursor |
| Click (hold) | Fire — bolts converge on the crosshair; near-target shots lock on and home |
| Shift | Boost (drains the boost meter) |
| X | Brake |
| Q / E | Barrel roll — dodges sideways with a moment of invulnerability |

The route through the field forks at the split rings — pink lane right,
cyan lane left — and merges again downstream. The rings are collectible:
thread them cleanly and the streak pays out — 3 in a row refills boost,
6 restores your shield, 10 lights OVERDRIVE ×2 score for 20 seconds (and
clean flying draws extra escort targets with the next wave). Miss one and
the streak resets. Every meteorite is destructible with enough fire —
big ones calve into fragments and pay score by size.

A one-charge shield absorbs the next hit and recharges over ~9 seconds
(the cyan meter under BOOST hums when it's armed). The soundtrack follows
the run: course thirds change the musical section, and each live enemy
type layers its own motif into the mix.

## How it fits together

- `js/main.js` — bootstrap, game states, event wiring, the loop
- `js/ship.js` — flight model, chase camera, procedural player ship
- `js/field.js` — seeded chunked asteroid field (InstancedMesh, fresnel rim glow)
- `js/enemies.js` — Shard / Seeker / Bastion behaviors
- `js/weapons.js` — pooled bolts, crosshair-ray aiming, lock-on homing
- `js/music.js` — procedural synthwave engine; its beat clock drives the glow pulses
- `js/fx.js` — pooled speed-lines, explosions, hit sparks
- `js/hud.js` + `style/main.css` — neon HUD
- `js/sky.js` — nebula dome, starfield, outrun sun, the approaching planet

The whole world pulses on the music's beat — asteroid rims, enemy glows,
the HUD, the exhaust — because the audio engine schedules beat callbacks
against the AudioContext clock.
