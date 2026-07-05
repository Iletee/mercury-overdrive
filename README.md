# ⟁ MERCURY OVERDRIVE

**A Tron-styled meteorite gauntlet.** Fly a neon dart through a procedurally
generated — but finite — asteroid field, thread the route rings, shoot down
the picket fleet, and reach the gate at the far end before the hull gives out.

Everything is synthesized at runtime. The music (a Daft-Punk-inspired
electro engine on raw Web Audio), every sound effect, the ship, the rocks,
the sky — no downloaded assets, no build step, no bundler. One `npm install`
pulls Three.js; the rest is code.

![Made with Three.js](https://img.shields.io/badge/three.js-r165-2de2e6)
![No build step](https://img.shields.io/badge/build-none-ff3864)
[![Gitpod ready-to-code](https://img.shields.io/badge/Gitpod-ready--to--code-blue?logo=gitpod)](https://gitpod.io/#https://github.com/Iletee/mercury-overdrive)

## Play

```
npm install
npm start
```

Open http://localhost:3000 and click to engage. Chrome/Edge/Firefox, a
discrete GPU helps — the whole world blooms.

## Controls

| Input | Action |
|---|---|
| **WASD** / arrows | Steer — the ship banks into turns and recenters on release |
| **Mouse** | Aim — the crosshair is a free turret cursor, fully decoupled from flight |
| **Click** (hold) | Fire — bolts converge on the crosshair; near-crosshair enemies lock on, full locks home |
| **Right mouse / Ctrl** (hold) | **Multilock** (once the Multi-Phaser is claimed) — sweep the cursor to paint up to 6 locks. Release RMB to volley; with Ctrl the locks stay armed and the next click fires |
| **Shift** | Boost (drains the meter; rings refill it) |
| **X** | Brake — narrows the view into a steadier gun platform |
| **Q / E** | Barrel roll — sideways dodge with a moment of invulnerability |

## The run

- **The gauntlet is seeded and finite** — 60,000 units, the same course every
  run, generated in chunks ahead of you and recycled behind you.
- **The route snakes and forks.** Guidance rings mark the flyable lanes;
  at each split, pink is the right lane and cyan the left, merging again
  downstream. Twice per run the corridor squeezes tight and fills with debris.
- **Rings are collectible.** Thread them for a streak: **3** refills boost,
  **6** restores your shield, **10** triggers **OVERDRIVE** — double score
  for 20 seconds — and clean flying draws extra escort targets with the
  next wave. Miss one and the streak resets.
- **Everything is destructible.** Asteroid HP scales with size; big rocks
  calve into fragments, and score pays by radius.
- **Three enemy types** with distinct silhouettes, behaviors, and scores:
  Shards (strafing formation drones that fire on the beat), Seekers
  (kamikaze pursuers), Bastions (heavy burst-fire turrets). Radar pings
  flag them on screen and point at them from the edges when they're not.
- **The Multi-Phaser** waits at the exit of the first squeeze (~44%):
  fly through it to unlock the **Rez-style multilock** — hold right mouse
  (or Ctrl on a touchpad) and sweep the cursor to paint up to 6 locks
  (stack up to 3 on one heavy), release to loose a homing volley that
  detonates as an ascending arpeggio. Lock charge regenerates and rings
  top it up; the back half of the run is built around it — formations,
  mixed heavies, seeker swarms.
- **THE ARCHITECT** guards the gate: a three-phase wireframe boss. Strip
  its orbiting shield lattice (one painted volley takes all six nodes),
  then break the exposed core through vent windows, beam sweeps, novas,
  and seeker pressure. The gate lights when it falls.
- **One-charge shield** absorbs the next hit and recharges in ~9 s (the
  cyan meter hums when armed). Hull takes five.

## The sound is the game

The soundtrack is generated live at 118 BPM in E minor and everything is
wired to it:

- Player shots are **beat-quantized plucks walking an ascending pentatonic**
  — hold fire and you play melodies. The bolt colors climb with the notes.
  Multilock painting walks the same scale an octave up, and the volley
  release strums it.
- Ring streaks play **rising FM bells**; locks, explosions, and wave events
  all land on the grid (hull damage alone is instant — danger can't wait,
  but it hurts *in key*: a falling E-minor arpeggio over a thump).
- **Each live enemy type adds its own motif** to the mix: shards a glassy
  arp, seekers an urgent ostinato, bastions a dark drone and downbeat stab.
  The Architect brings its own low ostinato that doubles into a gallop in
  its final phase.
- The arrangement **builds across the run** — pad and kick at launch, the
  riff at 5%, the full band at 30% — and the lead voice (a warm FM
  electric-piano pluck) stays silent until you claim the Multi-Phaser:
  the melody is the powerup's reward.
- Every kick **sidechain-ducks** the mix, and the beat has a visible source:
  a **pulsar** on the horizon kicks on every beat and throws an expanding
  halo ring across the starfield on the downbeat (it hangs nearer than the
  stars, so it parallaxes as you steer). The world — asteroid rims, enemy
  shells, the HUD — shimmers along in sympathy.

## Code map

| File | What it owns |
|---|---|
| `js/main.js` | Bootstrap, game states, event wiring, the loop (hitstop lives here) |
| `js/store.js` | **All tuning** — flight feel, combat, waves, forks, squeezes, scoring |
| `js/ship.js` | Flight model, chase camera, barrel rolls, shield, procedural ship |
| `js/field.js` | Seeded chunked asteroid field, route/fork system, collectible rings |
| `js/enemies.js` | Shard / Seeker / Bastion behaviors |
| `js/boss.js` | THE ARCHITECT — shield lattice, beam sweeps, vents, novas, derez |
| `js/weapons.js` | Pooled bolts, crosshair-ray aiming, lock-on homing, multilock paint/volley |
| `js/music.js` | The procedural audio engine — transport, sections, motifs, all SFX |
| `js/fx.js` | Speed-lines, explosions, shockwaves, hit sparks (all pooled) |
| `js/debris.js` | Micrometeors whipping past the canopy |
| `js/sky.js` | Nebula dome, starfield, the beat-pulsing pulsar, the approaching planet |
| `js/hud.js` + `style/main.css` | Neon HUD: hull/boost/shield, radar pings, streak, reticles |

There is no framework and no build: `index.html` maps `three` via an import
map and loads `js/main.js` as an ES module. `window.__mo` exposes the core
systems for headless testing (the repo's smoke tests fly the route with a
ring-chasing autopilot in headless Chromium).

## Tuning the feel

Nearly every knob is a named constant: `js/store.js` for gameplay (speeds,
steering sharpness, wave table, fork/squeeze geometry, scores), the top of
`js/music.js` for tempo, chord loops, riff patterns, and layer gains, and
the slew/camera-trail rates at the top of `js/ship.js` for hand feel.
