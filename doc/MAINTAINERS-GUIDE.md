# Lory's Lab — Maintainer's Guide

**Audience:** any developer or AI coding agent that has to maintain, debug, or
evolve this game. This document is the single source of truth about how the
game is built, why every number has the value it has, and — most importantly —
**the safe procedures for changing things without breaking the 24 verified
levels**. Read it fully before touching `src/`.

---

## Table of contents

1. [What the game is](#1-what-the-game-is)
2. [File map & module architecture](#2-file-map--module-architecture)
3. [Coordinate system & world constants](#3-coordinate-system--world-constants)
4. [The physics core (`src/core.js`)](#4-the-physics-core-srccorejs)
   - 4.1 Part catalog with exact physics properties
   - 4.2 Per-frame behaviours (fan, magnet, balloon, conveyor)
   - 4.3 Collision rules (bell, pop, trampoline, sparkle, catch)
   - 4.4 Goal detection & the quiescence ("stuck") detector
   - 4.5 The event stream
   - 4.6 Compound bodies — three traps you must know
   - 4.7 Measured behaviour facts (empirical numbers for level design)
5. [Level format & the solvability contract](#5-level-format--the-solvability-contract)
6. [Testing: what exists and what must always pass](#6-testing-what-exists-and-what-must-always-pass)
7. [The renderer (`src/render.js`)](#7-the-renderer-srcrenderjs)
8. [The audio engine (`src/audio.js`)](#8-the-audio-engine-srcaudiojs)
9. [The game shell (`src/game.js`)](#9-the-game-shell-srcgamejs)
10. [Build & deployment](#10-build--deployment)
11. [Recipes: how to evolve the game](#11-recipes-how-to-evolve-the-game)
    - 11.1 Add a new placeable part
    - 11.2 Add a new campaign level
    - 11.3 Change a physics constant
    - 11.4 Add a new goal type
    - 11.5 Add a sound
    - 11.6 Add UI / a new screen
    - 11.7 Debugging playbook
12. [Invariants — never break these](#12-invariants--never-break-these)

---

## 1. What the game is

*Lory's Lab* is a browser 2D physics contraption-puzzle game (spirit of *The
Incredible Machine*) for ages 5+. The player drags parts from a tray onto a
board, presses ▶, and physics runs a chain reaction. Goals: deliver the berry
into Lory's bowl (`catch`), ring a bell (`bell`), or pop all goal balloons
(`pop`). Features: a 24-level campaign, a sandbox, a user puzzle maker with
persistent saved puzzles, puzzle sharing via links and `.lorypuzzle` files
(§9), hints rendered as ghost outlines, 3-star sparkle
pickups, two age modes, and a secret unlock cheat. The sandbox additionally
carries the "machine shop": ropes, triggered scissors, candles (placeable lit
or cold), strike-anywhere matches, fuses, bump-activated hydrants, pressure
switches, a rotatable spring fist, and a rotatable laser cannon — fire, water,
light, cutting, and remote triggering as composable systems.

**Everything in-game is code-generated**: all art is Canvas 2D paths, all
audio is WebAudio synthesis — zero binary assets at runtime. (The repo does
carry two PNG app icons for the PWA/home-screen install, themselves rendered
by the game's own Lory-drawing code.) The only third-party code is
the vendored physics engine `vendor/matter.min.js` (matter-js 0.20.0, MIT).

The **defining engineering property** of this project: the physics module runs
identically in the browser and in Node. Because of this, every level is
**machine-verified** — a headless simulation proves each level is not
self-solving and is beatable by its stored solution. Any change you make must
keep that pipeline green.

---

## 2. File map & module architecture

```
lorys-lab/
├── vendor/matter.min.js     matter-js 0.20.0 UMD build (physics engine, MIT)
├── src/
│   ├── core.js              physics module — runs in browser AND Node (UMD)
│   ├── levels.js            24-level campaign data (UMD, pure JSON inside)
│   ├── audio.js             WebAudio synth engine  → window.LoryAudio
│   ├── render.js            Canvas 2D renderer      → window.LoryRender
│   └── game.js              game shell / UI / state → boots on DOMContentLoaded
├── index.html               dev page: CSS + <script src> tags + PWA links and
│                            service-worker registration (open directly)
├── manifest.json / sw.js    PWA manifest + network-first service worker for
│                            the GitHub Pages deployment (see §10)
├── icon-180.png / icon-512.png  app icons (generated from drawLory)
├── build.mjs                bundler → dist/ single-file builds
├── dist/
│   ├── lorys-lab.html       standalone build (full HTML document)
│   ├── artifact.html        body-content-only build for claude.ai artifacts
│   └── lorys-lab-current.html  copy of artifact.html (the published artifact
│                            path — the filename rotates when the artifact URL
│                            has to be re-minted; check build.mjs for current)
├── test/
│   ├── smoke.mjs            54 physics behaviour proofs (run in Node)
│   ├── verify.mjs           per-level solvability proofs (run in Node)
│   ├── puzzlecode.mjs       puzzle wire-format roundtrip + hostile-input proofs
│   └── audio-shape.mjs      audio API-surface test with stubbed browser globals
├── design/                  design-time documents (visual spec, audio spec,
│                            level candidates) — not loaded by the game
├── doc/MAINTAINERS-GUIDE.md this file
└── doc/IOS-APP-GUIDE.md     iPhone/iPad packaging guide (PWA + Capacitor)
```

### Module dependency graph and load order

Load order matters and is fixed in `index.html` and `build.mjs`:

```
matter.min.js  →  core.js  →  levels.js  →  audio.js  →  render.js  →  game.js
```

- `core.js` is **UMD**: in Node it does `module.exports = factory(require('../vendor/matter.min.js'))`;
  in the browser it reads the global `Matter` and exposes `window.LoryCore`.
  **It must never touch `window`, `document`, or any DOM API** in its factory
  body — the headless tests depend on this. If you need an environment check,
  it is already handled by the UMD wrapper.
- `levels.js` is UMD too (`window.LoryLevels` / `module.exports`) and contains
  **only data** (a JSON array). It is regenerated programmatically — see §5.
- `audio.js` and `render.js` are browser-only IIFEs exposing
  `window.LoryAudio` / `window.LoryRender`.
- `game.js` is the composition root. It accesses audio through a **safe facade**
  (`A.sfx(...)` etc. no-op if `window.LoryAudio` is absent) so the game can boot
  without audio.

### Cross-module contracts (the "API" between files)

| Producer | Consumer | Contract |
|---|---|---|
| core | game | `createSim(levelDef, placements)` → sim object; `sim.step()` → events array; `sim.state` flags; `PART_DEFS`; `placementOverlaps(sim, spec)`; `simulate(levelDef, placements, opts)` (headless); `puzzleCode.{encode,decode,canonical}` (puzzle sharing, async) |
| core | render | each Matter body carries `body.plugin.lab` metadata (`type,id,w,h,r,dir,spec,...`); event objects for FX |
| core | audio (via game) | event objects: `hit, boing, bumper, pop, bell, sparkle, magnet_on/off, win, snip, snipclick, ignite, extinguish, switch_on/off, thwack, water_on/off, laser` |
| render | game | `R.draw(frame)` returns `{selButtons, wells}` hit-regions the input code uses next frame |
| levels | game/tests | array of level objects (schema in §5) |

---

## 3. Coordinate system & world constants

- Board: **x 0→1280 (left→right), y 0→720 (top→bottom)**. Gravity pulls +y.
- The canvas is 1280×830: board (0–720) + parts tray strip (720–830, `TRAY_H = 110`).
- **Floor**: a static body whose top surface is at `y = 690` (`WORLD.floorY`).
  Something "standing on the floor" has `center_y = 690 − height/2`
  (e.g. trampoline center y = `690 − 12 = 678`).
- **Side walls** exist at x=0 and x=1280 (invisible static bodies). There is
  **no ceiling** — things can fly off the top and come back down.
- Usable design area for level content: **x 40..1240, y 60..660** (keeps parts
  clear of the topbar chips and the floor).
- The bottom-right corner under the floating DOM Play button is a
  **placement dead zone** (a part there would be ungrabbable). Enforced in
  `game.js specInvalid()`; its size scales with `uiBoost` since the button
  grows on phones. No stored level solution uses that corner (verified).
- **Full-bleed canvas**: when the screen is wider than the board's aspect
  (phones in landscape, wide monitors), `layout()` widens the canvas —
  `viewW = min(2100, vw/scale)` — instead of letterboxing. The room artwork
  (wallpaper/floor/tray) fills `viewW`; the 1280px board stays centered at
  offset `boardOX() = (viewW-1280)/2`, its ends marked by subtle wooden
  posts. Renderer: `R.setView(viewW)` resizes the canvas + repaints the bg
  cache; `draw()` translates by `ox + cam.x`. Input: `canvasPos` scales by
  `viewW`; `toBoard()` subtracts `ox`. Physics world stays 1280 — this is
  pure presentation. Desktop windows narrower than the board aspect keep
  `viewW = 1280` (classic centered card).
- **Camera (Tier-2 mobile)**: `game.js` owns `cam = {z, x, y}` (z 1..2.5,
  clamped so the board window stays covered; z < 1.04 snaps to exactly 1).
  Two fingers on the board pinch-zoom/pan in ANY phase (starting a pinch
  `cancelDrag()`s an in-flight one-finger drag); Ctrl/⌘+wheel zooms on
  desktop; camera resets on `enterLevel`. Renderer applies it as a
  translate+scale around ALL board drawing (`frame.cam`), tray/topbar stay
  fixed. Input maps canvas→board via `toBoard()`; selection buttons and
  `hitPlacement` hit-test in board coords; tray wells in canvas coords; the
  Play-button dead zone in `specInvalid` maps its canvas rect through the
  camera. Pure view transform — physics and placements are board-space.
- **Mobile (Tier-1 support)**: `layout()` uses `visualViewport` (tracks iOS
  Safari's collapsing bars; also listens to `orientationchange` +
  `visualViewport.resize`), computes `uiBoost = clamp(0.75/appScale, 1, 1.7)`
  and publishes it as the CSS var `--uiboost` (DOM chips + play button scale
  with it) and into `R.draw(frame.uiBoost)` (canvas tray/selection scale). A
  full-screen `#rotateOverlay` ("turn your device sideways") shows on
  coarse-pointer devices in portrait. `100dvh` handles the URL-bar height.
- Physics steps at a **fixed 60 Hz** (`Engine.update(engine, 1000/60)`), with
  `positionIterations = 8`, `velocityIterations = 6`, `gravity.y = 1`.
  Speeds in this doc are in **px per frame** (px/f); 1 px/f = 60 px/s.
- Renderer scales by `devicePixelRatio` (capped at 2). The whole `#app` div is
  CSS-`transform: scale()`d to fit the window; pointer coordinates are mapped
  back through `getBoundingClientRect` (`canvasPos()` in game.js).

---

## 4. The physics core (`src/core.js`)

### 4.1 Part catalog with exact physics properties

`PART_DEFS` is the **single source of truth** for geometry and editor flags:

| type | size | static | placeable | rot | dir | notes |
|---|---|---|---|---|---|---|
| `plank` | 160×20 | ✓ | ✓ | ✓ | – | the only rotatable part in campaign trays (the sandbox adds rotatable scissors/fuse/fist/match/laser) |
| `trampoline` | 110×24 | ✓ | ✓ | – | – | horizontal only |
| `seesaw` | 220×16 | dynamic | ✓ | – | – | plank + pivot constraint (see below) |
| `fan` | 56×56 | ✓ | ✓ | – | right/left/up | wind field, see 4.2 |
| `magnet` | 56×56 | ✓ | ✓ | – | – | sleepy magnet, see 4.2 |
| `domino` | 16×56 | dynamic | ✓ | – | – | chain element |
| `conveyor` | 140×26 | ✓ | ✓ | – | right/left | surface drive, see 4.2 |
| `bumper` | r 26 | ✓ | ✓ | – | – | restitution 1.0 |
| `balloon` | r 24 | dynamic | ✓ | – | – | buoyant, pops ONLY on spikes |
| `bucket` | 120×90 | ✓ | ✓ | – | – | compound: solid open-top catcher |
| `ball_beach` | r 28 | dynamic | ✓ | – | – | light + bouncy |
| `ball_marble` | r 18 | dynamic | ✓ | – | – | heavy; the only magnet-attractable body |
| `rope` | 28×18 anchor | ✓ | ✓ (sandbox) | – | – | tether hangs 150px below; grabs nearest dynamic body within 70px of its end at sim start; cut by scissors/flame |
| `scissors` | 74×40 | ✓ | ✓ (sandbox) | ✓ | – | TRIGGERED: any touch snaps the blades once (12-frame cutting window, 45-frame re-arm; events `snipclick`/`snip`); during the window they cut any rope or goal-balloon tether crossing their OBB (flames burn both too); a cut balloon floats free |
| `candle` | 26×58 | ✓ | ✓ (sandbox) | – | – | lit by default, `spec.lit:false` places it cold (editor 🔥/💨 toggle on the selected candle); flame tip ignites fuses/matches/cold candles, pops balloons, burns ropes and balloon strings; doused by water; relightable by any flame or laser |
| `fuse` | 130×12 | ✓ sensor | ✓ (sandbox) | ✓ | – | bodies pass through; burns as interval [a,b] from ignition point both ways in ~2.5s (`FUSE_BURN_FRAMES 150`); fronts are flame points |
| `hydrant` | 52×62 | ✓ | ✓ (sandbox) | – | right/left/up | sleepy like the magnet: a bump (relSpeed ≥ 1.6) opens the valve for `HYDRANT_ACTIVE_FRAMES 180` (~3s), or a wired switch drives it; while active the jet (reach 240, half-width 46) pushes EVERYTHING incl. berries (marbles reduced) and extinguishes flames. Events `water_on/water_off` drive the audio loop |
| `switch` | 84×20 | ✓ | ✓ (sandbox) | – | – | pressure plate; wires to nearest fan/conveyor/magnet/hydrant/laser within 260px at sim start; device runs only while pressed (magnet: switch replaces bump/timer) |
| `fist` | 66×46 | ✓ | ✓ (sandbox) | ✓ | – | rotatable 360°: punches along its facing at 15 px/f (`FIST_LAUNCH`, tangential velocity preserved), 60-frame cooldown. Two triggers: contact on the GLOVE side (local −y) punches the toucher; contact on the BACK plunger (local +y) fires remotely, launching everything in the muzzle zone (≤55px in front) — a pre-loadable cannon |
| `match` | 12×54 | ✓ | ✓ (sandbox) | ✓ | – | strike-anywhere: a bump (relSpeed ≥ 1.6), any flame, or the laser flares the head (local −y end) into a real flame point for `MATCH_FLARE_FRAMES 150` (~2.5s), then it is spent for good; water also spends it. One-shot touch→fire converter |
| `laser` | 44×56 | ✓ | ✓ (sandbox) | ✓ | – | rotatable 360° cannon (tray default `angle:90` — fires sideways): any touch fires the beam along local −y for `LASER_FIRE_FRAMES 30` (~0.5s, 50-frame re-arm); a wired switch holds the beam on instead. Beam (reach `LASER_REACH 420`, first solid body blocks it; sensors/balloons never do, and neither does anything pressed against the lens — the trigger ball must not eat its own shot) pops balloons, lights candles/matches, ignites fuses at the crossing point, burns ropes and tether strings (snip cause `'fire'`). Event `laser` on firing; renderer draws the beam from `lab.laz.beamLen` |
| `shelf` | w×24 (default 200) | ✓ | fixed-only | ✓ | – | `sizable` (levels set w/h/angle) |
| `wall` | 24×200 | ✓ | fixed-only | – | – | `sizable` |
| `berry` | r 16 | dynamic | fixed-only* | – | – | THE goal ball; `isBerry` flag |
| `bowl` | 130 wide (⚠ two heights, see note) | ✓ | fixed-only* | – | – | compound + catch **sensor** |
| `bell` | r 30 | ✓ | fixed-only* | – | – | ring goal |
| `balloon_goal` | r 24 | dynamic | fixed-only* | – | – | tethered goal balloon |
| `spikes` | 56×64 | ✓ | fixed-only* | – | – | potted cactus; pops balloons; `angle:180` = hanging |
| `sparkle` | r 14 | sensor | auto | – | – | created from `level.sparkles` |

⚠ **Bowl height caveat**: `PART_DEFS.bowl` says `h: 70` — that value is used by
the *editor* (`specInvalid` footprint, ghost drawing). But `makePart` hard-codes
the physical wall height to **62** (`const height = isBowl ? 62 : h;`). Two
different heights are deliberately in play; if you resize the bowl you must
change both places.

\* "fixed-only" parts are still placeable **in the sandbox** — the sandbox tray
(`SANDBOX_TRAY` in game.js) explicitly includes berry/bowl/bell/balloon_goal/
spikes/shelf/wall so users can build their own puzzles.

**Exact material properties** (from `makePart`; keep this table in sync if you
change the code):

| body | density | restitution | friction | frictionAir | other |
|---|---|---|---|---|---|
| berry | 0.0015 | 0.30 | 0.08 | 0.005 | `plugin.lab.isBerry = true` |
| ball_beach | 0.0006 | 0.72 | 0.03 | 0.006 | |
| ball_marble | 0.006 | 0.12 | 0.02 | 0.002 | ~6.1 mass units; the "heavy" body |
| domino | 0.002 | 0.05 | **0.20** | default | `frictionStatic 0.5`. **friction 0.2 is load-bearing**: chains propagate at 30–34 px spacing; 0.4+ stalls chains, 0.05 slides instead of tipping |
| seesaw plank | 0.0008 | 0.10 | 0.5 | 0.008 | chamfer r4; pivot = `Constraint(length 0, stiffness 0.95)` anchored at spec (x,y) — light plank maximizes fling energy |
| balloon / balloon_goal | 0.0004 | 0.50 | 0.05 | 0.045 | buoyancy each frame (see 4.2). `balloon_goal` additionally gets a tether: `Constraint(pointA = (x, y+95), length 95, stiffness 0.01, damping 0.05)` — it **bobs in place**, rising only ~2 px above spawn |
| plank/shelf/wall/spikes (static) | – | 0.10 | 0.40 | – | conveyor housing uses friction 0.9 |
| trampoline | – | 0.40 | 0.10 | – | actual bounce comes from the collision handler, not restitution |
| bumper | – | **1.00** | 0 | – | |
| fan housing | – | 0.10 | 0.30 | – | |
| magnet housing | – | 0.20 | 0.40 | – | `plugin.lab.magnet = {active,timer,cooldown}` |
| bucket/bowl compound | – | 0.05 | 0.40 | – | see 4.6 |
| bell | – | 0.40 | 0.10 | – | |
| floor | – | default | 0.5 | – | spans the whole width at y 690+ |

Global constants (top of core.js):

```
FAN_REACH = 280        FAN_HALF_WIDTH = 52      CONVEYOR_SPEED = 3.2
MAGNET_REACH = 340     MAGNET_ACTIVE_FRAMES = 120 (≈2 s)
MAGNET_COOLDOWN_FRAMES = 30
```

### 4.2 Per-frame behaviours (`applyBehaviours()` inside `createSim`)

Executed **before** each `Engine.update`:

- **Fan wind.** For each fan, a query region extends from the housing face:
  `28 + FAN_REACH/2` along the direction vector, half-width 52 across.
  Every non-static, non-sensor body inside gets a force along the direction:
  `mag = (heavy ? 0.00035 : 0.0019) × min(mass, 2.4) × falloff` where
  `heavy = density > 0.004` (i.e. the marble) and
  `falloff = max(0.35, 1 − dist/(REACH+40))`.
  **Berries are explicitly excluded** (`lab(b).isBerry` skip). This is a core
  teaching rule (level 12: "wind can't move a berry"). Do not remove it.
- **Magnet.** State machine per magnet in `plugin.lab.magnet`:
  - asleep → any dynamic, non-sensor body hitting the housing with
    `relSpeed ≥ 1.6` while `cooldown ≤ 0` wakes it (`magnet_on` event),
    `timer = 120`. A bump while active refreshes the timer.
  - active → each frame pulls **`ball_marble` bodies only** within 340 px:
    force toward the magnet center of
    `strength × mass`, `strength = 0.0026` under 150 px, decaying linearly by
    `0.0000074/px` beyond (≈0.0012 at the edge). If the marble's approach
    speed already exceeds **9 px/f** no force is applied (anti-slingshot cap).
    A held marble pins against the housing (usually the underside).
  - timer expires → `magnet_off` event, `cooldown = 30` frames, the marble
    drops (nearly straight down: measured < 5 px x-variance).
- **Balloon buoyancy.** Unpopped balloons get
  `F_up = mass × gravity × 0.001 × 1.65` each frame (net ~0.65 g upward);
  `frictionAir 0.045` caps rise speed at ~1–2 px/f.
- **Machine shop (sandbox parts).** All wired in `createSim` (ropes tether the
  nearest dynamic body; switches link the nearest fan/conveyor/magnet/hydrant/laser,
  marking it `switchControlled`) and simulated in `applyBehaviours` in this order:
  pressure-switch scan → device gating (`poweredNow`) → fan/magnet/balloon →
  conveyor pairs → hydrant push+douse → fuse-interval advance → match burn-down →
  flame-point collection (candles + matches + fuse fronts) → flame effects
  (pop/ignite/relight/strike-match/burn-rope) → scissors-rope intersection →
  laser beam (march + burn) → fist cooldown. New events: `snip {cause:'blade'|'fire'}`,
  `ignite`, `extinguish`, `switch_on/off`, `thwack`, `water_on/off`, `laser`. A burning
  fuse, a flaring match, a spraying hydrant or a firing laser suppresses the
  quiescence detector (pending action is not "stuck"). The `'water'`
  audio loop is event-driven: `water_on`/`water_off` start/stop it inside
  audio.js `handleEvents` (NOT in game.js `startLoops`).
- **Conveyor drive.** For each active collision pair involving a conveyor:
  the other body's x-velocity is steered toward `±3.2` by at most 0.4 px/f²
  per frame, and its angular velocity is damped ×0.9 (so balls ride instead of
  spinning off).

### 4.3 Collision rules (in the `collisionStart` handler)

These all run for every new contact pair, in this exact source order
(relevant if you ever insert a rule at a specific position):

1. **Sparkle pickup**: sensor `sparkle` + any dynamic body (balloons included —
   in pop levels the balloon is the hero) → `collected`, sensor body removed,
   `sparkle` event with running count `n` (1..3).
2. **Balloon pop**: a `poppable` body pops if it touches `spikes`, or — for
   `balloon_goal` only — if hit by any non-sensor body with `relSpeed ≥ 3.5`.
   Popping removes the body + its tether and emits `pop {goal:bool}`.
   Placeable balloons pop **only** on spikes.
3. **Bell ring**: contact with `relSpeed ≥ 1.8` sets `bellRung` (once) and
   emits `bell`. Anything dynamic can ring it — berry, marble, a toppling
   domino, a flung beach ball.
4. **Trampoline boost**: when a falling body (vy > 1.5, positioned above the
   pad) touches a trampoline: `vy ← −max(vy × 1.06, 8)`. This gives ~100–105%
   height return and a guaranteed minimum hop. **The multiplier is delicate**:
   at 1.22 balls gained energy every bounce and flew off-screen; below ~1.0
   bounces die out. The `boing` event carries `bodyId`/`partId` for FX.
5. **Magnet wake** — see 4.2 (bump with `relSpeed ≥ 1.6` while not cooling
   down wakes it / refreshes its timer).
6. **Hydrant wake** — bump with `relSpeed ≥ 1.6` opens the valve for ~3s
   (skipped when switch-wired).
7. **Scissors trigger** — any dynamic touch starts the 12-frame snip window
   (+45-frame re-arm), emitting `snipclick`.
8. **Fist triggers** — glove-side contact punches the toucher; back-plunger
   contact fires the muzzle zone (see the part table).
9. **Bumper ping**: physics is plain restitution 1.0; the handler only emits a
   `bumper` event (impact ≥ 1.5) for FX/audio.
10. **Generic `hit` event** for audio/squash: any non-sensor pair with
   `relSpeed > 1.2` emits `{type:'hit', impact, bodyId, x, y, nx, ny, matA, matB}`
   where materials come from the `MATERIAL` map (wood/domino/rubber/marble/
   berry/tramp/bumper/balloon/bell/magnet).

Additionally in `collisionActive`: the **bowl catch counter** — every frame a
body with `isBerry` overlaps a `bowl_sensor`, `caughtFrames++`.

### 4.4 Goal detection & the quiescence detector

`checkGoal()` after each step:

- `catch`: `caughtFrames ≥ 18` (~0.3 s of the berry inside the bowl sensor).
- `bell`: `bellRung`.
- `pop`: `balloonsLeft === 0` **and the level actually has ≥1 `balloon_goal`**
  (guard: a pop level with no goal balloons can never win instantly).
- On win: `win` event pushed, `state.won = true`.

**Quiescence ("stuck") detection**: after `t > 1.5 s`, if every dynamic body
has speed < 0.25 px/f (angular velocity counts, scaled ×30) for **100
consecutive frames**, `state.settled = true`. The game treats settled (or
t > 45 s) as "try again". The sandbox instead reads `quietFrames` directly
and auto-stops the run back to edit mode after **150 quiet frames** (~2.5 s)
— the ◼ button still stops it earlier. A burning fuse, a flaring match, a
spraying hydrant or a firing laser suppresses the quiet counter (pending
action is not "stuck").
⚠️ Slow-creeping mechanisms (long domino chains leaning quasi-statically) can
trip this while still "working". Design fast mechanisms, or keep something
moving (e.g. a ball bouncing on a trampoline resets the quiet counter).

### 4.5 The event stream

`sim.step()` returns an array of event objects and clears the internal queue.
The game forwards them to `LoryAudio.handleEvents()` and
`LoryRender.handleEvents()`. Full inventory:

| type | fields | emitted when | consumed by |
|---|---|---|---|
| `hit` | impact, bodyId, x, y, nx, ny, matA, matB | any contact relSpeed > 1.2 | audio (material sounds), render (squash + poof) |
| `boing` | impact, bodyId, partId, x, y | trampoline launch | audio (BOING), render (mat dip, stars, squash) |
| `bumper` | impact, partId, x, y | bumper contact | audio (ping), render (scale ping + ring) |
| `pop` | goal, x, y | balloon popped | audio (POP), render (shards + poof) |
| `bell` | x, y | bell rung (once) | audio (FM ring + music duck), render (swing anim, stars) |
| `sparkle` | n, x, y | sparkle collected | audio (rising gliss tier n), render (star burst), game (star chip) |
| `magnet_on` / `magnet_off` | x, y | magnet wake/tire | audio (clunk + hum loop / wind-down), render (ring/poof; glow state read directly from `plugin.lab.magnet.active`) |
| `win` | – | goal reached | audio (fanfare + duck). Game triggers overlay via `sim.state.won`, NOT this event. **Do not add a second fanfare in game.js** (that bug existed) |
| `snipclick` | x, y | scissors triggered (blades snap) | audio (click), render (blade anim) |
| `snip` | x, y, cause `'blade'\|'fire'` | rope or balloon tether actually cut | audio (snip), render (stars/ring or flame poof + blade anim) |
| `ignite` | x, y | fuse or candle catches fire | audio (fizz), render (flame burst) |
| `extinguish` | x, y | water douses a flame | audio (steam hiss), render (poof + droplets) |
| `switch_on` / `switch_off` | x, y | pressure plate pressed/released | audio (clicks), render (ring) |
| `thwack` | x, y, bodyId?, partId | fist fired (either trigger) | audio (punch + twang), render (ring/stars + squash) |
| `water_on` / `water_off` | x, y | hydrant valve opens/closes | audio (water loop start/stop), render (ring/poof); droplet FX read `lab.hyd.active` directly |
| `laser` | x, y | cannon fires (touch burst or switch rising edge) | audio (PEW zap), render (ring + stars); the beam itself is drawn from `lab.laz.beamLen`, not the event |

If you add an event type, update **both** consumers or nothing will happen —
they ignore unknown types silently.

### 4.6 Compound bodies — three traps you must know

`bucket` and `bowl` are Matter **compound bodies** (bottom plate + two tilted
side walls; the bowl also has a separate static **sensor** body
`bowl_sensor`). Three real bugs came from this; all are fixed, but you must
not reintroduce them:

1. **Collision pairs reference the *part* bodies, not the compound parent** —
   and only the parent carries `plugin.lab`. The `lab(body)` helper therefore
   resolves through `body.parent`. Always use `lab(x)`, never
   `x.plugin.lab` directly, when handling collisions.
2. **`Body.setPosition` aligns the *centroid*, not the authored geometry.**
   The compound's collision geometry sits ~12–15 px above the authored (x,y).
   The **levels were tuned against this shifted physics**, so do NOT "fix" it
   in core — the renderer compensates by drawing bucket/bowl art at the
   *bounds center* (`(bounds.min+bounds.max)/2`), which is where the physics
   actually is.
3. **`Matter.Collision.collides` against a compound parent uses its convex
   hull**, which would seal the open mouth of a bucket/bowl. Placement-overlap
   checks therefore test **leaf parts** (`body.parts.slice(1)`), never parents.
   (`placementOverlaps` already does this.)

### 4.7 Measured behaviour facts (empirical numbers for level design)

These were measured with the headless harness during tuning. **Trust them over
intuition** when designing/tuning levels; re-measure if you change physics.

- Berry rolls off a tilted shelf slowly: exit speed ~1–2 px/f at 8–12°,
  ~3–4 px/f at 22–26°. Seat a resting ball at `center_y = surface_top − r − 1`.
  A ball spawned even 1 px inside a solid gets ejected unpredictably.
- Free fall: ~350 px in 0.85 s; a body falling 250 px drifts horizontally by
  roughly `vx × 42` px.
- Trampoline: returns ~100–105% of fall height; horizontal velocity is
  preserved through bounces (this enables "stone-skipping" across two pads).
- Seesaw fling (marble dropped ~300 px onto one end, payload on the other):
  the payload flies mostly **horizontally**, 300–500 px far but only
  70–120 px up. It's a long-throw machine, not a high-jump machine. The fling
  is chaotic (landing varies ±50 px per ±10 px of input) — downstream geometry
  must funnel/absorb the spread (walls, wide targets, runways).
- Fan: corridor ~100 px wide, reach 280 px. Lifts/hovers a beach ball in an
  up-column (hover ceiling ~250 px above a floor fan). Pushes balloons
  strongly. Never moves berries (excluded) or marbles (force ÷ ~5.4 and mass
  ~6.1 → negligible).
- Magnet: yanks a resting marble off a shelf from 250+ px away in ~1 s;
  release drop is nearly perfectly vertical (< 5 px variance) — usable as a
  precision "position fixer".
- Dominoes: 30–34 px center spacing propagates; **40 px stalls**. A chain
  starts only if the striker arrives with ≥ ~3 px/f into the domino's **upper
  half**; a ball dropped dead-center on top balances and fails. A toppling
  domino falling off a shelf edge lands nearly straight below the edge.
- Conveyor: carries at 3.2 px/f; objects launch off the end with that vx.
  Drops onto belts > ~150 px make the berry bounce without gripping — hand
  off gently (< 60 px drop).
- Bumper: reflection is energetic but a rebound off a dropped ball returns
  only ~35% of fall height; bank angle changes ~13° per 10 px of contact
  offset — double-bounce paths must be re-normalized between bounces with
  fixed geometry (ramps/walls), or they fail the ±10 px robustness bar.
- Tethered goal balloons bob at their spawn (rise ~2 px, swing laterally
  ~45 px on the tether when pushed by a fan or another balloon).
- Bucket = terminal catcher: whatever falls in stays in (use as deflector
  or final trap, never a passthrough).

---

## 5. Level format & the solvability contract

`src/levels.js` returns an array of 24 level objects. Index in the array = 
level number − 1. Schema:

```jsonc
{
  "title": "Roll to the Bowl",          // short, playful
  "goalType": "catch",                  // catch | bell | pop
  "goalText": "Help the berry roll all the way into Lory's bowl!", // child-readable, shown in Lory's bubble on entry
  "teaches": "plank: a tilted plank makes a ball roll downhill",   // design note (not shown to players)
  "fixed": [                            // pre-placed furniture (locked)
    {"type": "shelf", "x": 260, "y": 240, "w": 320, "h": 40, "angle": 12},
    {"type": "berry", "x": 140, "y": 178},
    {"type": "bowl",  "x": 690, "y": 655}
  ],
  "tray": [ {"type": "plank", "count": 1} ],   // what the player gets
  "solution": [                         // placements that PROVABLY win
    {"type": "plank", "x": 532, "y": 590, "angle": 15}
  ],
  "sparkles": [ {"x":300,"y":212}, {"x":460,"y":380}, {"x":575,"y":566} ],
  "hintText": "The berry falls off the shelf right there..."  // Lory's hint, first person
}
```

Field notes:

- `fixed` specs accept `w`, `h` (shelf/wall are `sizable`), `angle` (degrees,
  positive = clockwise = right side down), and `dir` (fan/conveyor).
- `solution` specs use the same shape as player placements
  (`type, x, y, angle?, dir?`).
- **The `solution` array is dual-purpose**: (a) the automated proof that the
  level is beatable, and (b) the **hint ghosts** shown in-game (💡 button).
  It must always remain a genuinely working solution.
- `sparkles`: exactly 3, positioned ON the winning trajectory so the stored
  solution collects all of them (verify.mjs reports the count).
- Stars awarded on win = `max(1, sparklesCollected)`.

### The solvability contract (enforced by `test/verify.mjs`)

Every level must satisfy, at all times:

1. **Structural**: known part types; coordinates in 0..1280/0..720; tray
   counts cover the solution's part usage; exactly 3 sparkles.
2. **Null test**: `simulate(level, [], {maxSeconds:20})` must NOT win — the
   furniture alone can't solve the level.
3. **Legality**: every solution spec passes
   `!placementOverlaps(createSim(level,[]), spec)`.
4. **Win**: `simulate(level, level.solution, {maxSeconds:30})` wins.

The tuning bar used when authoring levels (stricter than verify.mjs — apply it
manually for new levels): the solution must also win with **all solution x
shifted +10 and −10**, and collect 3/3 sparkles in all three runs. Also verify
each tray part is *essential* (omit any one part → no win).

### Regenerating levels.js

`levels.js` is generated, not hand-edited. Pattern (Python):

```python
src = open('src/levels.js').read()
levels = json.loads(src[src.index('return ')+7 : src.rindex(';\n});')])
# ... mutate levels ...
js = ('/* header */\n(function (root, factory) {\n'
      "  if (typeof module === 'object' && module.exports) module.exports = factory();\n"
      '  else root.LoryLevels = factory();\n'
      "})(typeof self !== 'undefined' ? self : this, function () {\n"
      '  return ' + json.dumps(levels, indent=1).replace('\n','\n  ') + ';\n});\n')
open('src/levels.js','w').write(js)
```

After ANY levels.js change: `node test/verify.mjs` must print `24/24` (or the
new total) before you build.

---

## 6. Testing: what exists and what must always pass

Run everything from the project root:

```bash
node test/smoke.mjs      # 54 physics behaviour proofs — every part & interaction
node test/verify.mjs     # per-level proofs; add a number to test one: node test/verify.mjs 17
node test/puzzlecode.mjs # puzzle wire-format roundtrip + hostile-input proofs
node test/audio-shape.mjs  # audio API surface with stubbed window/AudioContext
node --check src/*.js    # syntax gate for every module
node build.mjs           # regenerates dist/ (see §10)
```

**Definition of green**: smoke N/N (currently 54/54), verify N/N (currently 24/24),
puzzlecode N/N (currently 31/31), audio-shape passes, all `--check`s pass.

### Browser E2E (Playwright, or bare headless Chrome)

There is no committed E2E suite, but two patterns used throughout development
(scripts lived in the session scratchpad) are worth reproducing for any UI
change.

**Playwright** (if installed):

```js
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome' }); // system Chrome — no browser download needed
const page = await browser.newPage({ viewport: { width: 1400, height: 920 } });
page.on('pageerror', e => errors.push(e.message));   // ALWAYS collect page errors
await page.goto('file:///.../dist/lorys-lab.html');
// map board coords -> screen coords (the app is CSS-scaled):
const b2s = async (bx, by) => { const r = await page.locator('#game').boundingBox();
  return { x: r.x + bx * r.width / 1280, y: r.y + by * r.height / 830 }; };
// drag = mouse.down + ~12 interpolated moves + mouse.up
```

**Bare headless Chrome** (zero dependencies — the harness that actually ran
this project's E2E): copy `index.html`, inject right after `<head>`
(1) `<base href="file:///abs/path/to/repo/">` so relative script paths
resolve, (2) a seed `<script>` that writes `localStorage` BEFORE game.js
loads (saved puzzles, mode, sfx:false), then append a driver `<script>`
before `</body>` that clicks DOM buttons / dispatches `PointerEvent`s and
writes results into a `#e2e-result` div. Run:

```bash
chrome --headless --disable-gpu --virtual-time-budget=60000 \
       --window-size=1400,900 --dump-dom "file://…/harness.html#pz=…" | grep 'E2E::'
```

Three traps, all hit in production here:
1. **Virtual time starves rAF**: `--virtual-time-budget` fast-forwards
   timers but barely ticks `requestAnimationFrame`, so the game loop (and
   all physics) freezes while your timer-based waits race ahead. Fix in the
   seed script, before game.js loads:
   `window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);`
   — physics and waits then share one virtual clock.
2. **Synthetic pointers can't be captured**: `cv.setPointerCapture(id)`
   throws for a dispatched `PointerEvent`'s fake pointerId, killing
   `onPointerDown` before it does anything. Stub
   `cv.setPointerCapture = cv.releasePointerCapture = () => {}` first.
3. Board→canvas mapping must account for the letterbox:
   `clientX = rect.left + (bx + boardOX) * rect.width / viewW` with
   `viewW = parseFloat(cv.style.width)`, `boardOX = max(0, (viewW-1280)/2)`.

`game.js` exposes **`window.__loryDebug.state`** (read-only snapshot:
`{screen, phase, selection, placements, tray, hints, cam, viewW, ox}`)
precisely so E2E scripts can assert editor state. Keep it working.

The canonical E2E checks: play L1 with its solution and reach the win overlay;
re-select/move/rotate a placed part; verify parts lock during ▶; sandbox
build → 🧩 → pluck → 💾 → reload → play → "You fed Lory!"; secret unlock
(press `l` ×5 on level select); open a `#pz=` share link → Keep → puzzle
appears in the grid, same link again → no duplicate; edit a saved puzzle →
selection 📌 un-marks a plucked part; user-puzzle hints (fail ×2 in sprout
→ auto-ghosts).

---

## 7. The renderer (`src/render.js`)

All art is drawn per-frame with Canvas 2D; nothing is loaded. Structure:

- **Palette `C`**: 16 named colors from the visual spec
  (`design/visual-spec.md`). Always use tokens, never raw hexes.
- **Background**: painted once into an offscreen canvas (`paintBackground`) —
  wall gradient, polka dots, crayon doodles, vignette, skirting + floor.
  Repainted by `setView(w)` whenever the full-bleed canvas width changes
  (every resize/orientation change goes through it); includes the makers'
  mark and, when wider than the board, the bench-end posts.
- **`painters` registry**: one function per part type,
  `painters[type](ctx, d, animState, o, body)` where `d = {type,w,h,r,dir,seed}`.
  The caller (`drawPart`) has already translated to the body position and
  rotated by `body.angle`; painters draw centered on the origin.
  - Balls (`ball_beach`, `ball_marble`) first `rotate(-body.angle)` to
    neutralize the caller's rotation, then re-rotate only their surface
    pattern — this keeps glints screen-aligned and patterns rolling at
    exactly 1× (there was a 2×-spin bug).
  - `balloon_goal` is an alias of `balloon` (poppy red vs sky blue).
  - Bucket/bowl draw at the compound **bounds center** (see §4.6).
  - A missing painter falls back to `painters.plank`, which **requires
    w/h** — a part type without a painter and without w/h produced NaN
    gradients once. Always add a painter for new types.
- **Per-part animation state**: `anim` Map keyed by `plugin.lab.id`
  (fan spin, conveyor dash offset, trampoline dip, bumper ping, bell swing,
  magnet wake-lerp, balloon string lag). Pruned in `stepAnims` when it exceeds
  `parts + 24` entries (sims are rebuilt with fresh ids on every edit —
  without pruning it leaks).
- **Squash & stretch**: `squash` Map keyed by Matter body id, fed by `hit`/
  `boing` events, applied as a render-only scale along the contact normal for
  0.18 s. Never touches physics.
- **Juice** (presentation-only speed cues; ALWAYS ON — the ✨ toggle was
  removed, `R.setJuice(bool)` remains for tooling, `save.juice` is ignored): ball motion trails
  (`stepJuice` records last 6 positions above `JUICE_MIN_SPEED = 1.0` px/f;
  `drawTrails` renders speed-modulated fading ribbons), pattern spin
  exaggeration (`JUICE_SPIN = 1.45` applied in the beach/marble painters),
  velocity-aligned lean (≤6% stretch in `drawPart`), and rolling dust puffs
  (every 0.4 s while moving with |vy| < 0.8). **Strictly render-layer** —
  no physics or trajectory is touched, so level proofs are unaffected.
- **Particles**: single pool (hard cap 260 in `spawn()` — the only enforced
  bound), kinds: confetti (`fx.confetti(x,y,n)`, n defaults to 80), poof,
  star, ring, shard, wind, drop (water droplets), flamep (flame flickers). **All motion is scaled by `dt*60`** so speed is
  refresh-rate independent (there was a 120 Hz bug). Public triggers:
  `R.fx.confetti/poof/stars/ring/shards/windPuff`.
- **Lory the mascot**: `drawLory(ctx, pose, t)` draws a 100×100 lorikeet;
  poses: `idle` (blink + bob), `think`, `cheer`, `oops`. Also used on the
  title screen and win overlay via separate small canvases.
- **Speech bubble**: `drawBubble` — wraps text at ~230 px.
- **Ghosts**: `drawGhost(ctx, spec, o, {style:'hint'})` = pulsing blue dashed
  outline + faded part (the hint system); drag ghosts use
  `{invalid, lift}` (red ✕ overlay when placement is illegal).
- **Plucked parts** (puzzle maker): if `spec._plucked` is truthy the part
  renders at 35% alpha with an orange dashed box + 🧩 badge.
- **Selection UI**: `drawSelection(c, sel, o, boost, sandbox)` returns button
  hit-circles (`{id:'rotl'|'rotr'|'flip'|'lit'|'pluck'|'del', x, y, r:28*boost}`;
  `lit` 🔥/💨 only on candles, `pluck` 🧩/📌 only in the sandbox — it toggles
  `spec._plucked` without entering pluck mode, THE way to revert a saved
  puzzle's hidden-part marks). Buttons
  render above the part, or **below** it when the part is near the top (they
  must never hide under the DOM topbar). The ✕ delete button gets extra
  spacing. `boost` is the mobile touch-target compensation (see game.js
  `uiBoost`, 1 on desktop/iPad, up to 1.7 on phones) — all sizes and the
  returned hit radii scale by it.
- **Tray**: `drawTray(c, tray, o, dragType, boost)` computes adaptive well
  sizes (`wellW = min(88*boost, (viewW-30)/n)` — the 28-well sandbox is width-bound
  on desktop and gains room on full-bleed phones) and returns well hit-regions
  `{type, x, y, w, count}`.
- **`draw(frame)`** is the single entry point; frame =
  `{sim, running, t, dt, selection, dragGhost, hints, tray, lory, uiBoost, cam}`;
  returns `{selButtons, wells}` for input hit-testing.

Draw order: background → Lory+bubble → wind zones → static parts → dynamic
parts → sensors (sparkles on top) → hint ghosts → selection → drag ghost →
particles → tray.

---

## 8. The audio engine (`src/audio.js`)

Everything synthesized at runtime; recipes live in `design/audio-spec.md`
(exact oscillator/envelope parameters). Architecture:

```
AudioContext (lazy; resumed on first pointer) 
 └─ master gain 0.9 → DynamicsCompressor(-12dB, knee 20, ratio 4) → destination
    sfxBus (1.0) + musicBus (0.126) feed master; shared 1 s noise buffer
```

Public API (`window.LoryAudio`):

- `unlock()` — create/resume context; **safe to call repeatedly**; must be
  called from a user gesture (game.js does it on first pointerdown).
- `sfx(name, {strength})` — one-shots. Names: `pickup, place, rotate, invalid,
  snip, thwack, switchOn, switchOff, igniteFizz, extinguishHiss,
  play, win, lose, button, levelpop, catch, pop, bell` + internal material
  sounds. Silent no-op before unlock or when disabled.
- `handleEvents(events)` — maps sim events to sounds (material mapping:
  marble→clack, domino→tick, rubber→boing, magnet+impact>3→clank,
  else wood knock; impact→strength = `clamp(impact/12, 0.15, 1)`).
- `startLoop(name)` / `stopLoop(name)` for `fan|conveyor|magnet|balloon|water` —
  **reference-counted** per name; `stopAllLoops()` force-stops everything and
  is what the game calls at the end of every run (multiple awake magnets made
  per-name decrements leak — don't go back to that).
- `setSfxEnabled(b)` / `setMusicEnabled(b)` + getters; disabling sfx force-stops
  loops; re-enabling mid-run requires the game to call its `startLoops()`
  helper again (it does).
- `music.start()/stop()` — generative music-box loop (C major, 76 bpm, 8 bars,
  humanized, 200 ms lookahead scheduler) with two sections: the main tune (A)
  plays twice, a lifted answer phrase (B, `MELODY_B`/`BASS_B`) plays once,
  then back — A,A,B repeating (`loopN % 3 === 2` selects B; the every-2nd-loop
  micro-variations apply to A only). Ducks on win (−12 dB) and bell (−6 dB)
  with automatic restore.
- Internals: rate limits in `MIN_GAP` (wood 30 ms, dominoTick 30 ms, marble
  25 ms); a **two-tier voice cap** — at ≥16 concurrent voices only
  low-priority sounds (dominoTick, marble) are dropped, and a hard ceiling of
  24 silences everything; every node stops & disconnects via `onended`.

**To add a sound**: write a recipe function following the `wood` template in
the `RECIPES` map (osc + gain envelope `linearRamp` attack →
`exponentialRampToValueAtTime(0.001)` decay → `.stop()`), register it in
`RECIPES`, give it a `MIN_GAP` entry if it can spam, and trigger it either via
`sfx('name')` or from `handleEvents`.

---

## 9. The game shell (`src/game.js`)

### State machine

```
S.screen: 'title' | 'levels' | 'game'
S.phase (game screen): 'edit' | 'run' | 'won'
```

- **edit**: sim exists but is never stepped (bodies rest at spawn). Every
  mutation (place/move/rotate/flip/delete) calls `rebuildSim()` — the sim is
  cheap to rebuild and this is the single source of consistency.
  `S.placements` (array of specs) is the authoritative editor state.
- **run**: fixed-step accumulator inside `frame()` (max 3 catch-up steps per
  rAF; accumulator clamped at 100 ms). Events go to audio + render. Win →
  `onWin()`; settled/timeout (45 s) → `onStuck()`; the sandbox instead
  auto-stops (plain `stopRun`) after 150 quiet frames (~2.5 s).
- **won**: input frozen; `S.winTimer` (1.4 s) then shows the overlay.
  `stopRun()` clears BOTH 'run' and 'won' phases and cancels `winTimer` —
  this prevents two historical bugs (win card painting over level select;
  Play during celebration cancelling the win).

### Editor interaction rules

- **Drag lifecycle**: pointerdown on tray well (count>0) or on a placed part
  starts a drag (`S.drag = {spec, from, origSpec?, pointerId, grabDx/y}`).
  The dragged part is REMOVED from placements during the drag (so overlap
  checks exclude it). Drop:
  - over tray → returned to stock;
  - invalid spot → `findNearestValid()` spiral search (rings of 14 px up to
    ~168 px); if nothing found: tray parts go home, board parts revert to
    `origSpec`;
  - else committed + auto-selected.
- **Multi-touch safety**: only the pointer that started the drag may move/end
  it (`e.pointerId` checks); a second finger cannot start a second drag.
- **`cancelDrag()`** safely refunds an in-flight drag; called by `startRun`
  and when entering pluck mode. If you add any new code path that can clear
  `S.drag`, refund through `cancelDrag()` — otherwise parts leak (Space-mid-
  drag bug).
- **Hit-testing placed parts**: `hitPlacement()` matches sim bodies back to
  placements **by value** (`type + x + y + angle + dir`) because `createSim`
  stores spec *copies*. If you add a spec field that changes during simulation,
  matching will break — don't. It filters out sensor bodies (invisible helper
  zones must not steal taps) with ONE exception: the fuse, whose only body IS
  a sensor — drop that exception and fuses become unselectable forever.
- **Selection**: index into `S.placements`; canvas-drawn buttons (from
  `R.draw`) are hit-tested first on pointerdown. Rotation: ⟲/⟳ buttons ±15°,
  `R`/`Shift+R` keys, mouse wheel ±5° (only parts with `defs.rot`).
  Direction flip (`⇄`/`F`) cycles `defs.dir`.
- **`specInvalid(spec)`**: out-of-board, below floor, play-button dead zone,
  or `Core.placementOverlaps`. Keyboard events from INPUT/TEXTAREA targets are
  ignored globally.

### Save data (localStorage key `lorys-lab-save-v1`)

Storage access goes through a `store` indirection: if
`window.LoryStorage = {get(key), set(key, value)}` exists **before** game.js
runs (injected by a native wrapper — see `doc/IOS-APP-GUIDE.md`), it replaces
`localStorage`. Both methods are synchronous.

```jsonc
{
  "mode": "sprout" | "whiz",       // Little (5+) / Big (8+) inventor
  "sfx": true, "music": true, "juice": true,
  "progress": { "0": {"stars": 3}, "5": {"stars": 0, "skipped": true} }, // by level index
  "allUnlocked": false,             // secret-key toggle
  "myPuzzles": [ { "id": "pz<ts>", "name": "...", "fixed": [specs], "plucked": [specs] } ],
  "puzzleWins": { "pz<ts>": true },
  "puzzleSeq": 3                    // next default puzzle name number
}
```

`persist()` is wrapped in try/catch; if storage is blocked (private mode,
sandboxed iframe) it shows a one-time warning toast instead of failing
silently. All shapes are defaulted on load — never assume fields exist.

### Feature logic map

- **Modes**: `sprout` = unlimited hints + free auto-hint after 2 failed runs;
  `whiz` = 2 hints/level. Both unlock levels sequentially.
- **Hints**: `onHint()` copies `level.solution` into `S.hints` (ghosts,
  8 s) and shows `hintText` in Lory's bubble. Hidden in the sandbox only;
  user puzzles use the author's `plucked` placements as the solution, so
  hints (💡, mode limits, sprout auto-hint after 2 fails) behave exactly
  like campaign levels.
- **Skip**: `offerSkip()` after 4 failed runs (campaign only — never in
  user puzzles); the button captures the level index at creation and
  no-ops if the level changed; removed on `enterLevel`; 15 s auto-remove.
- **Secret unlock**: `secretTick()` — 5 presses of `l` on the levels screen
  (or 5 taps on the "Pick a puzzle!" heading — both paths feed the same
  counter) within a rolling 2.5 s window toggles `save.allUnlocked`.
- **Start fresh (full reset)**: `showResetConfirm()` on the title screen —
  two-step confirm dialog; erases `progress`, `allUnlocked`, `myPuzzles`,
  `puzzleWins`, `puzzleSeq` but **keeps settings** (mode/sfx/music/juice).
  The title screen carries only a music toggle (`#tMusic`, labeled) next to
  Start fresh; sound effects toggle only in the in-game topbar (`#sfxBtn`).
- **Sandbox**: `S.sandbox`; tray from `SANDBOX_TRAY` (28 entries incl. the machine shop and
  fixed-only parts); no "try again" stuck flow, but the run auto-stops back
  to edit after ~2.5 s of stillness (§4.4); win events celebrate (confetti +
  reset of `won/caughtFrames/bellRung`) but never end the run.
- **Puzzle maker**: `S.pluckMode`. Flow: validate berry+bowl exist → taps
  toggle `spec._plucked` → 💾 opens the name dialog (Enter=save, Esc=cancel,
  re-open guarded) → `savePuzzle()` splits placements into
  `fixed` (unmarked) / `plucked` (marked, becomes the tray), strips the
  `_plucked` flags, saves. `S.editingPuzzleId` set ⇒ update-in-place +
  clear that puzzle's win. `editPuzzleInSandbox(p)` restores the scene
  (plucked parts re-marked) and deducts stock. Marks are also editable
  outside pluck mode via the selection 🧩/📌 button. ✕ (exit pluck mode)
  wipes marks only for a never-saved session — while editing a saved
  puzzle (`editingPuzzleId` set) it keeps them.
- **Playing a user puzzle**: `S.puzzle` set ⇒ `currentLevel()` synthesizes a
  def: goal always `catch`, tray derived by grouping `plucked` by type,
  `solution` = the author's `plucked` placements (powers hints), no
  sparkles; star chip hidden, hints fully active (same mode logic as the
  campaign, no skip); win records `puzzleWins[id]` and
  shows the custom "You fed Lory!" overlay.
- **Puzzle sharing** (`core.js puzzleCode` + game.js): wire format
  `LORY1.<base64url(deflate-raw(json))>` (`LORY0.` = uncompressed fallback);
  payload `{v, name, by?, fixed:[[type,x,y,extra?]…], plucked:[…]}` where
  `extra` is ONE of number=angle / string=dir (default omitted) / false=cold
  candle. `decode()` validates EVERYTHING into fresh objects (unknown part or
  future `v` → `newer-version`; bounds/caps/shape errors → `bad-data`;
  ≥1 berry+bowl and ≥1 plucked required; ≤100 parts; inflate capped —
  zip-bomb guard). Share paths: per-card 📤 dialog (native share / copy link
  / `.lorypuzzle` file), 📥 file import (regex-scans any text for codes, max
  200), 📦 backup-all (one file, `#`-comment headers). Links carry
  `#pz=<code>`; boot + `hashchange` call `checkSharedPuzzle()` → offer
  dialog (names rendered via `textContent`). Imports dedupe by
  `puzzleCode.canonical` (name+by+layout) and get fresh local ids; after an
  import the author layout is re-simulated and Lory warns if it no longer
  wins (physics drift advisory, never a rejection).

---

## 10. Build & deployment

`node build.mjs` produces:

1. **`dist/lorys-lab.html`** — the standalone game: `index.html` with all six
   scripts inlined. Open directly in any browser. This is the canonical build.
2. **`dist/artifact.html`** + **`dist/lorys-lab-current.html`** (identical copy) —
   the claude.ai artifact variant: **no** `<!DOCTYPE>/<html>/<head>/<body>`
   (the artifact host wraps content in its own skeleton), a `<title>` tag,
   and a theme-aware backdrop (`--lab-backdrop` custom property redefined for
   `prefers-color-scheme: dark` and `:root[data-theme=…]` overrides).
   The published artifact points at `dist/lorys-lab-current.html`; build.mjs
   refreshes it, so republishing that same path updates the same URL.

The artifact host enforces a strict CSP: **no external requests of any kind**.
Everything must stay inlined; never add a CDN `<script>`/`<link>`/font URL.

### The hosted PWA (GitHub Pages) — the third deployment target

The repository itself is served at **https://matteo-grella.github.io/lorys-lab/**
(GitHub Pages from `main`, root). This deployment does NOT use `dist/` — Pages
serves `index.html` + `src/*.js` directly, plus `manifest.json`, the icons,
and `sw.js` (a **network-first** service worker with ETag revalidation:
deploys are visible on the first online load, offline play falls back to
cache; a new worker auto-reloads the page once via the `controllerchange`
handler in index.html). The standalone/artifact builds strip the PWA link
tags, so none of this leaks into the single-file outputs.

**Deploy procedure**: run the tests, `node build.mjs`, **bump the `CACHE`
version string in `sw.js`** (e.g. `lorys-lab-v12` → `-v13` — this is the step
that must never be skipped: it purges installed devices' old caches), commit,
`git push origin main`. Pages redeploys in ~1 minute; verify with a hash
compare of a served file against the local copy.

After every build, sanity-check `dist/lorys-lab.html` in a browser (or via the
Playwright pattern in §6) before publishing.

---

## 11. Recipes: how to evolve the game

### 11.1 Add a new placeable part

Checklist — touch **six** places, then test:

1. **`core.js PART_DEFS`**: size, `static`, `placeable: true`, `rot`/`dir`
   flags.
2. **`core.js makePart`**: a case constructing the body/bodies with tuned
   material properties. Tag every body with `tag(...)`; add extra metadata
   into the tag's second argument.
3. **`core.js MATERIAL`**: pick a sound class (or add one — then also extend
   audio's `handleEvents` mapping).
4. If the part has continuous behaviour (forces, drives): add a block to
   `applyBehaviours`. If it reacts to contacts: extend the `collisionStart`
   handler **using `lab()`** and emit a new event type if FX/audio need it.
5. **`render.js painters`**: a painter drawing centered at origin using
   palette tokens (follow the visual spec's toy rules: outline
   `C.outline` 2 px, rounded corners ≥ 6 px, one charm detail, one motion
   touch driven by the `anim` map).
6. **`game.js SANDBOX_TRAY`**: add `[type, count]` so it appears in the
   sandbox (and the puzzle maker).

Then: write 1–2 behaviour tests in `test/smoke.mjs` proving the mechanic
(happy path + a "doesn't do what it shouldn't" case), run the whole test
matrix, and only then design levels using it. If the part participates in the
wind/magnet interplay, decide explicitly how it responds to fans (weight
class) and magnets (only `ball_marble` is attracted — keep it that way unless
you're deliberately adding a new metal object, in which case use a
`plugin.lab` flag like `isBerry`, not a type-name check).

### 11.2 Add a new campaign level

1. Design on paper against §4.7's measured facts. One clear insight per level;
   tray of 2–5 parts, ≤ 3 distinct types; every tray part essential.
2. Author the JSON (schema §5). Seat resting balls exactly
   (`surface_top − r − 1`); keep everything in x 40..1240, y 60..660.
3. **Tune empirically** — never trust untested coordinates. Write a scratch
   script:

   ```js
   import { createRequire } from 'module';
   const require = createRequire(import.meta.url);
   const Core = require('/abs/path/to/src/core.js');
   const level = { /* your JSON */ };
   const nul = Core.simulate(level, [], { maxSeconds: 20 });
   const sol = Core.simulate(level, level.solution, { maxSeconds: 30 });
   console.log('null(must be false):', nul.won, '| win:', sol.won, sol.seconds, '| sparkles:', sol.sparkles);
   ```

   For trajectory work step manually and log positions:

   ```js
   const sim = Core.createSim(level, level.solution);
   const b = sim.bodies().find(x => x.plugin?.lab?.type === 'berry');
   for (let f = 0; f < 1800; f++) { sim.step();
     if (f % 30 === 0) console.log((f/60).toFixed(1), b.position.x|0, b.position.y|0);
     if (sim.state.won) { console.log('WON', (f/60).toFixed(2)); break; } }
   ```

4. Acceptance bar: null-test fails to win; solution wins < 25 s at dx 0/+10/−10;
   3/3 sparkles in all three runs (place sparkles on **logged** trajectory
   points); every solution spec passes `placementOverlaps` = false; each tray
   part essential.
5. Append to `levels.js` via the §5 regeneration pattern, run
   `node test/verify.mjs`, build.

Known design pitfalls (§4.7 details): domino chains > 40 px stall; balls
balanced dead-center on dominoes; slow creep tripping quiescence; big drops
onto conveyors; seesaw/bumper chaos needing funnels; bucket assumed to be a
passthrough (it's a trap); `pop` goals require at least one **fixed**
`balloon_goal`; bowls only count **berries** (`isBerry`) — a marble in a bowl
does NOT win a catch level.

### 11.3 Change a physics constant

Physics constants are **globally coupled to all 24 level solutions**. Safe
procedure:

1. Change the constant.
2. `node test/smoke.mjs` — mechanics still behave.
3. `node test/verify.mjs` — expect casualties; each failing level needs its
   geometry re-tuned (recipe 11.2 step 3) *preserving its design intent*.
4. Never "fix" the bucket/bowl centroid shift or the domino friction without
   reading §4.6 / §4.1 first — several values look wrong but are load-bearing.

If you only need a new behaviour for a new part, prefer adding a new constant
over changing a shared one.

### 11.4 Add a new goal type

1. `core.js`: extend `state`, detection in collision handlers and `checkGoal`,
   and add a win path guard like the pop-goal's "must have ≥1 target" rule.
2. `levels.js`: new `goalType` value in level JSON.
3. `game.js`: `goalPos()` (confetti origin), any goal-specific sfx in
   `onWin()` (like `catch`'s gulp).
4. `verify.mjs` needs no change (it just checks `won`), but write a smoke test
   proving the new goal fires and — importantly — does NOT fire trivially.
5. Renderer: draw the new goal object + a win reaction.

### 11.5 Add a sound

See §8. If it's event-driven, extend `handleEvents` in audio.js; if
UI-driven, add a recipe name and call `A.sfx('name')` from game.js. Keep
`test/audio-shape.mjs` passing (it asserts the public API and that calls
pre-unlock don't throw).

### 11.6 Add UI / a new screen

- Screens are DOM, injected into `.overlay-root` by `showScreen()`-family
  functions; the canvas keeps rendering underneath (skipped for `title`/
  `levels` except mascot canvases).
- Follow the toy-block CSS system in `index.html` (`.chip`, `.big`, `.card`,
  hard bottom-edge shadows, `ui-rounded` stack). Touch targets ≥ 44 px.
- Buttons that act on game state must respect the phase machine — check
  `S.phase`/`S.pluckMode` guards on every new entry point (three separate
  review bugs came from missing guards: hint during run, skip during run,
  play during 'won').
- Text rules: child-readable, action-first, Lory speaks first-person. Critical
  actions must never be text-only — pair with icon/color/Lory reaction.

### 11.7 Debugging playbook

| Symptom | First moves |
|---|---|
| Level won't win headlessly | Trace the hero body (11.2 step 3). Check: settled early? (`sim.state.settled`, quiescence §4.4) — something crept too slowly. Ball never moved? — seated inside a solid or balanced dead-center. |
| Works headlessly, not in browser | The browser run goes through `rebuildSim` + the same core — differences are almost always placement rounding (drop coords are integers) or edit-state, not physics. Check `window.__loryDebug.state`. |
| Visual glitch on one part | Its painter — check ctx save/restore pairing and that it doesn't rely on `body` being non-null (tray previews call painters with `body = null`). |
| NaN / gradient crash | A painter got `undefined` w/h — usually a new part type without a painter falling back to `painters.plank`. |
| Sound stuck on (hum forever) | A loop leak: some path ended a run without `stopLoops()`. All run-ending paths must go through `stopRun()`/`onWin()`. |
| Parts vanish / tray count wrong | A drag was cleared without `cancelDrag()` refund, or a second pointer bypassed the `pointerId` guards. |
| Win overlay over wrong screen | `S.phase === 'won'` outlived its screen — `stopRun()` must clear phase + `winTimer` on every exit path. |
| Saves disappear after reload | `localStorage` blocked (private mode/iframe) — the warning toast in `persist()` should have fired; check it still exists. |

Console errors in the browser are ALWAYS bugs here — the game runs clean.
E2E scripts must assert `pageerror` count is zero.

---

## 12. Invariants — never break these

1. **`core.js` stays Node-compatible.** No DOM/window access. The whole
   verification pipeline dies otherwise.
2. **`node test/verify.mjs` passes for every level, always.** A level change,
   physics change, or core change that breaks it does not ship until re-tuned.
   The stored `solution` must remain a real, robust solution — it is also the
   hint system.
3. **Berries are immune to fan wind**; **only `ball_marble` responds to
   magnets**; **bowls only catch berries**. These are teaching rules the
   levels rely on.
4. **Domino friction 0.2 / 30–34 px spacing**, **trampoline boost
   `−max(vy×1.06, 8)`**, **bell threshold 1.8**, **pop threshold 3.5**,
   **magnet wake 1.6 / pull window 120 frames** — all tuned against the level
   set. Treat as load-bearing (§11.3 procedure to change).
5. **Use `lab(body)` for all collision metadata** (compound parent
   resolution). Never `body.plugin.lab` directly in handlers.
6. **Don't "fix" the bucket/bowl centroid offset in core** — levels are tuned
   against it; the renderer compensates (§4.6).
7. **Every run-ending path calls `stopRun()`** (which force-stops audio loops
   and clears `winTimer`), and **every drag-clearing path calls
   `cancelDrag()`**.
8. **Placed-part identity is by value** (`type,x,y,angle,dir`) — spec fields
   must not mutate outside the editor.
9. **Events: one producer, two consumers.** New event types must be handled
   (or deliberately ignored) in both audio and render; the win fanfare is
   triggered by the core `win` event ONLY (no duplicate in game.js).
10. **Keyboard handlers ignore INPUT/TEXTAREA targets**; the levels-screen
    secret key must not interfere with the puzzle-name dialog.
11. **Artifact build has no document skeleton and no external URLs** (CSP).
    The published artifact path is written in `build.mjs` (currently
    `dist/lorys-lab-current.html`).
12. **All art via palette tokens, all text child-readable, touch targets
    ≥ 44 px** — this is a game for five-year-olds; every regression here is a
    real regression.
13. Parts are freely movable/rotatable in `edit` phase and completely frozen
    during `run` — a deliberate product decision (user-requested). Don't add
    mid-run editing.
14. `localStorage` access is always guarded; failures surface a visible
    warning, never silence.
15. **The makers' mark on the wall stays.** It is painted in
    `render.js paintBackground()` from a base64-encoded constant so the
    names never appear literally in source — it is the project's watermark
    and ships in every build.
16. **Foreign puzzle data enters ONLY through `puzzleCode.decode`.** Never
    build placements from raw JSON of a link/file: decode validates every
    field into fresh objects (part whitelist, bounds, caps, no foreign
    keys) and is what keeps shared puzzles data-only. User text (puzzle
    names) is rendered via `textContent` or canvas — never raw innerHTML.
